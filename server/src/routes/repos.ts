import { Router } from "express";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { listOwnedRepos, recentCommits, openPRs, openIssues, readme } from "../lib/github.js";
import { writeVaultFile, commitAndPush } from "../lib/vault.js";
import { ollamaGenerate } from "../lib/ollama.js";
import { newJob, runJob, getJob } from "../lib/jobs.js";

export const reposRouter = Router();

reposRouter.get("/", async (_req, res) => {
  try {
    const repos = await listOwnedRepos();
    const enriched = repos.map(r => {
      const summaryPath = join(config.vaultPath, "_clawbot", "summaries", `${r.owner}-${r.name}.md`);
      return { ...r, hasSummary: existsSync(summaryPath) };
    });
    res.json({ repos: enriched });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

reposRouter.get("/:owner/:name", async (req, res) => {
  const { owner, name } = req.params;
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  try {
    const [commits, prs, issues] = await Promise.all([
      recentCommits(owner, name, since),
      openPRs(owner, name),
      openIssues(owner, name),
    ]);
    const summaryPath = join(config.vaultPath, "_clawbot", "summaries", `${owner}-${name}.md`);
    const summary = existsSync(summaryPath) ? readFileSync(summaryPath, "utf8") : null;
    res.json({ owner, name, commits, prs, issues, summary });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

reposRouter.post("/:owner/:name/summarize", async (req, res) => {
  const { owner, name } = req.params;
  const job = newJob(`summarize:${owner}/${name}`);
  res.json({ jobId: job.id });
  void runJob(job, async (push) => {
    push(`fetching readme + activity for ${owner}/${name}`);
    const since = new Date(Date.now() - 90 * 86400_000).toISOString();
    const [rd, commits, prs, issues] = await Promise.all([
      readme(owner, name),
      recentCommits(owner, name, since),
      openPRs(owner, name),
      openIssues(owner, name),
    ]);
    const promptParts: string[] = [];
    promptParts.push(`Repository: ${owner}/${name}`);
    if (rd) promptParts.push(`\nREADME (truncated to 4000 chars):\n${rd.slice(0, 4000)}`);
    if (commits.length) {
      promptParts.push(`\nRecent commits (last 90 days, ${commits.length}):`);
      promptParts.push(commits.slice(0, 30).map(c => `- ${c.sha} ${c.message}`).join("\n"));
    }
    if (prs.length) {
      promptParts.push(`\nOpen PRs (${prs.length}):`);
      promptParts.push(prs.slice(0, 20).map(p => `- #${p.number} ${p.title}`).join("\n"));
    }
    if (issues.length) {
      promptParts.push(`\nOpen issues (${issues.length}):`);
      promptParts.push(issues.slice(0, 20).map(i => `- #${i.number} ${i.title}`).join("\n"));
    }
    const system = "You are a senior engineer summarizing a code repository for an Obsidian second-brain. Output concise markdown with these sections: ## Purpose (one sentence), ## Stack (1-3 bullets), ## State (active/dormant/abandoned, evidence), ## Recent direction (last 90 days, 2-4 bullets), ## Notable open work (PRs/issues worth attention). Be specific. Cite commit subjects when useful. No filler, no headings beyond those listed.";
    push(`calling ollama (${process.env.OLLAMA_MODEL || "default model"})`);
    const summary = await ollamaGenerate(promptParts.join("\n"), system);
    const today = new Date().toISOString().slice(0, 10);
    const md = `---\nrepo: ${owner}/${name}\ngenerated: ${today}\nmodel: ${process.env.OLLAMA_MODEL || "ollama-default"}\n---\n\n# ${owner}/${name}\n\n${summary}\n`;
    const rel = `_clawbot/summaries/${owner}-${name}.md`;
    push(`writing ${rel}`);
    writeVaultFile(rel, md);
    push("committing + pushing vault");
    const r = await commitAndPush(`clawbot: summary ${owner}/${name}`);
    push(`vault: ${JSON.stringify(r)}`);
    return { path: rel, committed: r.committed };
  });
});

reposRouter.get("/jobs/:id", (req, res) => {
  const j = getJob(req.params.id);
  if (!j) return res.status(404).json({ error: "not found" });
  res.json(j);
});
