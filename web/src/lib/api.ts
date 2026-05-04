async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try { const body = await r.json(); msg = body.error ?? msg; } catch {}
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

export type TemplateInput = {
  name: string; label: string;
  type: "text" | "number" | "boolean" | "repo-picker" | "textarea";
  required?: boolean; default?: string | number | boolean; placeholder?: string;
};
export type Template = {
  id: string; role: "Engineering" | "Knowledge" | "Operations" | "Insights";
  title: string; description: string; icon: string;
  inputs: TemplateInput[]; requiresApproval: boolean; estimateSeconds: number; agent: string;
};
export type Role = { id: string; label: string; description: string; count: number };

export const api = {
  health: () => req<{ ok: boolean; name: string; version: string; ready: boolean; missing: string[] }>("/api/health"),
  status: () => req<any>("/api/status"),
  listRepos: () => req<{ repos: any[] }>("/api/repos"),
  getRepo: (owner: string, name: string) => req<any>(`/api/repos/${owner}/${name}`),
  listTemplates: () => req<{ roles: Role[]; templates: Template[] }>("/api/templates"),
  runTemplate: (id: string, inputs: Record<string, any>) => req<{ jobId: string; requiresApproval: boolean; status: string }>(`/api/templates/run/${id}`, { method: "POST", body: JSON.stringify(inputs) }),
  getJob: (id: string) => req<any>(`/api/templates/jobs/${id}`),
  listJobs: () => req<{ jobs: any[] }>("/api/templates/jobs"),
  approveJob: (id: string) => req<{ jobId: string; status: string }>(`/api/templates/jobs/${id}/approve`, { method: "POST" }),
  rejectJob: (id: string) => req<{ jobId: string; status: string }>(`/api/templates/jobs/${id}/reject`, { method: "POST" }),
  intent: (text: string) => req<{ source: string; templateId: string | null; inputs: Record<string, any> }>("/api/templates/intent", { method: "POST", body: JSON.stringify({ text }) }),
  brainTree: (path = "") => req<{ path: string; entries: { name: string; path: string; type: "dir" | "file" }[] }>(`/api/brain/tree?path=${encodeURIComponent(path)}`),
  brainFile: (path: string) => req<{ path: string; content: string }>(`/api/brain/file?path=${encodeURIComponent(path)}`),
  brainSearch: (q: string) => req<{ q: string; results: { path: string; line: number; preview: string }[] }>(`/api/brain/search?q=${encodeURIComponent(q)}`),
  brainLatestDigest: () => req<{ content: string }>("/api/brain/digest/latest"),
  triggerDigest: (lookbackDays = 7) => req<{ jobId: string }>("/api/tasks/digest", { method: "POST", body: JSON.stringify({ lookbackDays: String(lookbackDays) }) }),
  chat: (messages: { role: "user" | "assistant" | "system"; content: string }[]) => req<{ kind: "message" | "task"; text: string; jobId?: string; templateId?: string; requiresApproval?: boolean; brainHits?: { path: string; line: number; preview: string }[]; activePersona?: { id: string; name: string; role: string } | null }>("/api/chat", { method: "POST", body: JSON.stringify({ messages }) }),
  listPersonas: () => req<{ personas: any[]; activeId: string | null; active: any }>("/api/personas"),
  createPersona: (body: { name: string; jobDescription: string; tone?: string; role?: string; description?: string; responsibilities?: string[]; systemPromptOverride?: string }) => req<{ persona: any }>("/api/personas", { method: "POST", body: JSON.stringify(body) }),
  activatePersona: (id: string | "default") => req<{ active: any }>(`/api/personas/${id}/activate`, { method: "POST" }),
  deactivatePersona: () => req<{ active: null }>("/api/personas/deactivate", { method: "POST" }),
  deletePersona: (id: string) => req<{ deleted: true }>(`/api/personas/${id}`, { method: "DELETE" }),
  previewPersona: (jobDescription: string) => req<{ role: string; description: string; tone: string; responsibilities: string[] }>("/api/personas/preview", { method: "POST", body: JSON.stringify({ jobDescription }) }),
};
