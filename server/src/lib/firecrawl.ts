// Firecrawl client. Firecrawl (firecrawl.dev) is a hosted scraping service
// that handles anti-bot challenges, JS rendering, and content extraction with
// far less ceremony than running our own Playwright. We use it as an
// alternative path in smartFetch — specifically for sites that block vanilla
// fetch (Cloudflare-protected, CAPTCHA-gated, hard-paywalled previews) where
// our local Playwright would still get blocked.
//
// Design notes:
//   • Optional: when FIRECRAWL_API_KEY is unset, every entry point returns
//     null/throws-with-NO_KEY. smartFetch checks first and skips Firecrawl
//     entirely so users without a key see no behaviour change.
//   • Cheap-first: smartFetch still tries free `fetchWeb` first and only
//     reaches for Firecrawl after that fails. Saves API quota.
//   • Markdown-out: the scrape endpoint returns markdown by default, which
//     is what the synth wants anyway — no need for our HTML-strip pipeline.

import { config } from "../config.js";

export type FirecrawlScrapeOptions = {
  url: string;
  timeoutMs?: number;
  // When true, only the main content gets extracted (drops nav/footer/ads).
  // Defaults to true since that's almost always what the synth wants.
  onlyMainContent?: boolean;
  // Cap response size to avoid overflowing the synth's prompt window.
  maxChars?: number;
};

export type FirecrawlScrapeResult = {
  url: string;
  title?: string;
  markdown: string;
  status: number;
  // Pass-through metadata so the caller can log + audit. Firecrawl returns
  // sourceURL, statusCode, language, etc.
  metadata?: Record<string, any>;
};

export function firecrawlEnabled(): boolean {
  return Boolean(config.firecrawlApiKey?.trim());
}

// One-page scrape via Firecrawl's /v1/scrape endpoint. Returns markdown
// extracted from the page. Throws when the key is missing OR the API call
// fails — callers should catch and degrade gracefully (smartFetch falls
// through to Playwright on Firecrawl failure).
export async function firecrawlScrape(opts: FirecrawlScrapeOptions): Promise<FirecrawlScrapeResult> {
  if (!firecrawlEnabled()) {
    throw new Error("Firecrawl not configured (set FIRECRAWL_API_KEY in .env)");
  }
  // SECURITY: same SSRF block as the other web tiers. Firecrawl is a hosted
  // service so it can't reach our localhost — but it CAN reach the internet
  // and could be tricked into hitting an internal-looking target by URL
  // games. The shared gate keeps the threat model consistent.
  const { assertSafePublicUrlAsync } = await import("./security-gates.js");
  await assertSafePublicUrlAsync(opts.url);
  const base = config.firecrawlBaseUrl.replace(/\/+$/, "");
  const timeoutMs = Math.min(60_000, Math.max(2_000, opts.timeoutMs ?? 20_000));
  const maxChars = Math.max(1_000, opts.maxChars ?? 80_000);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base}/v1/scrape`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.firecrawlApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: opts.url,
        formats: ["markdown"],
        onlyMainContent: opts.onlyMainContent !== false,
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new Error(`Firecrawl ${r.status}: ${body.slice(0, 200)}`);
    }
    const body = await r.json() as {
      success?: boolean;
      data?: {
        markdown?: string;
        metadata?: { title?: string; sourceURL?: string; statusCode?: number; [k: string]: any };
      };
      error?: string;
    };
    if (body.success === false || !body.data) {
      throw new Error(`Firecrawl scrape failed: ${body.error ?? "no data returned"}`);
    }
    const md = (body.data.markdown ?? "").slice(0, maxChars);
    const meta = body.data.metadata ?? {};
    return {
      url: meta.sourceURL ?? opts.url,
      title: meta.title,
      markdown: md,
      status: typeof meta.statusCode === "number" ? meta.statusCode : 200,
      metadata: meta,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Web search via Firecrawl. Falls back to null when the key is missing so
// callers can keep using their DDG/Bing path. Firecrawl's search returns
// {title, url, description, markdown?} — we normalise to our SearchHit shape.
export type FirecrawlSearchResult = { title: string; url: string; snippet: string };

export async function firecrawlSearch(query: string, limit = 8, timeoutMs = 15_000): Promise<FirecrawlSearchResult[] | null> {
  if (!firecrawlEnabled()) return null;
  const base = config.firecrawlBaseUrl.replace(/\/+$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base}/v1/search`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.firecrawlApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, limit }),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const body = await r.json() as { success?: boolean; data?: { title?: string; url: string; description?: string }[] };
    if (!body.data) return null;
    return body.data.slice(0, limit).map(h => ({
      title: h.title ?? h.url,
      url: h.url,
      snippet: h.description ?? "",
    }));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Lightweight health probe used by /api/status to show whether the Firecrawl
// backend is reachable + the key works. Hits a deliberately small endpoint
// so we don't burn quota on healthcheck.
export async function firecrawlHealth(): Promise<{ ok: boolean; enabled: boolean; error?: string }> {
  if (!firecrawlEnabled()) return { ok: false, enabled: false };
  try {
    // Firecrawl exposes /v1/team to list workspace info — cheap & key-gated.
    // Fall back to scraping a trivially small page if the team endpoint
    // doesn't exist on the user's plan.
    const base = config.firecrawlBaseUrl.replace(/\/+$/, "");
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5_000);
    try {
      const r = await fetch(`${base}/v1/team`, {
        headers: { "Authorization": `Bearer ${config.firecrawlApiKey}` },
        signal: ctrl.signal,
      });
      if (r.status === 401 || r.status === 403) return { ok: false, enabled: true, error: `auth failed (HTTP ${r.status})` };
      // Any non-5xx response means the key + base URL are reachable. The
      // exact 200 vs 404 depends on plan — we just need to know the round-
      // trip works.
      return { ok: r.status < 500, enabled: true, error: r.ok ? undefined : `HTTP ${r.status}` };
    } finally { clearTimeout(t); }
  } catch (e: any) {
    return { ok: false, enabled: true, error: String(e?.message ?? e).slice(0, 120) };
  }
}
