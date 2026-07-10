// Shared types for source-validator. Split into its own module because
// research.deep, smartFetch, and the validator all reference these and
// circular imports were the alternative.

export type FetchedSource = {
  url: string;
  title?: string;
  text?: string;
  ok: boolean;
  error?: string;
  // Optional HTTP status from the underlying fetch — when known. The
  // validator treats 401/403/404/410/5xx as junk.
  status?: number;
  // Which engine fetched this — informational, surfaced in audit log.
  engine?: "http" | "browser" | "firecrawl" | "unknown";
  usedBrowser?: boolean;
};

export type SourceVerdict = {
  ok: boolean;
  reason?: "fetch-failed" | "bad-status" | "thin-content" | "auth-wall" | "captcha" | "error-page" | "paywall-preview" | "cookie-wall" | "off-topic" | "low-quartile" | "unknown";
  detail?: string;
};

export type ValidatedSource = FetchedSource & {
  verdict: SourceVerdict;
  score: number;
};
