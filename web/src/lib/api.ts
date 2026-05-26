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
  health: () => req<{ ok: boolean; name: string; version: string; model: string; port: number; ready: boolean; missing: string[]; inflightJobs?: number; peers?: string[] }>("/api/health"),
  status: () => req<any>("/api/status"),
  listRepos: () => req<{ repos: any[] }>("/api/repos"),
  getRepo: (owner: string, name: string) => req<any>(`/api/repos/${owner}/${name}`),
  listTemplates: () => req<{ roles: Role[]; templates: Template[] }>("/api/templates"),
  runTemplate: (id: string, inputs: Record<string, any>) => req<{ jobId: string; requiresApproval: boolean; status: string }>(`/api/templates/run/${id}`, { method: "POST", body: JSON.stringify(inputs) }),
  getJob: (id: string) => req<any>(`/api/templates/jobs/${id}`),
  listJobs: () => req<{ jobs: any[] }>("/api/templates/jobs"),
  approveJob: (id: string) => req<{ jobId: string; status: string }>(`/api/templates/jobs/${id}/approve`, { method: "POST" }),
  rejectJob: (id: string) => req<{ jobId: string; status: string }>(`/api/templates/jobs/${id}/reject`, { method: "POST" }),
  retryJob: (id: string) => req<{ jobId: string; retryOf: string }>(`/api/templates/jobs/${id}/retry`, { method: "POST" }),
  intent: (text: string) => req<{ source: string; templateId: string | null; inputs: Record<string, any> }>("/api/templates/intent", { method: "POST", body: JSON.stringify({ text }) }),
  brainHealth: () => req<{ ok: boolean; vaultPath: string; exists: boolean; gitRepo: boolean; reason?: string }>("/api/brain/health"),
  brainTree: (path = "") => req<{ path: string; entries: { name: string; path: string; type: "dir" | "file" }[] }>(`/api/brain/tree?path=${encodeURIComponent(path)}`),
  brainFile: (path: string) => req<{ path: string; content: string }>(`/api/brain/file?path=${encodeURIComponent(path)}`),
  brainSearch: (q: string) => req<{ q: string; results: { path: string; line: number; preview: string }[] }>(`/api/brain/search?q=${encodeURIComponent(q)}`),
  brainLatestDigest: () => req<{ content: string }>("/api/brain/digest/latest"),
  brainPromote: (path: string, opts?: { title?: string; tags?: string; keepOriginal?: boolean }) => req<{ promoted: true; from: string; to: string; archived: boolean }>("/api/brain/promote", { method: "POST", body: JSON.stringify({ path, ...opts }) }),
  vaultStats: () => req<{ lastCommit: any; totalCommits: number; coalescedSavings: number; pendingWrites: number; inFlight: boolean; debounceMs: number }>("/api/status/vault"),
  llmStatus: () => req<{
    ollama: { ok: boolean; model: string; error?: string };
    openrouter: { enabled: boolean; ok: boolean; model: string; error?: string };
    primary: "ollama" | "openrouter";
  }>("/api/status/llm"),
  vaultRetryPush: () => req<{ pushed: boolean; error?: string; aheadBy?: number }>("/api/status/vault/retry-push", { method: "POST" }),
  vaultClearLock: (force = false) => req<{ cleared: boolean; reason?: string; ageMs?: number; forced?: boolean }>(`/api/status/vault/clear-lock${force ? "?force=1" : ""}`, { method: "POST" }),
  listReflections: () => req<{ reflections: { date: string; path: string; preview: string; stats?: any }[]; last?: any }>("/api/reflection"),
  runReflection: (windowHours = 24) => req<{ date: string; path: string; stats: any; reflection: string; generatedAt: string; modelUsed?: string }>("/api/reflection/run", { method: "POST", body: JSON.stringify({ windowHours }) }),
  getReflection: (date: string) => req<{ date: string; path: string; body: string }>(`/api/reflection/${encodeURIComponent(date)}`),
  triggerDigest: (lookbackDays = 7) => req<{ jobId: string }>("/api/tasks/digest", { method: "POST", body: JSON.stringify({ lookbackDays: String(lookbackDays) }) }),
  chat: (messages: { role: "user" | "assistant" | "system"; content: string }[], opts?: {
    attachments?: { contextId: string }[];
    persona?: string;
    continuesTaskRef?: { originalText: string; originalJobId?: string; summary?: string };
  }) => req<{
    kind: "message" | "task";
    text: string;
    jobId?: string;
    templateId?: string;
    requiresApproval?: boolean;
    brainHits?: { path: string; line: number; preview: string }[];
    activePersona?: { id: string; name: string; role: string } | null;
    personaAutoRouted?: { personaId: string | null; score: number; matched: string[] } | null;
    needsContext?: boolean;
    clarification?: {
      originalText: string;
      summary?: string;
      missing?: { name: string; label: string }[];
      templateId?: string;
      intent?: string;
      followUpKind?: string;
      ambiguityKind?: string;
    };
  }>("/api/chat", { method: "POST", body: JSON.stringify({
    messages,
    ...(opts?.attachments ? { attachments: opts.attachments } : {}),
    ...(opts?.persona ? { persona: opts.persona } : {}),
    ...(opts?.continuesTaskRef ? { continuesTaskRef: opts.continuesTaskRef } : {}),
  }) }),
  team: (tasks: { persona?: string; content: string; attachments?: { contextId: string }[] }[]) => req<{
    kind: "team-task";
    tasksDispatched: number;
    tasks: {
      taskIndex: number;
      persona: { id: string; name: string; role: string } | null;
      personaAutoRouted: boolean;
      jobId: string;
      route: "primary" | "auto" | "explicit" | "active";
    }[];
  }>("/api/team", { method: "POST", body: JSON.stringify({ tasks }) }),
  upload: (body: { filename: string; contentBase64: string; target: "context" | "vault"; vaultFolder?: string; mimeType?: string }) => req<{
    ok: true;
    target: "context" | "vault";
    contextId?: string;
    filename?: string;
    bytes: number;
    vaultPath?: string;
    hasExtractedText?: boolean;
    extractedChars?: number;
    extractError?: string;
    ttlSeconds?: number;
    message?: string;
  }>("/api/uploads", { method: "POST", body: JSON.stringify(body) }),
  saveSession: (sessionId: string, messages: { role: string; content: string; jobId?: string }[]) => req<{ saved: true; path: string; sessionId: string }>("/api/chat/save-session", { method: "POST", body: JSON.stringify({ sessionId, messages }) }),
  listPersonas: () => req<{ personas: any[]; activeId: string | null; active: any }>("/api/personas"),
  createPersona: (body: { name: string; jobDescription: string; tone?: string; role?: string; description?: string; responsibilities?: string[]; systemPromptOverride?: string }) => req<{ persona: any }>("/api/personas", { method: "POST", body: JSON.stringify(body) }),
  activatePersona: (id: string | "default") => req<{ active: any }>(`/api/personas/${id}/activate`, { method: "POST" }),
  deactivatePersona: () => req<{ active: null }>("/api/personas/deactivate", { method: "POST" }),
  deletePersona: (id: string) => req<{ deleted: true; removedTemplates?: number }>(`/api/personas/${id}`, { method: "DELETE" }),
  refreshPersonaTemplates: (id: string) => req<{ persona: string; kept: number; added: number; removed: number; ids: string[] }>(`/api/personas/${id}/refresh-templates`, { method: "POST" }),
  listPersonaTemplates: (id: string) => req<{ templates: any[] }>(`/api/personas/${id}/templates`),
  previewPersona: (jobDescription: string) => req<{ role: string; description: string; tone: string; responsibilities: string[] }>("/api/personas/preview", { method: "POST", body: JSON.stringify({ jobDescription }) }),
  peers: () => req<{ self: any; peers: any[]; registry?: any[] }>("/api/peers"),
  registerPeer: (url: string) => req<{ added: boolean; url: string }>("/api/peers/register", { method: "POST", body: JSON.stringify({ url }) }),
  deregisterPeer: (url: string) => req<{ removed: boolean }>(`/api/peers/register?url=${encodeURIComponent(url)}`, { method: "DELETE" }),
  discoverPeers: () => req<{ found: number; tried: number }>("/api/peers/discover", { method: "POST" }),
  workerStatus: () => req<{ running: boolean; managed: boolean; url?: string; port?: number; pid?: number; uptimeMs?: number }>("/api/peers/worker"),
  startWorker: () => req<{ url: string; spawned: boolean; status: any }>("/api/peers/worker/start", { method: "POST" }),
  stopWorker: () => req<{ stopped: true; status: any }>("/api/peers/worker/stop", { method: "POST" }),
  listModels: () => req<{
    default: string;
    models: { name: string; family: string; paramSize?: string; sizeGB?: number; capabilities: { jsonStrict: number; reasoning: number; longForm: number; speed: number; cost: number } }[];
    recommendations: Record<string, string>;
    profiles: Record<string, Record<string, number>>;
  }>("/api/models"),
  setDefaultModel: (name: string) => req<{ default: string; previous: string; ephemeral: boolean; hint: string }>("/api/models/default", { method: "POST", body: JSON.stringify({ name }) }),
  // Open a live event stream for a running job. Returns the
  // EventSource so the caller can attach onmessage / onclose handlers
  // and close() when the consumer unmounts. Use this for streaming
  // long jobs (chat tasks, digest runs) into the UI without polling.
  jobStream: (id: string): EventSource => new EventSource(`/api/tasks/jobs/${encodeURIComponent(id)}/stream`),
  listSkills: () => req<{
    count: number;
    skills: { name: string; description: string; source: "builtin" | "user" | "remote"; applies_to: string[]; bodyChars: number }[];
  }>("/api/skills"),
  getSkill: (name: string) => req<{
    name: string;
    description: string;
    source: "builtin" | "user" | "remote";
    applies_to: string[];
    path: string;
    body: string;
  }>(`/api/skills/${encodeURIComponent(name)}`),
};
