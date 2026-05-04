import { randomUUID } from "node:crypto";

export type Job = {
  id: string;
  kind: string;
  status: "pending" | "awaiting-approval" | "running" | "succeeded" | "failed" | "rejected";
  startedAt: string;
  finishedAt?: string;
  log: string[];
  result?: unknown;
  error?: string;
  template?: string;
  title?: string;
  inputs?: Record<string, unknown>;
  requiresApproval?: boolean;
  approvedAt?: string;
  rejectedAt?: string;
};

const jobs = new Map<string, Job>();
const RECENT = 50;

export function newJob(kind: string): Job {
  const j: Job = { id: randomUUID(), kind, status: "pending", startedAt: new Date().toISOString(), log: [] };
  jobs.set(j.id, j);
  if (jobs.size > RECENT) {
    const oldest = [...jobs.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
    if (oldest) jobs.delete(oldest.id);
  }
  return j;
}

export function getJob(id: string) { return jobs.get(id); }
export function listJobs() { return [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)); }

export type ProgressUpdater = (patch: Record<string, unknown>) => void;

export async function runJob<T>(j: Job, fn: (push: (msg: string) => void, progress: ProgressUpdater) => Promise<T>): Promise<void> {
  j.status = "running";
  const push = (m: string) => { j.log.push(`[${new Date().toISOString()}] ${m}`); };
  const progress: ProgressUpdater = (patch) => {
    j.result = { ...(j.result ?? {}), ...patch } as Record<string, unknown>;
  };
  try {
    const final = await fn(push, progress);
    if (final && typeof final === "object") {
      j.result = { ...(j.result ?? {}), ...(final as Record<string, unknown>) };
    } else if (final !== undefined) {
      j.result = final;
    }
    j.status = "succeeded";
  } catch (e: any) {
    j.status = "failed";
    j.error = e.message ?? String(e);
    push(`error: ${j.error}`);
  } finally {
    j.finishedAt = new Date().toISOString();
  }
}
