import { Octokit } from "@octokit/rest";
import { config } from "../config.js";

export const octokit = new Octokit({ auth: config.githubToken });

export async function listOwnedRepos() {
  const out: any[] = [];
  let page = 1;
  while (true) {
    const { data } = await octokit.repos.listForAuthenticatedUser({
      per_page: 100, page, sort: "pushed",
      affiliation: "owner,collaborator,organization_member",
    });
    if (data.length === 0) break;
    out.push(...data);
    if (data.length < 100) break;
    page++;
  }
  return out.map(r => ({
    owner: r.owner.login,
    name: r.name,
    full: r.full_name,
    description: r.description,
    private: r.private,
    pushedAt: r.pushed_at,
    htmlUrl: r.html_url,
    language: r.language,
    defaultBranch: r.default_branch,
  }));
}

export async function recentCommits(owner: string, repo: string, sinceIso: string) {
  try {
    const { data } = await octokit.repos.listCommits({ owner, repo, since: sinceIso, per_page: 30 });
    return data.map(c => ({
      sha: c.sha.slice(0, 7),
      message: c.commit.message.split("\n")[0],
      author: c.commit.author?.name ?? "unknown",
      date: c.commit.author?.date ?? "",
      url: c.html_url,
    }));
  } catch { return []; }
}

export async function openPRs(owner: string, repo: string) {
  try {
    const { data } = await octokit.pulls.list({ owner, repo, state: "open", per_page: 30 });
    return data.map(p => ({ number: p.number, title: p.title, author: p.user?.login ?? "?", url: p.html_url, draft: p.draft }));
  } catch { return []; }
}

export async function openIssues(owner: string, repo: string) {
  try {
    const { data } = await octokit.issues.listForRepo({ owner, repo, state: "open", per_page: 30 });
    return data.filter(i => !i.pull_request).map(i => ({ number: i.number, title: i.title, author: i.user?.login ?? "?", url: i.html_url }));
  } catch { return []; }
}

export async function readme(owner: string, repo: string): Promise<string | null> {
  try {
    const { data } = await octokit.repos.getReadme({ owner, repo, mediaType: { format: "raw" } as any });
    return typeof data === "string" ? data : null;
  } catch { return null; }
}

export async function dispatchWorkflow(owner: string, repo: string, workflowFile: string, ref = "main", inputs: Record<string, string> = {}) {
  await octokit.actions.createWorkflowDispatch({ owner, repo, workflow_id: workflowFile, ref, inputs });
}

export async function latestRun(owner: string, repo: string, workflowFile: string) {
  const { data } = await octokit.actions.listWorkflowRuns({ owner, repo, workflow_id: workflowFile, per_page: 1 });
  return data.workflow_runs[0] ?? null;
}
