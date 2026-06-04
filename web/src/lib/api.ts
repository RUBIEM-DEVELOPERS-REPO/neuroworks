// Custom error class so 404s on job polls can be detected by callers
// and surface a "server restarted" message instead of a bare "not found".
export class ApiError extends Error {
  status: number;
  hint?: string;
  serverBootAt?: string;
  constructor(status: number, message: string, opts?: { hint?: string; serverBootAt?: string }) {
    super(message);
    this.status = status;
    this.hint = opts?.hint;
    this.serverBootAt = opts?.serverBootAt;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    let hint: string | undefined;
    let serverBootAt: string | undefined;
    try {
      const body = await r.json();
      msg = body.error ?? msg;
      if (typeof body.hint === "string") hint = body.hint;
      if (typeof body.serverBootAt === "string") serverBootAt = body.serverBootAt;
    } catch {}
    throw new ApiError(r.status, msg, { hint, serverBootAt });
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
  brainDiscard: (path: string) => req<{ deleted: string[]; count: number }>("/api/brain/discard", { method: "POST", body: JSON.stringify({ path }) }),
  brainProcessImports: (folder = "_imports") => req<{ jobId: string }>("/api/brain/process-imports", { method: "POST", body: JSON.stringify({ folder }) }),
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
  listTeams: () => req<{
    teams: { id: string; name: string; description: string; members: { personaId: string; role: string }[] }[];
    templates: { id: string; name: string; description?: string; teamId?: string; builtin?: boolean; tasks: { persona: string; content: string }[] }[];
  }>("/api/teams"),
  dispatchTeam: (body: { teamId?: string; templateId?: string; objective?: string }) => req<{
    kind: "team-dispatch";
    label: string;
    tasksDispatched: number;
    tasks: { taskIndex: number; persona: { id: string; name: string; role: string } | null; personaAutoRouted: boolean; jobId: string; route: "primary" | "auto" | "explicit" | "active" }[];
  }>("/api/teams/dispatch", { method: "POST", body: JSON.stringify(body) }),
  upload: (body: { filename: string; contentBase64: string; target: "context" | "vault"; vaultFolder?: string; mimeType?: string; ttlSeconds?: number }) => req<{
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
  externalAgents: () => req<{ agents: { id: string; name: string; kind: string; installed: boolean; configured: boolean; binPath?: string; recentJobs: { last1h: number; last24h: number; succeeded: number; failed: number; total: number }; lastRunAt?: string }[] }>("/api/external-agents"),
  getFeedback: (jobId: string) => req<{ feedback: { rating: "up" | "down"; note?: string; ts: string } | null }>(`/api/feedback?jobId=${encodeURIComponent(jobId)}`),
  postFeedback: (body: { jobId: string; rating: "up" | "down"; note?: string; persona?: string; template?: string; score?: number }) => req<{ ok: true; path: string }>("/api/feedback", { method: "POST", body: JSON.stringify(body) }),
  retryFromFeedback: (jobId: string, note?: string) => req<{ newJobId: string; originalJobId: string }>("/api/feedback/retry", { method: "POST", body: JSON.stringify({ jobId, ...(note ? { note } : {}) }) }),
  calendarActivity: (from?: string, to?: string) => req<{ from: string; to: string; days: { date: string; jobs: { id: string; kind: string; template?: string; title?: string; personaName?: string; status: string; startedAt: string; finishedAt?: string; durationSec?: number; scoreOrNull?: number | null }[] }[] }>(`/api/calendar/activity${from || to ? "?" + new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString() : ""}`),
  calendarAgenda: (date: string) => req<{ date: string; activity: any[]; meetings: { summary: string; start: string; end?: string; location?: string }[]; meetingsError?: string; schedules: any[] }>(`/api/calendar/agenda?date=${encodeURIComponent(date)}`),
  brainSave: (path: string, content: string) => req<{ ok: true; path: string; bytes: number }>("/api/brain/file", { method: "POST", body: JSON.stringify({ path, content }) }),
  brainEnsureSidecar: (path: string, force = false) => req<{ ok: true; sidecarPath: string; sourcePath: string; regenerated: boolean; reason?: string; bytes?: number }>("/api/brain/ensure-sidecar", { method: "POST", body: JSON.stringify({ path, force }) }),
  listDataSources: () => req<{ sources: DataSource[] }>("/api/data-sources"),
  addDataSource: (body: { label: string; kind: "postgres" | "mysql" | "sqlite"; connection: string; notes?: string; readonly: boolean }) =>
    req<{ source: DataSource }>("/api/data-sources", { method: "POST", body: JSON.stringify(body) }),
  removeDataSource: (id: string) => req<{ ok: true }>(`/api/data-sources/${encodeURIComponent(id)}`, { method: "DELETE" }),
  testDataSource: (id: string) => req<{ ok: boolean; rowCount?: number; error?: string }>(`/api/data-sources/${encodeURIComponent(id)}/test`, { method: "POST" }),
  queryDataSource: (id: string, sql: string, limit?: number) => req<{ rows: any[]; columns: string[]; rowCount: number; truncated: boolean }>(`/api/data-sources/${encodeURIComponent(id)}/query`, { method: "POST", body: JSON.stringify({ sql, ...(limit ? { limit } : {}) }) }),
  describeDataSource: (id: string) => req<{ tables: { name: string; columns: { name: string; type: string }[] }[] }>(`/api/data-sources/${encodeURIComponent(id)}/schema`),
  listCompanyFiles: () => req<{ entries: { name: string; path: string; type: "dir" | "file" }[]; note?: string }>("/api/data-sources/company-files"),
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
  listGovernance: () => req<{ policies: GovernancePolicy[]; prefixBytes: number; prefixActive: boolean }>("/api/governance"),
  getGovernance: (name: string) => req<{ name: string; path: string; body: string }>(`/api/governance/${encodeURIComponent(name)}`),
  deleteGovernance: (name: string) => req<{ ok: true; deleted: string }>(`/api/governance/${encodeURIComponent(name)}`, { method: "DELETE" }),
  invalidateGovernance: () => req<{ ok: true }>("/api/governance/invalidate", { method: "POST" }),
  listSchedules: () => req<{ schedules: Schedule[] }>("/api/schedules"),
  createSchedule: (body: {
    name: string;
    templateId: string;
    inputs?: Record<string, unknown>;
    cadence: Cadence;
    enabled?: boolean;
  }) => req<{ schedule: Schedule }>("/api/schedules", { method: "POST", body: JSON.stringify(body) }),
  updateSchedule: (id: string, patch: Partial<Pick<Schedule, "name" | "templateId" | "inputs" | "cadence" | "enabled">>) =>
    req<{ schedule: Schedule }>(`/api/schedules/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteSchedule: (id: string) => req<{ ok: true }>(`/api/schedules/${encodeURIComponent(id)}`, { method: "DELETE" }),
  sttStatus: () => req<{ enabled: boolean; provider: string; hint?: string }>("/api/stt/status"),
  transcribe: (audioBase64: string) => req<{ ok: true; text: string; language: string | null }>("/api/stt", { method: "POST", body: JSON.stringify({ audioBase64 }) }),
  terminalStatus: () => req<{ enabled: boolean; cwd: string; shell: "powershell" | "bash"; platform: string; hint?: string }>("/api/terminal/status"),
  terminalExec: (command: string, cwd?: string) => req<{
    ok: true;
    command: string;
    exitCode: number | null;
    timedOut: boolean;
    stdout: string;
    stderr: string;
    cwd: string;
    elapsedMs: number;
  }>("/api/terminal/exec", { method: "POST", body: JSON.stringify({ command, ...(cwd ? { cwd } : {}) }) }),
};

export type DataSource = {
  id: string;
  label: string;
  kind: "postgres" | "mysql" | "sqlite";
  connection: string;
  notes?: string;
  readonly: boolean;
  createdAt: string;
};

export type GovernancePolicy = {
  path: string;
  name: string;
  bytes: number;
  lastModified: string;
};

export type Cadence = {
  daysOfWeek: number[];
  hour: number;
  minute: number;
};

export type Schedule = {
  id: string;
  name: string;
  templateId: string;
  inputs: Record<string, unknown>;
  cadence: Cadence;
  enabled: boolean;
  createdAt: string;
  lastFiredAt?: string;
  lastJobId?: string;
  lastError?: string;
  fireCount: number;
  nextFireAt?: number | null;
};
