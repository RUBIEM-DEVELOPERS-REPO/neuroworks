async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try { const body = await r.json(); msg = body.error ?? msg; } catch {}
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

export const api = {
  health: () => req<{ ok: boolean; name: string; version: string }>("/api/health"),
  status: () => req<any>("/api/status"),
  listRepos: () => req<{ repos: any[] }>("/api/repos"),
  getRepo: (owner: string, name: string) => req<any>(`/api/repos/${owner}/${name}`),
  summarizeRepo: (owner: string, name: string) => req<{ jobId: string }>(`/api/repos/${owner}/${name}/summarize`, { method: "POST" }),
  getJob: (id: string) => req<any>(`/api/repos/jobs/${id}`),
  brainTree: (path = "") => req<{ path: string; entries: { name: string; path: string; type: "dir" | "file" }[] }>(`/api/brain/tree?path=${encodeURIComponent(path)}`),
  brainFile: (path: string) => req<{ path: string; content: string }>(`/api/brain/file?path=${encodeURIComponent(path)}`),
  brainSearch: (q: string) => req<{ q: string; results: { path: string; line: number; preview: string }[] }>(`/api/brain/search?q=${encodeURIComponent(q)}`),
  brainLatestDigest: () => req<{ content: string }>("/api/brain/digest/latest"),
  triggerDigest: (lookbackDays = 7) => req<{ jobId: string }>("/api/tasks/digest", { method: "POST", body: JSON.stringify({ lookbackDays: String(lookbackDays) }) }),
  latestWorkflow: () => req<{ run: any }>("/api/tasks/workflow/latest"),
};
