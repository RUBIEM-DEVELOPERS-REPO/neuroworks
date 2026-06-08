import { Router } from "express";
import { existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { simpleGit } from "simple-git";
import { templates, roles, type Template } from "../lib/templates.js";
import { newJob, getJob, listJobs, runJob, SERVER_BOOT_AT } from "../lib/jobs.js";
import { loadJobById, loadJobsInWindow, asJob } from "../lib/job-store.js";
import { config } from "../config.js";
import { dispatchWorkflow, recentCommits, openPRs, openIssues, readme, octokit } from "../lib/github.js";
import { writeVaultFile, commitAndPush, searchVault, VaultUnreachable } from "../lib/vault.js";
import { ollamaGenerate } from "../lib/ollama.js";
import { syncDownloads } from "../lib/sync-downloads.js";
import { planAndExecute, executePlan } from "../lib/agent.js";
import { loadCustomTemplates, saveCustomTemplate, findCustomTemplate, bumpRunCount, slugify, type CustomTemplate } from "../lib/custom-templates.js";
import { getActivePersona, personaSystemSuffix } from "../lib/personas.js";
import { classifyCustomTemplate, type TemplateRole } from "../lib/template-classifier.js";
import { findPrimitive } from "../lib/primitives.js";

export const templatesRouter = Router();

const NEEDS_GITHUB = new Set(["summarize-repo", "run-digest", "publish-folder"]);

templatesRouter.get("/", (_req, res) => {
  // Custom templates persist with role: "Custom" because save-time didn't
  // know which lane they belonged to. We re-classify on read so the UI
  // shows them under Engineering / Knowledge / Operations / Insights
  // when the id + title + description match a known lane. Unclassifiable
  // saves still fall through to "Custom" for discoverability.
  const custom = loadCustomTemplates().map(c => ({
    id: c.id,
    role: classifyCustomTemplate(c),
    title: c.title,
    description: c.description,
    icon: "saved",
    agent: "clawbot",
    inputs: [],
    requiresApproval: false,
    estimateSeconds: 30,
    runCount: c.runCount,
    lastRunAt: c.lastRunAt,
  }));
  // Recount every role with the re-classified customs folded in. Built-in
  // templates already have correct roles; we just need to add the custom
  // contribution per bucket.
  const customByRole: Record<TemplateRole, number> = { Engineering: 0, Knowledge: 0, Operations: 0, Insights: 0, Custom: 0 };
  for (const c of custom) customByRole[c.role as TemplateRole]++;
  const allRoles = roles.map(r => ({ ...r, count: (r.count ?? 0) + (customByRole[r.id as TemplateRole] ?? 0) }));
  res.json({ roles: allRoles, templates: [...templates, ...custom] });
});

// Jobs feed for the Tasks / Reports pages. MERGES the in-memory jobs with the
// persisted journal so reports SURVIVE a server restart / tsx-watch reload —
// previously this returned only the in-memory map (RECENT cap, wiped on
// reload), so scheduled runs and any older task had "no report" even though the
// record was on disk. In-memory wins on id collision (it's the freshest state).
templatesRouter.get("/jobs", (_req, res) => {
  const mem = listJobs();
  const seen = new Set(mem.map(j => j.id));
  // Look back 30 days of persisted records — enough for the Reports history
  // without scanning the whole journal. asJob() hydrates answer + plan so each
  // row deep-links to a renderable report.
  const windowStart = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let persisted: ReturnType<typeof asJob>[] = [];
  try {
    persisted = loadJobsInWindow(windowStart, Date.now() + 60_000)
      .filter(rec => !seen.has(rec.id))
      .map(asJob);
  } catch { /* tolerate — fall back to in-memory only */ }
  // Dedup persisted-vs-persisted too (append-only journal can hold running→
  // succeeded for one id); keep the last (latest status) per id.
  const byId = new Map<string, ReturnType<typeof asJob>>();
  for (const j of persisted) byId.set(j.id, j);
  const jobs = [...mem, ...byId.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  res.json({ jobs });
});

templatesRouter.get("/jobs/:id", (req, res) => {
  const j = getJob(req.params.id);
  if (j) return res.json(j);
  // Fallback to the persisted journal — covers the Calendar's day-detail
  // panel linking to old jobs that were evicted from the in-memory cap,
  // server-restart cases, and direct deep-links into /results/<id> for
  // anything older than the last few dozen jobs.
  const rec = loadJobById(req.params.id);
  if (rec) {
    // asJob() hydrates the persisted record into the Job shape the UI
    // expects, including answer + plan summary so the Result page renders
    // the actual report. log[] is empty (we don't persist log lines) and
    // runs[] is minimal (just tool + duration + ok flag).
    return res.json(asJob(rec));
  }
  return res.status(404).json({
    error: "not found",
    serverBootAt: SERVER_BOOT_AT,
    hint: "Job not found in memory or in the persisted journal. If this was a recent task, retry it — otherwise the journal may have been rotated.",
  });
});

// Retry a failed job — replays the same task + inputs through the general-task
// pipeline. The original failed job stays in the journal so the customer has
// the audit trail. The new job is fully fresh — plan, execution, synth all
// run again, so transient failures (LLM hiccup, network blip) get a clean
// second shot. We require the original to be in a terminal state (succeeded,
// failed, rejected); replaying a running job would create a duplicate.
templatesRouter.post("/jobs/:id/retry", async (req, res) => {
  const old = getJob(req.params.id);
  if (!old) return res.status(404).json({ error: "job not found" });
  if (old.status !== "failed" && old.status !== "rejected" && old.status !== "succeeded") {
    return res.status(409).json({ error: `cannot retry job in status "${old.status}" — wait for it to finish first` });
  }
  const task = String((old.inputs as any)?.task ?? "").trim();
  if (!task) return res.status(400).json({ error: "original job has no recorded task — cannot retry" });

  // Spin up a fresh job and run the same general-task agent loop. We mark it
  // with `retryOf: <old id>` so the UI / journal can trace the lineage.
  const job = newJob("insights:general-task");
  job.template = "general-task";
  job.title = `Retry: ${task.slice(0, 60)}`;
  job.inputs = { task, save_as_template: false, retryOf: req.params.id };
  res.json({ jobId: job.id, retryOf: req.params.id });

  void runJob(job, async (push, progress) => {
    push(`retry of job ${req.params.id} (${old.status})`);
    const persona = getActivePersona();
    const suffix = personaSystemSuffix(persona);
    const r = await planAndExecute(task, push, (patch) => progress(patch as Record<string, unknown>), { personaSystemSuffix: suffix });
    return {
      answer: r.answer,
      plan: r.plan,
      runs: r.runs,
      review: r.review,
      quality: r.quality,
      security: r.security,
      budgets: r.budgets,
      subagentTimings: r.subagentTimings,
      skillUsed: r.skillUsed,
      skillScore: r.skillScore,
    };
  });
});

templatesRouter.post("/run/:id", async (req, res) => {
  let tpl = templates.find(t => t.id === req.params.id);
  let custom: CustomTemplate | undefined;
  if (!tpl) {
    custom = findCustomTemplate(req.params.id);
    if (custom) {
      tpl = { id: custom.id, role: "Insights", title: custom.title, description: custom.description, icon: "saved", agent: "clawbot", inputs: [], requiresApproval: false, estimateSeconds: 30 } as Template;
    }
  }
  if (!tpl) return res.status(404).json({ error: "template not found" });
  const inputs = (req.body ?? {}) as Record<string, unknown>;

  // Validate required inputs
  const missing = tpl.inputs.filter(i => i.required && (inputs[i.name] === undefined || inputs[i.name] === "")).map(i => i.name);
  if (missing.length) return res.status(400).json({ error: `missing inputs: ${missing.join(", ")}` });

  // Preflight: refuse cleanly if a GitHub-touching template is requested without a token
  if (NEEDS_GITHUB.has(tpl.id) && !config.githubToken) {
    return res.status(412).json({ error: "GitHub token not configured. Set GITHUB_TOKEN in clawbot/.env and restart." });
  }

  const job = newJob(`${tpl.role.toLowerCase()}:${tpl.id}`);
  job.template = tpl.id;
  job.title = tpl.title;
  job.inputs = inputs;
  job.requiresApproval = tpl.requiresApproval;

  if (tpl.requiresApproval) {
    job.status = "awaiting-approval";
    job.log.push(`[${new Date().toISOString()}] task created · waiting on human approval (Approvals page)`);
    return res.json({ jobId: job.id, requiresApproval: true, status: "awaiting-approval" });
  }

  res.json({ jobId: job.id, requiresApproval: false, status: "queued" });
  void runJob(job, async (push, progress) => {
    if (custom) {
      bumpRunCount(custom.id);
      // Persona-derived starter templates ship with an empty plan — they re-plan
      // each run against the active persona system suffix so output stays in role.
      // Saved-from-chat templates, by contrast, replay their concrete plan.
      // Optional probe enrichment: callers (e.g. the stress harness) may pass
      // a `contextHint` to give the run more framing than the terse origin.task
      // carries. Absent → behaviour is unchanged. GATED TO PREPLAN BRANCH ONLY:
      // empty-plan templates route through generalTaskRunner which re-plans
      // every run — a longer task there expands planned scope and produced
      // 74/84 timeouts + 4 catastrophic ~5400s outliers in the 2026-05-30
      // sweep. The preplan branch replays a fixed plan, so richer task text
      // there only enriches synthesis, not planning.
      const contextHint = typeof inputs.contextHint === "string" ? inputs.contextHint.trim() : "";
      if (custom.plan.steps.length === 0 && custom.origin?.task) {
        return generalTaskRunner({ task: custom.origin.task, save_as_template: false }, push, progress);
      }
      // Saved-plan customs go through planAndExecute with `preplan` so they
      // get the same execute → synthesise → answer treatment as fresh
      // ad-hoc tasks. Previously this branch returned raw {plan, runs, ...}
      // JSON with no `answer` field, which surfaced to the customer as
      // machine output.
      const persona = getActivePersona();
      const personaSuffix = personaSystemSuffix(persona);
      const baseTask = custom.origin?.task ?? `Replay saved plan: ${custom.title}`;
      const taskText = contextHint ? `${baseTask}\n\nContext: ${contextHint}` : baseTask;
      const r = await planAndExecute(taskText, push, (patch) => progress(patch as Record<string, unknown>), {
        personaSystemSuffix: personaSuffix,
        preplan: custom.plan,
      });
      return { ...r, fromCustom: custom.id };
    }
    return runner(tpl.id, inputs, push, progress);
  });
});

// Grade an arbitrary (task, answer) with the deliverable-aware quality grader.
// Used by the all-templates stress harness: template replays go through the
// `preplan` path which skips the in-line QA gate, so we score their output
// here instead. Thin wrapper over the quality.check primitive.
templatesRouter.post("/grade", async (req, res) => {
  try {
    const task = String(req.body?.task ?? "");
    const answer = String(req.body?.answer ?? "");
    const sources = req.body?.sources ? String(req.body.sources) : "";
    const context = req.body?.context ? String(req.body.context) : "";
    if (!task || !answer) return res.status(400).json({ error: "task and answer required" });
    const prim = findPrimitive("quality.check");
    if (!prim) return res.status(500).json({ error: "quality.check primitive not found" });
    const r = await prim.handler({ task, answer, sources, context });
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

templatesRouter.post("/jobs/:id/approve", async (req, res) => {
  const j = getJob(req.params.id);
  if (!j) return res.status(404).json({ error: "not found" });
  if (j.status !== "awaiting-approval") return res.status(409).json({ error: `cannot approve job in state '${j.status}'` });
  j.approvedAt = new Date().toISOString();
  j.log.push(`[${j.approvedAt}] approved`);
  res.json({ jobId: j.id, status: "approved" });

  // Plan-approval job: execute the EXACT plan the user reviewed (no re-planning),
  // then let planAndExecute finish the loop (synthesise → answer). Empty plans
  // fall through to the normal plan/synth path.
  if (j.plan) {
    const task = j.task ?? j.title ?? "";
    void runJob(j, async (push, progress) =>
      planAndExecute(task, push, (patch) => progress(patch as Record<string, unknown>), {
        personaSystemSuffix: j.personaSuffix,
        preplan: j.plan && j.plan.steps.length > 0 ? j.plan : undefined,
      }));
    return;
  }
  if (!j.template) return;
  void runJob(j, async (push) => runner(j.template!, j.inputs ?? {}, push));
});

templatesRouter.post("/jobs/:id/reject", async (req, res) => {
  const j = getJob(req.params.id);
  if (!j) return res.status(404).json({ error: "not found" });
  if (j.status !== "awaiting-approval") return res.status(409).json({ error: `cannot reject job in state '${j.status}'` });
  j.rejectedAt = new Date().toISOString();
  j.status = "rejected";
  j.finishedAt = j.rejectedAt;
  j.log.push(`[${j.rejectedAt}] rejected`);
  res.json({ jobId: j.id, status: "rejected" });
});

// NL → template + extracted params via Ollama (best-effort; falls back to keyword match)
templatesRouter.post("/intent", async (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (!text) return res.status(400).json({ error: "text required" });
  const fallback = keywordMatch(text);
  try {
    const sys = "You translate a user task description into a JSON template intent. Respond with JSON only, no prose. Available templates and their inputs:\n" +
      templates.map(t => `- ${t.id}: ${t.title}. Inputs: ${t.inputs.length === 0 ? "(none)" : t.inputs.map(i => `${i.name}(${i.type}${i.required ? ",required" : ""})`).join(", ")}`).join("\n") +
      "\nReturn shape: {\"templateId\":\"<id>\",\"inputs\":{<name>:<value>}}. If you cannot determine, return {\"templateId\":null}.";
    const out = await ollamaGenerate(text, sys);
    const m = out.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      if (parsed.templateId && templates.find(t => t.id === parsed.templateId)) {
        return res.json({ source: "ollama", templateId: parsed.templateId, inputs: parsed.inputs ?? {} });
      }
    }
  } catch {}
  res.json({ source: "keyword", templateId: fallback?.id ?? null, inputs: {} });
});

// Lightweight stopword set so generic words ("the", "and", "is") don't
// produce false-positive template matches. Without this, "compare X vs Y"
// scored 1 hit against search-brain (because "the" is in "Search the
// knowledge base") and got mis-routed to vault search.
const KEYWORD_STOPWORDS = new Set([
  "the", "and", "for", "with", "but", "not", "you", "this", "that", "from",
  "into", "over", "under", "than", "then", "have", "has", "had", "was", "were",
  "are", "all", "any", "some", "out", "off", "now", "new", "old", "one", "two",
  "what", "when", "where", "why", "how", "who", "which", "let", "let's", "lets",
  "can", "could", "would", "should", "will", "may", "might", "must", "shall",
  "between", "without", "within", "about", "above", "below", "after", "before",
]);

function keywordMatch(text: string): Template | null {
  const q = text.toLowerCase();
  let best: { t: Template; s: number } | null = null;
  for (const t of templates) {
    const hay = (t.title + " " + t.description + " " + t.role).toLowerCase();
    let s = 0;
    for (const w of q.split(/\s+/)) {
      if (w.length > 2 && !KEYWORD_STOPWORDS.has(w) && hay.includes(w)) s++;
    }
    if (!best || s > best.s) best = { t, s };
  }
  // Require at least 2 substantive hits before claiming a match — single-word
  // overlaps (e.g. just "files" hitting summarize-repo's description) are
  // too weak to confidently route. The caller treats null as "let chat fall
  // through to general-task", which is the correct behaviour for ad-hoc
  // questions that don't fit a built-in template.
  return best && best.s >= 2 ? best.t : null;
}

// Exported for chat router (avoids circular re-fetch)
export async function runFromChat(templateId: string, inputs: Record<string, unknown>, push: (m: string) => void, progress?: (p: Record<string, unknown>) => void) {
  return runner(templateId, inputs, push, progress);
}

async function runner(templateId: string, inputs: Record<string, unknown>, push: (m: string) => void, progress?: (p: Record<string, unknown>) => void): Promise<unknown> {
  switch (templateId) {
    case "summarize-repo": return summarizeRepoRunner(inputs, push);
    case "run-digest":     return runDigestRunner(inputs, push);
    case "publish-folder": return publishFolderRunner(inputs, push);
    case "search-brain":   return searchBrainRunner(inputs, push);
    case "add-note":       return addNoteRunner(inputs, push);
    case "browse-vault":   return { redirect: "/knowledge" };
    case "sync-downloads": return syncDownloadsRunner(inputs, push);
    case "daily-briefing": return dailyBriefingRunner(inputs, push, progress);
    case "general-task":   return generalTaskRunner(inputs, push, progress);
    default: throw new Error(`no runner for ${templateId}`);
  }
}

async function summarizeRepoRunner(inputs: Record<string, unknown>, push: (m: string) => void) {
  const repo = String(inputs.repo);
  const [owner, name] = repo.includes("/") ? repo.split("/") : [config.githubOwner, repo];
  push(`fetching activity for ${owner}/${name}`);
  const since = new Date(Date.now() - 90 * 86400_000).toISOString();
  const [rd, commits, prs, issues] = await Promise.all([
    readme(owner, name), recentCommits(owner, name, since), openPRs(owner, name), openIssues(owner, name),
  ]);
  const parts: string[] = [`Repository: ${owner}/${name}`];
  if (rd) parts.push(`\nREADME (truncated):\n${rd.slice(0, 4000)}`);
  if (commits.length) parts.push(`\nRecent commits (${commits.length}):\n` + commits.slice(0, 30).map(c => `- ${c.sha} ${c.message}`).join("\n"));
  if (prs.length) parts.push(`\nOpen PRs (${prs.length}):\n` + prs.slice(0, 20).map(p => `- #${p.number} ${p.title}`).join("\n"));
  if (issues.length) parts.push(`\nOpen issues (${issues.length}):\n` + issues.slice(0, 20).map(i => `- #${i.number} ${i.title}`).join("\n"));
  push(`calling ollama (${config.ollamaModel})`);
  const summary = await ollamaGenerate(parts.join("\n"),
    "You are a senior engineer summarizing a repository for an Obsidian second brain. Output concise markdown with sections: ## Purpose (one sentence), ## Stack, ## State, ## Recent direction, ## Notable open work. No filler."
  );
  const today = new Date().toISOString().slice(0, 10);
  const md = `---\nrepo: ${owner}/${name}\ngenerated: ${today}\nmodel: ${config.ollamaModel}\n---\n\n# ${owner}/${name}\n\n${summary}\n`;
  const rel = `_clawbot/summaries/${owner}-${name}.md`;
  push(`writing ${rel}`);
  writeVaultFile(rel, md);
  push("committing + pushing vault");
  const r = await commitAndPush(`clawbot: summary ${owner}/${name}`);
  return { path: rel, ...r };
}

async function runDigestRunner(inputs: Record<string, unknown>, push: (m: string) => void) {
  const lookback = String(inputs.lookbackDays ?? 7);
  push(`dispatching daily-digest workflow (lookback=${lookback})`);
  await dispatchWorkflow(config.githubOwner, "clawbot", "daily-digest.yml", "main", { lookback_days: lookback });
  push("workflow_dispatch sent — track progress on GitHub Actions");
  return { dispatched: true, lookbackDays: lookback };
}

async function publishFolderRunner(inputs: Record<string, unknown>, push: (m: string) => void) {
  const path = String(inputs.path).trim();
  const isPublic = Boolean(inputs.public);
  let repoName = String(inputs.name ?? "").trim();
  if (!path) throw new Error("missing 'path'");
  const full = resolve(path);
  if (!existsSync(full)) throw new Error(`folder not found: ${full}`);
  if (!repoName) repoName = sanitizeName(basename(full));
  push(`target: ${full} → ${config.githubOwner}/${repoName} (${isPublic ? "public" : "private"})`);

  const git = simpleGit(full);
  const isRepo = await git.checkIsRepo().catch(() => false);
  if (!isRepo) {
    push("initializing local git repo");
    await git.init();
    await git.add(".");
    await git.commit("initial import");
  } else {
    const status = await git.status();
    if (status.files.length > 0) {
      push("staging local changes");
      await git.add(".");
      await git.commit("clawbot: snapshot before publish");
    }
  }

  let cloneUrl: string;
  try {
    push(`creating repo ${config.githubOwner}/${repoName}`);
    const { data } = await octokit.repos.createForAuthenticatedUser({
      name: repoName, private: !isPublic,
      description: `Auto-published by clawbot from local folder: ${basename(full)}`,
    });
    cloneUrl = data.clone_url;
  } catch (err: any) {
    if (err.status === 422) {
      push(`repo ${config.githubOwner}/${repoName} already exists, reusing`);
      cloneUrl = `https://github.com/${config.githubOwner}/${repoName}.git`;
    } else { throw err; }
  }

  const remoteUrl = cloneUrl.replace("https://", `https://x-access-token:${config.githubToken}@`);
  const remotes = await git.getRemotes();
  if (remotes.find(r => r.name === "origin")) await git.removeRemote("origin");
  await git.addRemote("origin", remoteUrl);
  const branch = (await git.branchLocal()).current || "main";
  push(`pushing ${branch} to origin`);
  await git.push(["-u", "origin", branch]);
  return { repo: `${config.githubOwner}/${repoName}`, branch, public: isPublic };
}

async function searchBrainRunner(inputs: Record<string, unknown>, push: (m: string) => void) {
  const q = String(inputs.query);
  push(`searching vault for "${q}"`);
  let results;
  try {
    results = searchVault(q);
  } catch (e: any) {
    if (e instanceof VaultUnreachable) {
      push(`vault unreachable: ${e.vaultPath}`);
      const answer = `I couldn't search your vault — the configured path **${e.vaultPath}** doesn't resolve on this machine. Common causes: the drive is unmounted (e.g. D: was unplugged on Windows), the folder was renamed, or \`VAULT_PATH\` in \`.env\` doesn't match your actual vault. Mount the drive (or fix the path) and try again.`;
      return { query: q, results: [], count: 0, vaultUnreachable: true, vaultPath: e.vaultPath, answer };
    }
    throw e;
  }
  push(`${results.length} match${results.length === 1 ? "" : "es"}`);
  // Build a human-readable `answer` so consumers (chat UI, harness, journal)
  // get a real summary instead of just a raw results array. Without this,
  // anything that read `result.answer` saw `undefined` and fell back to the
  // "On it — running..." chat ack.
  let answer: string;
  if (results.length === 0) {
    answer = `No notes in your vault match **${q}**. Try a broader term, check the spelling, or add a note on this topic and search again.`;
  } else {
    const top = results.slice(0, 8);
    const list = top.map((r, i) => {
      const preview = r.preview.replace(/\s+/g, " ").trim().slice(0, 160);
      return `${i + 1}. **${r.path}**${r.line ? ` (line ${r.line})` : ""} — ${preview}`;
    }).join("\n");
    const remaining = results.length - top.length;
    const more = remaining > 0 ? `\n\n_… and ${remaining} more match${remaining === 1 ? "" : "es"}._` : "";
    answer = `Found **${results.length}** note${results.length === 1 ? "" : "s"} mentioning **${q}**:\n\n${list}${more}`;
  }
  return { query: q, results, answer };
}

async function addNoteRunner(inputs: Record<string, unknown>, push: (m: string) => void) {
  const title = String(inputs.title);
  const body = String(inputs.body);
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "note";
  const rel = `0-Inbox/${stamp}-${slug}.md`;
  const today = new Date().toISOString().slice(0, 10);
  const md = `---\ntitle: ${title}\ncreated: ${today}\nsource: neuroworks\n---\n\n# ${title}\n\n${body}\n`;
  push(`writing ${rel}`);
  writeVaultFile(rel, md);
  push("committing vault");
  const r = await commitAndPush(`note: ${title}`);
  return { path: rel, ...r };
}

async function generalTaskRunner(inputs: Record<string, unknown>, push: (m: string) => void, progress?: (p: Record<string, unknown>) => void) {
  const task = String(inputs.task ?? "").trim();
  if (!task) throw new Error("missing 'task' input");
  const saveAs = inputs.save_as_template !== false;
  const persona = getActivePersona();
  const personaSuffix = personaSystemSuffix(persona);
  if (persona) push(`Working as ${persona.name} — ${persona.role}.`);
  const r = await planAndExecute(task, push, (patch) => progress?.(patch as Record<string, unknown>), { personaSystemSuffix: personaSuffix });

  // If the agent wrote anything to the vault, also commit + push
  if (r.hadWrites) {
    push("Wrote to your second brain — committing the changes.");
    try {
      const c = await commitAndPush(`clawbot: agent task — ${task.slice(0, 60)}`);
      push(`Vault commit: ${(c as any)?.ok === false ? "failed" : "done"}${(c as any)?.sha ? ` (${String((c as any).sha).slice(0, 7)})` : ""}.`);
    } catch (e: any) { push(`Commit didn't go through (non-fatal): ${e.message ?? e}.`); }
  }

  let savedTemplateId: string | undefined;
  const allOk = r.runs.length > 0 && r.runs.every(x => x.ok);
  if (saveAs && allOk && r.plan.steps.length > 0) {
    const id = `custom-${slugify(task)}`;
    const tpl: CustomTemplate = {
      id, role: "Custom",
      title: r.plan.summary || task.slice(0, 80),
      description: `Saved from chat: "${task}"`,
      origin: { task, createdAt: new Date().toISOString() },
      plan: r.plan,
      runCount: 1, lastRunAt: new Date().toISOString(),
    };
    saveCustomTemplate(tpl);
    savedTemplateId = id;
    push(`Saved this workflow as a reusable template: ${id}.`);
  }

  return {
    answer: r.answer,
    plan: r.plan,
    // Preserve the full StepRun shape on the final result — the frontend uses
    // step.label, run.startedAt, and run.modelUsed during render, and the vault
    // journal reads run.modelUsed. Drop run.result to keep the payload small;
    // primitives can return large blobs and we already have the synthesised
    // answer above.
    runs: r.runs.map(x => ({
      step: x.step,
      ok: x.ok,
      durationMs: x.durationMs,
      error: x.error,
      startedAt: x.startedAt,
      modelUsed: x.modelUsed,
    })),
    review: r.review,
    quality: r.quality,
    security: r.security,
    skillUsed: r.skillUsed,
    skillScore: r.skillScore,
    savedTemplateId,
  };
}

// Daily briefing — a thin wrapper over the general-task agent with a fixed,
// briefing-shaped prompt. Runs against the active persona so a hired EA (Evie)
// gives an EA-flavoured briefing. Doesn't auto-save as a template (it's already
// a built-in) and never re-asks for clarification — it's a scheduled, headless
// run. The optional `focus` input narrows the briefing to one area.
async function dailyBriefingRunner(inputs: Record<string, unknown>, push: (m: string) => void, progress?: (p: Record<string, unknown>) => void) {
  const focus = String(inputs.focus ?? "").trim();
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const task =
    `Produce my briefing for ${today}.${focus ? ` Focus area: ${focus}.` : ""}\n\n` +
    `Look at the last 5 days of activity in my vault (recent notes in _neuroworks/jobs/ and anything in 0-Inbox/), plus any items flagged for follow-up. ` +
    `Then write a short, scannable briefing with these sections:\n` +
    `## Focus today — the 3-5 things that matter most, each one line with WHY it matters\n` +
    `## Open loops — anything waiting on me or flagged for follow-up\n` +
    `## Worth knowing — short notes on recent changes or context\n\n` +
    `Keep it tight — this is a morning glance, not a report. If the vault is quiet, say so honestly rather than padding.`;
  return generalTaskRunner({ task, save_as_template: false }, push, progress);
}

async function syncDownloadsRunner(inputs: Record<string, unknown>, push: (m: string) => void) {
  const source = (inputs.source as string | undefined) ?? "";
  push("running download sync (read-only on sources)");
  const r = syncDownloads({ source }, push);
  push("committing inventory + state to vault");
  const commit = await commitAndPush(`clawbot: downloads sync (${r.copiedThisRun.length} new)`);
  return { ...r, commit };
}

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

