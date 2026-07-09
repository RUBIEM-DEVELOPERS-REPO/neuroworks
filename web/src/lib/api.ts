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

// Session token for the identity layer — stored client-side and sent on every
// request so the server can attribute activity to the logged-in user.
const TOKEN_KEY = "neuroworks.token";
export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(token: string | null): void {
  try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  let r: Response;
  try {
    r = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) } });
  } catch (e: any) {
    // fetch() rejects on network errors only (server down, DNS failure, CORS,
    // aborted). The browser gives us a cryptic TypeError with message like
    // "Failed to fetch" or "load failed" — unwrap to something actionable.
    const reason = e?.message ?? String(e);
    const isNetwork = e instanceof TypeError || /fetch|network|connect|abort|dns|econnrefused|enotfound/i.test(reason);
    throw new ApiError(0, isNetwork
      ? `Cannot reach the server at ${path}. Make sure the API server (port 7471) is running.`
      : reason);
  }
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

// Knowledge Packs.
export type KnowledgePack = {
  sectorId: string;
  name: string;
  installed: boolean;
  files: { path: string; title: string; wordCount: number }[];
  kind?: "sector" | "dataset";
  meta?: { recordCount?: number; avgConfidence?: number; rootHash?: string; source?: string; createdAt?: string };
};
export type DatasetStage = { stage: string; in: number; out: number; note: string };
export type Dataset = {
  id: string;
  name: string;
  sector?: string;
  source: string;
  createdAt: string;
  rawCount: number;
  recordCount: number;
  reviewQueue: number;
  avgConfidence: number;
  rootHash: string;
  fields: string[];
  stages: DatasetStage[];
  outputs: { csv: string; jsonl: string; rag: string; card: string };
};
export type QualitySummary = {
  totalFlags: number;
  upvotes: number;
  downvotes: number;
  rate: number;
  topCategories: { category: string; count: number }[];
  recentFlags: {
    jobId: string;
    rating: "up" | "down";
    note?: string;
    persona?: string;
    category?: string;
    ts: string;
  }[];
};
export type QualityFlag = {
  jobId: string;
  rating: "up" | "down";
  note?: string;
  category?: string;
  language?: "en" | "sn" | "nd";
  persona?: string;
  template?: string;
  ts: string;
};

