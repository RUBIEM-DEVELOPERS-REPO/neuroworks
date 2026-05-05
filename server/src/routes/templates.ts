import { Router } from "express";
import { existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { simpleGit } from "simple-git";
import { templates, roles, type Template } from "../lib/templates.js";
import { newJob, getJob, listJobs, runJob } from "../lib/jobs.js";
import { config } from "../config.js";
import { dispatchWorkflow, recentCommits, openPRs, openIssues, readme, octokit } from "../lib/github.js";
import { writeVaultFile, commitAndPush, searchVault } from "../lib/vault.js";
import { ollamaGenerate } from "../lib/ollama.js";
import { syncDownloads } from "../lib/sync-downloads.js";
import { planAndExecute, executePlan } from "../lib/agent.js";
import { loadCustomTemplates, saveCustomTemplate, findCustomTemplate, bumpRunCount, slugify, type CustomTemplate } from "../lib/custom-templates.js";
import { getActivePersona, personaSystemSuffix } from "../lib/personas.js";

export const templatesRouter = Router();

const NEEDS_GITHUB = new Set(["summarize-repo", "run-digest", "publish-folder"]);

templatesRouter.get("/", (_req, res) => {
  const custom = loadCustomTemplates().map(c => ({
    id: c.id, role: "Custom" as const, title: c.title, description: c.description,
    icon: "saved", agent: "clawbot",
    inputs: [], requiresApproval: false, estimateSeconds: 30,
    runCount: c.runCount, lastRunAt: c.lastRunAt,
  }));
  const allRoles = roles.map(r => r.id === "Custom" ? { ...r, count: custom.length } : r);
  res.json({ roles: allRoles, templates: [...templates, ...custom] });
});

templatesRouter.get("/jobs", (_req, res) => res.json({ jobs: listJobs() }));

templatesRouter.get("/jobs/:id", (req, res) => {
  const j = getJob(req.params.id);
  if (!j) return res.status(404).json({ error: "not found" });
  res.json(j);
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
      if (custom.plan.steps.length === 0 && custom.origin?.task) {
        return generalTaskRunner({ task: custom.origin.task, save_as_template: false }, push, progress);
      }
      progress({ plan: custom.plan, runs: [], phase: "executing" });
      const { runs } = await executePlan(custom.plan, push, (rs) => progress({ runs: [...rs] }));
      return { fromCustom: custom.id, plan: custom.plan, runs, phase: "done" };
    }
    return runner(tpl.id, inputs, push, progress);
  });
});

templatesRouter.post("/jobs/:id/approve", async (req, res) => {
  const j = getJob(req.params.id);
  if (!j) return res.status(404).json({ error: "not found" });
  if (j.status !== "awaiting-approval") return res.status(409).json({ error: `cannot approve job in state '${j.status}'` });
  j.approvedAt = new Date().toISOString();
  j.log.push(`[${j.approvedAt}] approved`);
  res.json({ jobId: j.id, status: "approved" });
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

function keywordMatch(text: string): Template | null {
  const q = text.toLowerCase();
  let best: { t: Template; s: number } | null = null;
  for (const t of templates) {
    const hay = (t.title + " " + t.description + " " + t.role).toLowerCase();
    let s = 0;
    for (const w of q.split(/\s+/)) if (w.length > 2 && hay.includes(w)) s++;
    if (!best || s > best.s) best = { t, s };
  }
  return best && best.s > 0 ? best.t : null;
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
  const results = searchVault(q);
  push(`${results.length} match${results.length === 1 ? "" : "es"}`);
  return { query: q, results };
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
  if (persona) push(`active persona: ${persona.name} (${persona.role})`);
  const r = await planAndExecute(task, push, (patch) => progress?.(patch as Record<string, unknown>), { personaSystemSuffix: personaSuffix });

  // If the agent wrote anything to the vault, also commit + push
  if (r.hadWrites) {
    push("agent wrote to vault — committing");
    try {
      const c = await commitAndPush(`clawbot: agent task — ${task.slice(0, 60)}`);
      push(`vault commit: ${JSON.stringify(c)}`);
    } catch (e: any) { push(`commit failed (non-fatal): ${e.message ?? e}`); }
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
    push(`saved as template: ${id}`);
  }

  return {
    answer: r.answer,
    plan: r.plan,
    runs: r.runs.map(x => ({ tool: x.step.tool, ok: x.ok, durationMs: x.durationMs, error: x.error })),
    savedTemplateId,
  };
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

