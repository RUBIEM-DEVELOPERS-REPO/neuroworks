// Type declarations for the NeuroWorks dispatch SDK.

export interface NeuroWorksOptions {
  baseUrl?: string;
  apiKey: string;
}

export interface DispatchOptions {
  callbackUrl?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  timeoutMs?: number;
  intervalMs?: number;
}

export interface DispatchAccepted {
  jobId: string;
  status: "accepted";
  poll: string;
}

export interface DispatchResult {
  jobId: string;
  status: "pending" | "running" | "succeeded" | "failed";
  answer: string | null;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  timedOut?: boolean;
}

export class NeuroWorks {
  constructor(opts: NeuroWorksOptions);
  baseUrl: string;
  apiKey: string;
  dispatch(task: string, opts?: DispatchOptions): Promise<DispatchAccepted>;
  result(jobId: string): Promise<DispatchResult>;
  waitFor(jobId: string, opts?: Pick<DispatchOptions, "timeoutMs" | "intervalMs">): Promise<DispatchResult>;
  run(task: string, opts?: DispatchOptions): Promise<DispatchResult>;
}

export function verifyWebhook(secret: string, rawBody: string, signatureHeader: string): Promise<boolean>;