export const api = {
  health: () => req<{ ok: boolean; name: string; version: string; model: string; port: number; ready: boolean; missing: string[]; inflightJobs?: number; peers?: string[] }>("/api/health"),
  status: () => req<any>("/api/status"),
  listRepos: () => req<{ repos: any[] }>("/api/repos"),
  getRepo: (owner: string, name: string) => req<any>(`/api/repos/${owner}/${name}`),
  listTemplates: () => req<{ roles: Role[]; templates: Template[] }>("/api/templates"),
  runTemplate: (id: string, inputs: Record<string, any>) => req<{ jobId: string; requiresApproval: boolean; status: string }>(`/api/templates/run/${id}`, { method: "POST", body: JSON.stringify(inputs) }),
  getJob: (id: string) => req<any>(`/api/templates/jobs/${id}`),
  listJobs: () => req<{ jobs: any[] }>("/api/templates/jobs"),
  // Historical median durations per task type (+ global fallback) so a running
  // task can show an ETA. See server jobs.etaStats().
  taskEtaStats: () => req<{ byType: Record<string, { medianMs: number; count: number }>; globalMedianMs: number; count: number }>("/api/tasks/eta"),
  // Hybrid workforce — tasks waiting on the human, resume-with-input, and the
  // where-does-time-go decomposition (agent runtime vs waiting-on-human vs
  // logged human work).
  tasksWaiting: () => req<{ waiting: WaitingTask[] }>("/api/tasks/waiting"),
  submitHumanInput: (id: string, responses: { prompt: string; response: string }[], note?: string) =>
    req<{ jobId: string; continuesJobId: string }>(`/api/tasks/jobs/${encodeURIComponent(id)}/human-input`, { method: "POST", body: JSON.stringify({ responses, note }) }),
  timeAnalysis: (days = 30) => req<TimeAnalysis>(`/api/tasks/time-analysis?days=${days}`),
  workforceCost: (days = 30) => req<WorkforceCost>(`/api/cost/workforce?days=${days}`),
  addHumanWork: (body: { rows?: { email: string; date: string; hours: number; description?: string }[]; csv?: string; source?: "upload" | "connector" | "manual" }) =>
    req<{ added: number; errors: { row: number; error: string }[] }>("/api/cost/human-work", { method: "POST", body: JSON.stringify(body) }),
  updatePersona: (id: string, patch: { workMode?: WorkMode; tone?: string; description?: string; role?: string; language?: "en" | "sn" | "nd" }) =>
    req<{ persona: any }>(`/api/personas/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  // Paynow (Zimbabwe) gateway — sits alongside Stripe.
  paynowStatus: () => req<{ enabled: boolean; provider: "paynow"; integrationId?: string; detail?: string }>("/api/payments/paynow/status"),
  createPaynowLink: (body: { amount: number; description: string; reference?: string; email?: string }) =>
    req<{ payment: { reference: string; amount: number; browserUrl: string; pollUrl: string; status: string } }>("/api/payments/paynow/links", { method: "POST", body: JSON.stringify(body) }),
  // Self-signup + admin approval + org management (Admin page).
  signup: (body: { name: string; email: string; password: string; department?: string; title?: string }) =>
    req<{ ok: true; user: User; message: string }>("/api/auth/signup", { method: "POST", body: JSON.stringify(body) }),
  listPendingUsers: () => req<{ pending: User[] }>("/api/users/pending"),
  approveUser: (id: string, body: { role?: UserRole; department?: string; workMode?: WorkMode; title?: string } = {}) =>
    req<{ user: User }>(`/api/users/${encodeURIComponent(id)}/approve`, { method: "POST", body: JSON.stringify(body) }),
  rejectUser: (id: string) => req<{ ok: true }>(`/api/users/${encodeURIComponent(id)}/reject`, { method: "POST" }),
  listSessions: () => req<{ sessions: { id: string; userId: string; name?: string; email?: string; role?: UserRole; createdAt: string; lastSeenAt: string }[] }>("/api/users/sessions"),
  revokeSession: (id: string) => req<{ ok: true }>("/api/users/sessions/revoke", { method: "POST", body: JSON.stringify({ id }) }),
  orgOverview: () => req<{ total: number; pending: number; disabled: number; byDepartment: { department: string; count: number }[]; byLayer: Record<AccessLayer, number>; byWorkMode: Record<"agent" | "hybrid" | "human" | "unset", number> }>("/api/users/overview"),
  // Layer bundles — what each access level sees (Add-user modal preview).
  accessLayers: () => req<{ layers: Record<AccessLayer, { label: string; sees: string[]; hidden: string[] }> }>("/api/auth/layers"),
  paynowPoll: (pollUrl: string) =>
    req<{ status: { reference?: string; paynowReference?: string; amount?: number; status: string; paid: boolean; hashValid: boolean } }>("/api/payments/paynow/poll", { method: "POST", body: JSON.stringify({ pollUrl }) }),
  approveJob: (id: string) => req<{ jobId: string; status: string }>(`/api/templates/jobs/${id}/approve`, { method: "POST" }),
  rejectJob: (id: string) => req<{ jobId: string; status: string }>(`/api/templates/jobs/${id}/reject`, { method: "POST" }),
  retryJob: (id: string) => req<{ jobId: string; retryOf: string }>(`/api/templates/jobs/${id}/retry`, { method: "POST" }),
  intent: (text: string) => req<{ source: string; templateId: string | null; inputs: Record<string, any> }>("/api/templates/intent", { method: "POST", body: JSON.stringify({ text }) }),
  brainHealth: () => req<{ ok: boolean; vaultPath: string; exists: boolean; gitRepo: boolean; reason?: string }>("/api/brain/health"),
  brainTree: (path = "") => req<{ path: string; entries: { name: string; path: string; type: "dir" | "file" }[] }>(`/api/brain/tree?path=${encodeURIComponent(path)}`),
  brainFile: (path: string) => req<{ path: string; content: string }>(`/api/brain/file?path=${encodeURIComponent(path)}`),
  // Relative URL — downloads through the Vite proxy (same-origin). Works for text + binary.
  brainDownloadUrl: (path: string) => `/api/brain/download?path=${encodeURIComponent(path)}`,
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
  // Hand-off relay — sequential team workflow (agents pass work down a chain).
  startHandoff: (body: { objective: string; teamId?: string; members?: { personaId: string; role?: string }[]; label?: string }) =>
    req<{ runId: string; jobId: string; roster: { personaId: string; role: string; name: string }[] }>("/api/handoff", { method: "POST", body: JSON.stringify(body) }),
  listHandoffs: () => req<{ runs: HandoffRun[] }>("/api/handoff"),
  getHandoff: (id: string) => req<{ run: HandoffRun }>(`/api/handoff/${encodeURIComponent(id)}`),
  // Workforce contact book — AI agents + human team, grouped by department.
  getWorkforce: () => req<{ departments: WorkforceDepartment[]; counts: { agents: number; people: number; departments: number } }>("/api/workforce"),
  // Scan an uploaded doc (any type) for people and populate the contact book.
  importContacts: (body: { filename: string; contentBase64: string }) =>
    req<{ scanned: number; added: { name: string; email: string; department?: string }[]; skipped: { name: string; reason: string }[] }>("/api/workforce/import", { method: "POST", body: JSON.stringify(body) }),
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
  // Onboarding.
  getOnboarding: () => req<OnboardingData>("/api/onboarding"),
  setOnboarding: (body: { completed: boolean; sector?: string; customSectorName?: string; language?: string; orgName?: string }) =>
    req<{ state: OnboardingState }>("/api/onboarding", { method: "PUT", body: JSON.stringify(body) }),
  getOnboardingContext: (sector?: string) =>
    req<{ sector: string; context: string }>(`/api/onboarding/context${sector ? `?sector=${encodeURIComponent(sector)}` : ""}`),

  listDataSources: () => req<{ sources: DataSource[] }>("/api/data-sources"),
  addDataSource: (body: { label: string; kind: DataSourceKind; connection: string; notes?: string; department?: string; readonly: boolean }) =>
    req<{ source: DataSource }>("/api/data-sources", { method: "POST", body: JSON.stringify(body) }),
  // Department-specific company data.
  listDepartmentData: (department?: string) =>
    req<{ departments: { department: string; count: number }[]; data: DepartmentDatum[] }>(`/api/data-sources/departments${department ? `?department=${encodeURIComponent(department)}` : ""}`),
  addDepartmentDatum: (body: { department: string; title: string; content: string }) =>
    req<{ datum: DepartmentDatum }>("/api/data-sources/departments", { method: "POST", body: JSON.stringify(body) }),
  updateDepartmentDatum: (id: string, patch: { department?: string; title?: string; content?: string }) =>
    req<{ datum: DepartmentDatum }>(`/api/data-sources/departments/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeDepartmentDatum: (id: string) => req<{ ok: true }>(`/api/data-sources/departments/${encodeURIComponent(id)}`, { method: "DELETE" }),
  // Scan an uploaded doc (any type) for department facts and populate the page.
  importDepartmentData: (body: { filename: string; contentBase64: string; department?: string }) =>
    req<{ scanned: number; added: DepartmentDatum[] }>("/api/data-sources/departments/import", { method: "POST", body: JSON.stringify(body) }),
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
  modelCatalog: () => req<{ catalog: { name: string; size: string; blurb: string; installed: boolean }[] }>("/api/models/catalog"),
  deleteModel: (name: string) => req<{ ok: true; removed: string }>(`/api/models/installed/${encodeURIComponent(name)}`, { method: "DELETE" }),
  // Bring-your-own model providers (cloud APIs the user already uses).
  listModelProviders: () => req<{
    providers: { id: string; label: string; kind: string; baseUrl: string; model: string; active: boolean; keyPrefix: string; createdAt: string }[];
    kinds: Record<string, { label: string; baseUrl: string; modelHint: string }>;
    active: { model: string; baseUrl: string } | null;
  }>("/api/models/providers"),
  addModelProvider: (body: { kind: string; model: string; apiKey: string; label?: string; baseUrl?: string; active?: boolean }) =>
    req<{ provider: any }>("/api/models/providers", { method: "POST", body: JSON.stringify(body) }),
  activateModelProvider: (id: string) => req<{ provider: any }>(`/api/models/providers/${encodeURIComponent(id)}/activate`, { method: "POST" }),
  removeModelProvider: (id: string) => req<{ ok: true }>(`/api/models/providers/${encodeURIComponent(id)}`, { method: "DELETE" }),
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
  // Relative URL — the browser downloads it through the Vite proxy (same-origin).
  governanceDownloadUrl: (name: string) => `/api/governance/${encodeURIComponent(name)}/download`,
  // Constraint extraction & review.
  getConstraints: (policy?: string) => req<{ constraints: ExtractedConstraint[]; byPolicy: Record<string, ExtractedConstraint[]> }>(
    `/api/governance/constraints${policy ? `?policy=${encodeURIComponent(policy)}` : ""}`),
  extractConstraints: (name: string) => req<{ policyName: string; constraints: ExtractedConstraint[]; count: number }>(
    `/api/governance/${encodeURIComponent(name)}/extract`, { method: "POST" }),
  updateConstraint: (name: string, constraintId: string, patch: Partial<ExtractedConstraint>) =>
    req<{ constraint: ExtractedConstraint }>(`/api/governance/${encodeURIComponent(name)}/constraints/${encodeURIComponent(constraintId)}`, { method: "PUT", body: JSON.stringify(patch) }),
  checkAction: (action: string, policy?: string) => req<{ action: string; violations: any[]; constrained: boolean; summary: string }>(
    "/api/governance/check-action", { method: "POST", body: JSON.stringify({ action, policy }) }),
  // Department Marketplace.
  listDepartments: () => req<{ departments: any[] }>("/api/departments"),
  applyDepartment: (id: string) => req<any>(`/api/departments/${encodeURIComponent(id)}/apply`, { method: "POST" }),
  listSchedules: () => req<{ schedules: Schedule[] }>("/api/schedules"),
  createSchedule: (body: {
    name: string;
    templateId: string;
    inputs?: Record<string, unknown>;
    cadence: Cadence;
    enabled?: boolean;
    deliver?: ScheduleDelivery;
  }) => req<{ schedule: Schedule }>("/api/schedules", { method: "POST", body: JSON.stringify(body) }),
  updateSchedule: (id: string, patch: Partial<Pick<Schedule, "name" | "templateId" | "inputs" | "cadence" | "enabled" | "deliver">>) =>
    req<{ schedule: Schedule }>(`/api/schedules/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteSchedule: (id: string) => req<{ ok: true }>(`/api/schedules/${encodeURIComponent(id)}`, { method: "DELETE" }),

  listPresets: () => req<{ presets: Preset[] }>("/api/presets"),
  applyPreset: (id: string, body: { deliverEmail?: string; createSchedules?: boolean }) =>
    req<PresetApplyResult>(`/api/presets/${encodeURIComponent(id)}/apply`, { method: "POST", body: JSON.stringify(body) }),
  integrationsCatalog: () => req<{ providers: IntegrationProvider[] }>("/api/integrations/catalog"),
  listIntegrations: () => req<{ connections: IntegrationConnection[] }>("/api/integrations"),
  addIntegration: (providerId: string, label: string, values: Record<string, string>) =>
    req<{ connection: IntegrationConnection }>("/api/integrations", { method: "POST", body: JSON.stringify({ providerId, label, values }) }),
  testIntegration: (id: string) => req<{ ok: boolean; detail: string }>(`/api/integrations/${encodeURIComponent(id)}/test`, { method: "POST" }),
  testAllIntegrations: () => req<{ results: { id: string; ok: boolean; detail: string }[] }>("/api/integrations/test-all", { method: "POST" }),
  removeIntegration: (id: string) => req<{ ok: true }>(`/api/integrations/${encodeURIComponent(id)}`, { method: "DELETE" }),
  // Plan-approval: draft a plan for a task and park it for human sign-off.
  planTask: (task: string) => req<{ jobId: string; status: string }>("/api/tasks/plan", { method: "POST", body: JSON.stringify({ task }) }),
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

  // Company-system connectors (outbound authenticated HTTP to existing systems).
  connectorsCatalog: () => req<{ authTypes: ConnectorAuthCatalog[] }>("/api/connectors/catalog"),
  listConnectors: () => req<{ connectors: Connector[] }>("/api/connectors"),
  getConnector: (id: string) => req<{ connector: Connector }>(`/api/connectors/${encodeURIComponent(id)}`),
  addConnector: (body: ConnectorInput) => req<{ connector: Connector }>("/api/connectors", { method: "POST", body: JSON.stringify(body) }),
  updateConnector: (id: string, body: Partial<ConnectorInput>) =>
    req<{ connector: Connector }>(`/api/connectors/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
  removeConnector: (id: string) => req<{ ok: true }>(`/api/connectors/${encodeURIComponent(id)}`, { method: "DELETE" }),
  testConnector: (id: string) => req<{ ok: boolean; detail: string }>(`/api/connectors/${encodeURIComponent(id)}/test`, { method: "POST" }),
  callConnector: (id: string, body: { method?: string; path: string; query?: Record<string, any>; body?: any; headers?: Record<string, string> }) =>
    req<{ result: ConnectorCallResult }>(`/api/connectors/${encodeURIComponent(id)}/call`, { method: "POST", body: JSON.stringify(body) }),

  // Payments (Stripe gateway).
  paymentStatus: () => req<PaymentGatewayStatus>("/api/payments/status"),
  createPaymentLink: (body: { amount: number; description: string; currency?: string; productName?: string }) =>
    req<{ link: PaymentLink }>("/api/payments/links", { method: "POST", body: JSON.stringify(body) }),
  listPrices: () => req<{ prices: PaymentPrice[] }>("/api/payments/prices"),
  createCheckout: (body: { priceId: string; mode?: "subscription" | "payment"; customerEmail?: string; quantity?: number }) =>
    req<{ session: { id: string; url: string } }>("/api/payments/checkout", { method: "POST", body: JSON.stringify(body) }),
  billingPortal: (body: { customerId: string; returnUrl?: string }) =>
    req<{ session: { id: string; url: string } }>("/api/payments/portal", { method: "POST", body: JSON.stringify(body) }),
  listPayments: (limit = 20) => req<{ payments: PaymentRecord[] }>(`/api/payments/payments?limit=${limit}`),

  // Auth (identity layer) + Users directory.
  login: (email: string, password: string) =>
    req<{ ok: true; user: User; token: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => req<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  session: () => req<{ user: User | null }>("/api/auth/session"),
  loginEvents: (limit = 50) => req<{ events: LoginEvent[] }>(`/api/auth/login-events?limit=${limit}`),
  listUsers: () => req<{ users: User[] }>("/api/users"),
  addUser: (body: { name: string; email: string; role?: UserRole; title?: string; department?: string; password?: string; workMode?: WorkMode; salaryMonthly?: number }) =>
    req<{ user: User }>("/api/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (id: string, patch: Partial<{ name: string; email: string; role: UserRole; title: string; department: string; status: UserStatus; workMode: WorkMode | null; salaryMonthly: number | null }>) =>
    req<{ user: User }>(`/api/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  setUserPassword: (id: string, password: string) =>
    req<{ ok: true }>(`/api/users/${encodeURIComponent(id)}/password`, { method: "POST", body: JSON.stringify({ password }) }),
  deleteUser: (id: string) => req<{ ok: true }>(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE" }),
  // Knowledge Packs.
  listKnowledgePacks: () => req<{ packs: KnowledgePack[] }>("/api/knowledge-packs"),
  installKnowledgePack: (sectorId: string) =>
    req<{ ok: boolean; files: string[] }>(`/api/knowledge-packs/${encodeURIComponent(sectorId)}/install`, { method: "POST" }),
  // ADRS data pipeline — published datasets.
  listDatasets: () => req<{ datasets: Dataset[] }>("/api/datasets"),
  getDataset: (id: string) => req<{ dataset: Dataset }>(`/api/datasets/${encodeURIComponent(id)}`),
  publishDataset: (body: { name: string; sector?: string; keyField?: string; confidenceThreshold?: number; records?: any[]; sourceLabel?: string; query?: string }) =>
    req<{ ok: true; dataset: Dataset }>("/api/datasets/publish", { method: "POST", body: JSON.stringify(body) }),
  deleteDataset: (id: string) => req<{ ok: true }>(`/api/datasets/${encodeURIComponent(id)}`, { method: "DELETE" }),
  // Omnisignal — multi-source acquisition feeding ADRS.
  omniKinds: () => req<{ kinds: { kind: string; needs: string; description: string }[] }>("/api/omnisignal/kinds"),
  omniAcquire: (sources: any[]) =>
    req<{ records: any[]; report: { source: string; kind: string; category: string; count: number; error?: string }[]; total: number }>(
      "/api/omnisignal/acquire", { method: "POST", body: JSON.stringify({ sources }) }),
  omniPublish: (body: { name: string; sources: any[]; sector?: string; keyField?: string }) =>
    req<{ acquisition: { report: any[]; total: number }; published?: { manifest: Dataset }; note?: string }>(
      "/api/omnisignal/publish", { method: "POST", body: JSON.stringify(body) }),
  datasetOutputUrl: (id: string, kind: "csv" | "jsonl" | "rag" | "card") =>
    `/api/datasets/${encodeURIComponent(id)}/output/${kind}`,
  // Quality dashboard.
  submitQualityFlag: (body: { jobId: string; rating: "up" | "down"; note?: string; category?: string; language?: "en" | "sn" | "nd"; persona?: string; template?: string; score?: number }) =>
    req<{ ok: true; flag: QualityFlag }>("/api/quality/flag", { method: "POST", body: JSON.stringify(body) }),
  getQualitySummary: () => req<QualitySummary>("/api/quality/summary"),
  getQualityFlags: (since?: string) =>
    req<{ flags: QualityFlag[] }>(`/api/quality/flags${since ? `?since=${encodeURIComponent(since)}` : ""}`),
  getLowQualityRuns: (threshold?: number, minFlags?: number) =>
    req<{ runs: { task: string; count: number; rate: number }[] }>(
      `/api/quality/low-quality?threshold=${threshold ?? 0.5}&minFlags=${minFlags ?? 3}`),
  // Cost monitoring.
  getCostSummary: () => req<any>("/api/cost/summary"),
  getCostRecords: (since?: string) =>
    req<{ records: any[] }>(`/api/cost/records${since ? `?since=${encodeURIComponent(since)}` : ""}`),
  // Audit log.
  queryAudit: (params?: { limit?: number; offset?: number; level?: string; actor?: string; action?: string; since?: string; jobId?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    if (params?.level) q.set("level", params.level);
    if (params?.actor) q.set("actor", params.actor);
    if (params?.action) q.set("action", params.action);
    if (params?.since) q.set("since", params.since);
    if (params?.jobId) q.set("jobId", params.jobId);
    return req<{ events: any[]; total: number }>(`/api/audit?${q.toString()}`);
  },
  // SkillForge.
  draftSkill: (intent: string, taskSample: string, failureReason?: string) =>
    req<{ skill: any; raw: string }>("/api/skill-forge/draft", { method: "POST", body: JSON.stringify({ intent, taskSample, failureReason }) }),
  saveSkill: (intent: string, raw: string) =>
    req<{ ok: boolean; path: string; skill?: any }>("/api/skill-forge/save", { method: "POST", body: JSON.stringify({ intent, raw }) }),
  // Orchestrator.
  startOrchestration: (objective: string) =>
    req<{ id: string; label: string; status: string; subTasks: any[] }>("/api/orchestrate/run", { method: "POST", body: JSON.stringify({ objective }) }),
  listOrchestrations: () => req<{ runs: any[] }>("/api/orchestrate/runs"),
  getOrchestration: (id: string) => req<{ run: any }>(`/api/orchestrate/runs/${encodeURIComponent(id)}`),
};

// Access layers: superadmin (money + secrets), admin (people + work), staff
// (own department's workbench). member/viewer are legacy aliases of staff.
export type UserRole = "superadmin" | "admin" | "staff" | "member" | "viewer";
export type AccessLayer = "superadmin" | "admin" | "staff";
export const layerOfRole = (role?: UserRole): AccessLayer =>
  role === "superadmin" ? "superadmin" : role === "admin" ? "admin" : "staff";
export type UserStatus = "active" | "invited" | "disabled" | "pending";
export type WorkMode = "agent" | "hybrid" | "human";
export type User = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  title?: string;
  department?: string;
  status: UserStatus;
  // Hybrid workforce: how much of this person's role the system performs.
  workMode?: WorkMode;
  // Monthly salary (ZAR) — feeds the Cost page's human-cost side. Admin-only UI.
  salaryMonthly?: number;
  hasPassword: boolean;
  createdAt: string;
  lastLoginAt?: string;
  loginCount: number;
};

// A task parked in waiting_on_human — the structured ask the operator answers.
export type WaitingItem = { type: "answer" | "upload" | "approval" | "action"; prompt: string };
export type WaitingTask = {
  id: string;
  title: string;
  persona?: string;
  startedAt: string;
  waitingSince: string;
  items: WaitingItem[];
  reason?: string;
  task?: string;
};

export type TimeAnalysis = {
  days: number;
  totals: { agentMs: number; humanWaitMs: number; openWaitMs: number; humanWorkMs: number; totalMs: number; pct: { agent: number; humanWait: number; humanWork: number } };
  verdict: string;
  slowestAgentTypes: { type: string; ms: number }[];
  longestWaits: { title: string; waitMs: number; open: boolean }[];
  humanWorkHours: number;
  jobCount: number;
};

export type WorkforceCost = {
  days: number;
  agent: { costUsd: number; calls: number };
  human: {
    totalHours: number;
    costZar: number;
    unpricedHours: number;
    workHoursPerMonth: number;
    byUser: { email: string; name?: string; workMode?: WorkMode; hours: number; entries: number; hourlyRateZar?: number; costZar?: number; salarySet: boolean }[];
    byDay: { date: string; hours: number }[];
  };
};
export type LoginEvent = { at: string; userId?: string; email: string; name?: string; ok: boolean; reason?: string; ip?: string; userAgent?: string };

export type ConnectorAuthType = "none" | "apiKey" | "bearer" | "basic" | "header";
export type ConnectorAuthCatalog = { type: ConnectorAuthType; label: string; fields: { name: string; label: string; secret: boolean }[] };
export type ConnectorEndpoint = { name: string; method: string; path: string; description?: string; query?: string[]; body?: string };
export type Connector = {
  id: string;
  label: string;
  baseUrl: string;
  description?: string;
  auth: { type: ConnectorAuthType; in?: "header" | "query"; name?: string; username?: string; secretSet: boolean };
  headers?: Record<string, string>;
  endpoints?: ConnectorEndpoint[];
  writeEnabled: boolean;
  createdAt: string;
  lastTest?: { ok: boolean; detail: string; at: string };
};
export type ConnectorInput = {
  label: string;
  baseUrl: string;
  description?: string;
  auth?: { type: ConnectorAuthType; in?: "header" | "query"; name?: string; username?: string; value?: string; token?: string; password?: string };
  headers?: Record<string, string>;
  endpoints?: ConnectorEndpoint[];
  writeEnabled?: boolean;
};
export type ConnectorCallResult = {
  ok: boolean; status: number; url: string; method: string;
  contentType?: string; body: any; truncated?: boolean; error?: string;
};

export type PaymentGatewayStatus = {
  enabled: boolean; provider: "stripe"; currency: string;
  publishableKey?: string; livemode?: boolean; account?: string; detail?: string;
};
export type PaymentLink = { id: string; url: string; amount: number; currency: string; description: string };
export type PaymentPrice = { id: string; nickname?: string; productName?: string; unitAmount: number | null; currency: string; interval?: string };
export type PaymentRecord = { id: string; amount: number; currency: string; status: string; description?: string; created: number; receiptEmail?: string };

export type IntegrationProvider = {
  id: string;
  name: string;
  category: "messaging" | "social" | "productivity" | "dev";
  auth: "token" | "webhook" | "oauth";
  fields: { name: string; label: string; type: "text" | "password" | "url"; placeholder?: string; secret?: boolean; required?: boolean }[];
  docsUrl?: string;
  note?: string;
  testable: boolean;
};

export type ConnectionTest = { ok: boolean; detail: string; at: string };
export type IntegrationConnection = {
  id: string;
  providerId: string;
  providerName: string;
  category: string;
  label: string;
  config: Record<string, string>;
  secretFields: string[];
  createdAt: string;
  lastTest?: ConnectionTest;
};

export type DataSourceKind = "postgres" | "mysql" | "sqlite" | "mssql" | "mongodb";

export type DataSource = {
  id: string;
  label: string;
  kind: DataSourceKind;
  connection: string;
  notes?: string;
  department?: string;
  readonly: boolean;
  createdAt: string;
};

export type DepartmentDatum = {
  id: string;
  department: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

// Hand-off relay (sequential team workflow).
export type HandoffStep = {
  index: number;
  personaId: string;
  personaName: string;
  role: string;
  status: "pending" | "running" | "done" | "failed";
  output: string;
  status_note: string;
  handoffTo: string | null;
  complete: boolean;
  jobId?: string;
  startedAt?: string;
  endedAt?: string;
  elapsedMs?: number;
};
export type HandoffRun = {
  id: string;
  objective: string;
  teamId?: string;
  label: string;
  roster: { personaId: string; role: string; name: string }[];
  steps: HandoffStep[];
  status: "running" | "completed" | "exhausted" | "failed";
  finalReport: string;
  jobId?: string;
  createdAt: string;
  updatedAt: string;
};

// Workforce contact book.
export type WorkforceAgent = {
  kind: "agent";
  id: string;
  name: string;
  role: string;
  description: string;
  responsibilities: string[];
  department: string;
  builtin: boolean;
  contact: { activate: string; chat: string };
};
export type WorkforcePerson = {
  kind: "human";
  id: string;
  name: string;
  email: string;
  role: string;
  title?: string;
  department: string;
  status: string;
  workMode?: WorkMode;
  // Superadmin-only (server redacts for everyone else).
  salaryMonthly?: number;
};
export type WorkforceDepartment = { department: string; agents: WorkforceAgent[]; people: WorkforcePerson[] };

export type ExtractedConstraint = {
  id: string;
  policyName: string;
  rule: string;
  severity: "hard" | "soft";
  category: string;
  details?: string;
  reviewed: boolean;
  accepted: boolean;
  createdAt: string;
};

export type GovernancePolicy = {
  path: string;
  name: string;
  bytes: number;
  lastModified: string;
  reference?: boolean;   // manual/reference doc — listed + downloadable, not a prompt guardrail
};

export type Cadence = {
  daysOfWeek: number[];
  hour: number;
  minute: number;
};

export type ScheduleDelivery = { email?: string };
export type Schedule = {
  id: string;
  name: string;
  templateId: string;
  inputs: Record<string, unknown>;
  cadence: Cadence;
  enabled: boolean;
  deliver?: ScheduleDelivery;
  createdAt: string;
  lastFiredAt?: string;
  lastJobId?: string;
  lastError?: string;
  fireCount: number;
  nextFireAt?: number | null;
};

// Onboarding types.
export type SectorInfo = {
  id: string;
  name: string;
  nameShona?: string;
  nameNdebele?: string;
  description: string;
  icon: string;
  suggestedDepartments?: string[];
  suggestedIntegrations?: string[];
};
export type OnboardingState = {
  completed: boolean;
  sector?: string;
  customSectorName?: string;
  language: string;
  orgName?: string;
  completedAt?: string;
};
export type OnboardingData = {
  state: OnboardingState;
  sectors: SectorInfo[];
};

export type Preset = {
  id: string;
  name: string;
  tagline: string;
  personaId: string;
  recommendedSkills: string[];
  recommendedIntegrations: string[];
  schedules?: { name: string; templateId: string; cadence: Cadence; emailResult?: boolean }[];
};
export type PresetApplyResult = {
  preset: Preset;
  persona: { id: string; name: string; role: string };
  templatesEnsured: number;
  schedulesCreated: { id: string; name: string; emailTo?: string }[];
  missingIntegrations: string[];
};




