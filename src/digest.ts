import { Octokit } from "@octokit/rest";
import { simpleGit } from "simple-git";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const TOKEN = mustEnv("GITHUB_TOKEN").trim();
const VAULT_REPO = mustEnv("VAULT_REPO").trim();
const COMMITTER_NAME = process.env.COMMITTER_NAME ?? "clawbot";
const COMMITTER_EMAIL = process.env.COMMITTER_EMAIL ?? "clawbot@users.noreply.github.com";
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS ?? 7);

const octokit = new Octokit({ auth: TOKEN });

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

function isoDate(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

async function listOwnedRepos() {
  const repos: { owner: string; name: string; full: string; description: string | null; private: boolean; pushedAt: string | null; htmlUrl: string }[] = [];
  let page = 1;
  while (true) {
    const { data } = await octokit.repos.listForAuthenticatedUser({
      per_page: 100,
      page,
      sort: "pushed",
      affiliation: "owner,collaborator,organization_member",
    });
    if (data.length === 0) break;
    for (const r of data) {
      repos.push({
        owner: r.owner.login,
        name: r.name,
        full: r.full_name,
        description: r.description,
        private: r.private,
        pushedAt: r.pushed_at,
        htmlUrl: r.html_url,
      });
    }
    if (data.length < 100) break;
    page++;
  }
  return repos;
}

async function recentCommits(owner: string, repo: string, since: string) {
  try {
    const { data } = await octokit.repos.listCommits({ owner, repo, since, per_page: 30 });
    return data.map(c => ({
      sha: c.sha.slice(0, 7),
      message: c.commit.message.split("\n")[0],
      author: c.commit.author?.name ?? "unknown",
      date: c.commit.author?.date ?? "",
      url: c.html_url,
    }));
  } catch {
    return [];
  }
}

async function openPRs(owner: string, repo: string) {
  try {
    const { data } = await octokit.pulls.list({ owner, repo, state: "open", per_page: 30 });
    return data.map(p => ({ number: p.number, title: p.title, author: p.user?.login ?? "?", url: p.html_url, draft: p.draft }));
  } catch {
    return [];
  }
}

async function openIssues(owner: string, repo: string) {
  try {
    const { data } = await octokit.issues.listForRepo({ owner, repo, state: "open", per_page: 30 });
    return data.filter(i => !i.pull_request).map(i => ({ number: i.number, title: i.title, author: i.user?.login ?? "?", url: i.html_url }));
  } catch {
    return [];
  }
}

function fmtRepoSection(r: { full: string; htmlUrl: string; description: string | null; private: boolean; pushedAt: string | null }, commits: any[], prs: any[], issues: any[]) {
  const lines: string[] = [];
  lines.push(`### [${r.full}](${r.htmlUrl})${r.private ? " *(private)*" : ""}`);
  if (r.description) lines.push(`> ${r.description}`);
  lines.push(`_Last pushed: ${r.pushedAt ?? "—"}_`);
  lines.push("");
  if (commits.length > 0) {
    lines.push(`**Recent commits (${commits.length})**`);
    for (const c of commits) {
      lines.push(`- \`${c.sha}\` ${c.message} — ${c.author}`);
    }
    lines.push("");
  }
  if (prs.length > 0) {
    lines.push(`**Open PRs (${prs.length})**`);
    for (const p of prs) {
      lines.push(`- [#${p.number}](${p.url}) ${p.title} — @${p.author}${p.draft ? " *(draft)*" : ""}`);
    }
    lines.push("");
  }
  if (issues.length > 0) {
    lines.push(`**Open issues (${issues.length})**`);
    for (const i of issues) {
      lines.push(`- [#${i.number}](${i.url}) ${i.title} — @${i.author}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const today = isoDate();
  const since = isoDate(new Date(Date.now() - LOOKBACK_DAYS * 86400_000));

  console.log(`clawbot: digest run ${today}, lookback since ${since}`);
  const workdir = join(process.cwd(), ".vault");
  if (existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });

  const cloneUrl = `https://x-access-token:${TOKEN}@github.com/${VAULT_REPO}.git`;
  const git = simpleGit();
  console.log(`clawbot: cloning vault ${VAULT_REPO}`);
  await git.clone(cloneUrl, workdir, ["--depth", "1"]);
  const vault = simpleGit(workdir);
  await vault.addConfig("user.name", COMMITTER_NAME);
  await vault.addConfig("user.email", COMMITTER_EMAIL);

  const repos = await listOwnedRepos();
  console.log(`clawbot: scanning ${repos.length} repos`);

  const sections: string[] = [];
  let totalCommits = 0, totalPrs = 0, totalIssues = 0;
  const reposDir = join(workdir, "_clawbot", "repos");
  mkdirSync(reposDir, { recursive: true });

  for (const r of repos) {
    const [commits, prs, issues] = await Promise.all([
      recentCommits(r.owner, r.name, since),
      openPRs(r.owner, r.name),
      openIssues(r.owner, r.name),
    ]);
    totalCommits += commits.length; totalPrs += prs.length; totalIssues += issues.length;
    if (commits.length === 0 && prs.length === 0 && issues.length === 0) continue;
    const section = fmtRepoSection(r, commits, prs, issues);
    sections.push(section);
    const perRepoPath = join(reposDir, `${r.owner}-${r.name}.md`);
    writeFileSync(perRepoPath, `# ${r.full}\n\n_Snapshot: ${today}_\n\n${section}\n`, "utf8");
  }

  const header = [
    `# Daily digest — ${today}`,
    "",
    `_Generated by clawbot at ${new Date().toISOString()}._`,
    `_Lookback: ${LOOKBACK_DAYS} days (since ${since})._`,
    `_Scope: ${repos.length} repos · ${totalCommits} recent commits · ${totalPrs} open PRs · ${totalIssues} open issues._`,
    "",
    "## Repos with activity",
    "",
  ].join("\n");

  const body = sections.length > 0 ? sections.join("\n---\n\n") : "_No repos showed activity in the lookback window._\n";
  const digest = header + body;

  const digestPath = join(workdir, "_clawbot", `${today}.md`);
  const latestPath = join(workdir, "_clawbot", "latest.md");
  const metaPath = join(workdir, "_clawbot", "_meta", "last-run.json");
  mkdirSync(join(workdir, "_clawbot", "_meta"), { recursive: true });
  writeFileSync(digestPath, digest, "utf8");
  writeFileSync(latestPath, digest, "utf8");
  writeFileSync(metaPath, JSON.stringify({ ranAt: new Date().toISOString(), reposScanned: repos.length, totalCommits, totalPrs, totalIssues, lookbackDays: LOOKBACK_DAYS }, null, 2), "utf8");

  await vault.add("_clawbot");
  const status = await vault.status();
  if (status.files.length === 0) {
    console.log("clawbot: no changes, skipping commit");
    return;
  }
  await vault.commit(`clawbot: digest ${today}`);
  await vault.push("origin", "HEAD");
  console.log(`clawbot: pushed digest ${today}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
