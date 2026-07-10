// Hardened web client for the agent's web tools.
//
// What this exists to fix:
//   • DDG lite is flaky — periodic timeouts and 502s. Without a fallback the
//     whole research pipeline craters.
//   • Raw HTML stripping leaves nav/footer/cookie-banner noise. The agent
//     wastes synthesis context on garbage.
//   • Without caching, a multiperspective run that uses the same source
//     across two framings fetches it twice.
//   • A single static User-Agent gets fingerprinted and blocked by some
//     sites; rotating between a small pool avoids that.

const UA_POOL = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

function pickUA(seed?: string): string {
  if (!seed) return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
  // Deterministic per-seed pick so retries hit the same UA — easier to debug.
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return UA_POOL[Math.abs(h) % UA_POOL.length];
}

// Tiny in-memory cache. Keyed by URL; TTL configurable via env. Default 10
// minutes — long enough that a multiperspective run reuses fetches, short
// enough that real news pages aren't stale by the next call.
const CACHE_TTL_MS = Number(process.env.CLAWBOT_WEB_CACHE_TTL_MS ?? "600000");
const cache = new Map<string, { at: number; status: number; contentType: string; text: string; title?: string }>();

function cacheGet(url: string) {
  const hit = cache.get(url);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(url); return null; }
  return hit;
}

function cacheSet(url: string, value: { status: number; contentType: string; text: string; title?: string }) {
  // Cap the cache so a long-running worker doesn't bleed memory.
  if (cache.size > 200) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  cache.set(url, { at: Date.now(), ...value });
}

// Strip out non-content elements before HTML→text conversion. Catches nav,
// footer, header, aside, script/style, cookie banners, share widgets, and
// most common cruft selectors. Lossy but adequate for synthesis.
const NOISE_SELECTORS = [
  /<script[\s\S]*?<\/script>/gi,
  /<style[\s\S]*?<\/style>/gi,
  /<noscript[\s\S]*?<\/noscript>/gi,
  /<nav[\s\S]*?<\/nav>/gi,
  /<header[\s\S]*?<\/header>/gi,
  /<footer[\s\S]*?<\/footer>/gi,
  /<aside[\s\S]*?<\/aside>/gi,
  /<form[\s\S]*?<\/form>/gi,
  /<svg[\s\S]*?<\/svg>/gi,
  // Common cookie-banner / consent / popup containers.
  /<div[^>]+class="[^"]*(cookie|consent|gdpr|newsletter|popup|modal|share|social)[^"]*"[\s\S]*?<\/div>/gi,
];

export function extractReadable(html: string): { title?: string; text: string } {
  let h = html;
  const titleMatch = h.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : undefined;
  for (const re of NOISE_SELECTORS) h = h.replace(re, " ");
  // Prefer the <article>, <main>, or .content body when present — most
  // modern sites mark it explicitly. Falls back to whole-doc.
  const article = h.match(/<(article|main)[^>]*>([\s\S]*?)<\/\1>/i);
  if (article) h = article[2];
  // Convert block tags to newlines so paragraph structure survives, then
  // strip all remaining tags.
  h = h.replace(/<\/(p|h[1-6]|li|tr|br|div|section|blockquote)>/gi, "\n$&");
  h = h.replace(/<br[^>]*>/gi, "\n");
  h = h.replace(/<[^>]+>/g, " ");
  // Decode the small set of HTML entities that survive the strip.
  h = h
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
  // Collapse whitespace within lines but preserve paragraph breaks.
  h = h
    .split(/\n+/)
    .map(line => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
  return { title, text: h };
}

export type FetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  cache?: boolean;
};

export async function fetchWeb(url: string, opts: FetchOptions = {}): Promise<{ status: number; contentType: string; text: string; title?: string; fromCache: boolean }> {
  // SECURITY: block private / loopback / metadata-service addresses to
  // prevent SSRF via a prompt-injected agent. Override with
  // CLAWBOT_WEB_ALLOW_PRIVATE=1 for legitimate local-host fetches.
  const { assertSafePublicUrlAsync } = await import("./security-gates.js");
  await assertSafePublicUrlAsync(url);
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const maxBytes = opts.maxBytes ?? 100_000;
  const useCache = opts.cache !== false;
  if (useCache) {
    const hit = cacheGet(url);
    if (hit) return { ...hit, fromCache: true };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": pickUA(url),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    const contentType = r.headers.get("content-type") ?? "";
    const raw = await r.text();
    const truncated = raw.slice(0, maxBytes);
    let text = truncated;
    let title: string | undefined;
    if (contentType.includes("html")) {
      const ex = extractReadable(truncated);
      text = ex.text;
      title = ex.title;
    }
    const result = { status: r.status, contentType, text, title };
    if (useCache) cacheSet(url, result);
    return { ...result, fromCache: false };
  } finally { clearTimeout(t); }
}

// Search the web. Multi-tier fallback so a single engine outage / anti-bot
// block doesn't kill the research path:
//   1. DuckDuckGo lite (no API key, pure HTML)
//   2. Bing HTML results page
//   3. Playwright tier — render DDG in a real browser. Catches the case
//      where HTTP-only scraping gets blocked by JS challenges, anti-bot,
//      or rate-limit pages, but a real Chromium gets through. Lazy import
//      so we don't pay Playwright's load cost on the happy path.
//   4. Playwright tier — Bing rendered. Final fallback before giving up.
// The first engine that produces hits wins.
export type SearchHit = { title: string; url: string; snippet: string };

export async function searchWeb(query: string, limit = 8): Promise<{ engine: string; results: SearchHit[]; tried: string[] }> {
  const tried: string[] = [];
  // FIRECRAWL FIRST when configured. Firecrawl's search has consistently
  // better source quality than DDG/Bing scraping (the engines we fall back
  // to often return spam SEO farms first). When the key isn't set,
  // firecrawlSearch returns null and we skip silently — no extra latency,
  // no behaviour change for users without a key.
  try {
    const { firecrawlEnabled, firecrawlSearch } = await import("./firecrawl.js");
    if (firecrawlEnabled()) {
      tried.push("firecrawl");
      const r = await firecrawlSearch(query, limit);
      if (r && r.length > 0) return { engine: "firecrawl", results: r, tried };
    }
  } catch { /* try next */ }
  for (const engine of ["ddg", "bing"] as const) {
    tried.push(engine);
    try {
      const r = engine === "ddg" ? await ddgSearch(query, limit) : await bingSearch(query, limit);
      if (r.length > 0) return { engine, results: r, tried };
    } catch { /* try next */ }
  }
  // Both HTTP engines returned nothing. Escalate to Playwright — a real
  // browser gets past anti-bot challenges that block our HTML scraper.
  for (const engine of ["ddg-browser", "bing-browser"] as const) {
    tried.push(engine);
    try {
      const r = await browserSearch(engine, query, limit);
      if (r.length > 0) return { engine, results: r, tried };
    } catch { /* try next */ }
  }
  return { engine: "none", results: [], tried };
}

// Playwright-backed search. Renders the search engine's results page in a
// real headless Chromium and extracts result links. Used as the LAST resort
// when both HTTP-tier engines failed.
//
// We share browser.ts's singleton browser to avoid the 1-3s launch cost on
// every retry. Lazy import keeps the playwright dependency out of the boot
// path for users who never hit this fallback.
async function browserSearch(engine: "ddg-browser" | "bing-browser", query: string, limit: number): Promise<SearchHit[]> {
  const { scrape } = await import("./browser.js");
  const url = engine === "ddg-browser"
    ? `https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=web`
    : `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${limit}`;
  // 18s budget — DDG's full-fat results page can take 6-10s under load.
  const r = await scrape({ url, timeoutMs: 18_000 });
  if (engine === "ddg-browser") return parseDdgRendered(r.text, r.html ?? "", limit);
  return parseBingRendered(r.text, r.html ?? "", limit);
}

// Parse DDG full-fat results page. The rendered DOM is different from
// /lite/ — actual <article> elements with [data-testid="result"] children.
// We work from the raw page text (extracted by browser.ts's innerText)
// instead of HTML since the DOM is heavily reactive and selectors drift.
// Heuristic: alternating "title line" / "url line" / "snippet" triples.
function parseDdgRendered(text: string, _html: string, limit: number): SearchHit[] {
  const out: SearchHit[] = [];
  // DDG result rows look like:
  //   <Title>\n<bare url or display path>\n<snippet>\n
  // We split on blank lines and walk groups that start with a URL-ish second
  // line. Tolerant — drops malformed groups silently.
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  for (let i = 0; i + 1 < lines.length && out.length < limit; i++) {
    const title = lines[i];
    const maybeUrl = lines[i + 1];
    const m = maybeUrl.match(/^(https?:\/\/[^\s]+)/i);
    if (m && title.length >= 8 && title.length <= 200 && !/^(http|https)/i.test(title)) {
      const snippet = lines[i + 2] && !/^https?:/i.test(lines[i + 2]) ? lines[i + 2].slice(0, 300) : "";
      out.push({ title, url: m[1], snippet });
      i += 2;
    }
  }
  return out;
}

// Parse Bing rendered results. The DOM is essentially the same as the HTTP
// fallback so we reuse parseBing on the captured HTML when available; when
// it isn't (browser.ts returned only text), fall back to a heuristic walk
// similar to parseDdgRendered.
function parseBingRendered(text: string, html: string, limit: number): SearchHit[] {
  if (html && /b_algo/i.test(html)) {
    const hits = parseBing(html);
    if (hits.length > 0) return hits.slice(0, limit);
  }
  return parseDdgRendered(text, html, limit);
}

async function ddgSearch(query: string, limit: number): Promise<SearchHit[]> {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": pickUA(query) }, redirect: "follow" });
    if (!r.ok) throw new Error(`DDG HTTP ${r.status}`);
    return parseDdgLite(await r.text()).slice(0, limit);
  } finally { clearTimeout(t); }
}

async function bingSearch(query: string, limit: number): Promise<SearchHit[]> {
  // Bing returns reasonable HTML for non-JS clients. We pass a desktop UA so
  // we don't get the mobile result layout (different selector set).
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${limit}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": pickUA(query), "Accept-Language": "en-US,en;q=0.9" },
      redirect: "follow",
    });
    if (!r.ok) throw new Error(`Bing HTTP ${r.status}`);
    return parseBing(await r.text()).slice(0, limit);
  } finally { clearTimeout(t); }
}

function parseDdgLite(html: string): SearchHit[] {
  const out: SearchHit[] = [];
  const anchorRe = /<a\s+[^>]*class=["']result-link["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const anchors: { url: string; title: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) && anchors.length < 12) {
    let raw = m[1];
    const wrapped = raw.match(/[?&]uddg=([^&]+)/);
    if (wrapped) { try { raw = decodeURIComponent(wrapped[1]); } catch { /* keep raw */ } }
    const title = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (raw.startsWith("http") && title) anchors.push({ url: raw, title });
  }
  const snippetRe = /<td\s+[^>]*class=["']result-snippet["'][^>]*>([\s\S]*?)<\/td>/gi;
  const snippets: string[] = [];
  while ((m = snippetRe.exec(html)) && snippets.length < anchors.length) {
    snippets.push(m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
  }
  for (let i = 0; i < anchors.length; i++) {
    out.push({ title: anchors[i].title, url: anchors[i].url, snippet: snippets[i] ?? "" });
  }
  return out;
}

function parseBing(html: string): SearchHit[] {
  const out: SearchHit[] = [];
  // Bing wraps each result in <li class="b_algo"><h2><a href="…">title</a></h2><p>snippet</p>…
  const liRe = /<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(html)) && out.length < 15) {
    const block = m[1];
    const anchorMatch = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!anchorMatch) continue;
    let url = unwrapBingUrl(anchorMatch[1]);
    const title = anchorMatch[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "";
    // De-HTML-entity the URL too — Bing emits &amp; instead of & in the href.
    url = url.replace(/&amp;/g, "&");
    if (url.startsWith("http") && title) out.push({ title, url, snippet });
  }
  return out;
}

// Bing dresses every result link in a tracking URL of the shape
// https://www.bing.com/ck/a?!&&p=<…>&u=a1<base64-of-real-url>&ntb=1
// — fetching that hits the Bing redirector, not the destination. The
// real URL is base64-encoded after the literal "a1" prefix in the `u=`
// parameter. We decode it client-side so primitives.web.fetch reaches the
// actual page.
function unwrapBingUrl(url: string): string {
  try {
    if (!url.includes("bing.com/ck/")) return url;
    const u = new URL(url.replace(/&amp;/g, "&"));
    const wrapped = u.searchParams.get("u");
    if (!wrapped) return url;
    // The "a1" / "a0" / "a2" prefix isn't standard base64 — strip the first
    // two chars before decoding. Falls back to the wrapped URL if decode
    // fails, which is no worse than what we had.
    const b64 = wrapped.length > 2 && /^a[0-9]/.test(wrapped) ? wrapped.slice(2) : wrapped;
    // base64url (no padding) → add padding so atob accepts it.
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const normalised = padded.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(normalised, "base64").toString("utf8");
    if (decoded.startsWith("http")) return decoded;
  } catch { /* fall through */ }
  return url;
}

export function webCacheStats() {
  return { entries: cache.size, ttlMs: CACHE_TTL_MS };
}

// Smart fetch — try the cheap HTTP path first, fall back to Playwright when:
//   • the HTTP fetch itself errored (DNS / timeout / refused)
//   • the response was 403/429/451 (anti-bot / rate-limit / blocked)
//   • the response was a 200 but the readable text was suspiciously short
//     (most likely a JS-only SPA that needs a real browser to render)
//
// The fallback uses scrape() with a generous timeout and full-page text.
// Cached on success in the same per-URL cache as fetchWeb.
const JS_RENDERED_TEXT_FLOOR = 400;  // under this many chars → suspect SPA

export async function smartFetch(url: string, opts: FetchOptions & { allowBrowser?: boolean } = {}): Promise<{ status: number; contentType: string; text: string; title?: string; fromCache: boolean; usedBrowser: boolean; engine: "http" | "browser" | "firecrawl" }> {
  const allowBrowser = opts.allowBrowser !== false;
  let fetchErr: Error | null = null;
  let httpResult: Awaited<ReturnType<typeof fetchWeb>> | null = null;
  // One retry on transient network failures. "fetch failed" / ECONNRESET /
  // socket-hang-up errors recover within seconds — re-trying without the
  // browser fallback is much cheaper than spinning up Playwright. We only
  // retry network-class errors; HTTP responses (even 5xx) skip the retry
  // and go to the browser fallback below.
  const TRANSIENT = /\b(?:fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|abort|timeout)\b/i;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      httpResult = await fetchWeb(url, opts);
      fetchErr = null;
      break;
    } catch (e: any) {
      fetchErr = e;
      const msg = String(e?.message ?? e);
      if (attempt === 0 && TRANSIENT.test(msg)) {
        await new Promise(r => setTimeout(r, 800));
        continue;
      }
      break;
    }
  }
  const shouldFallback = allowBrowser && (
    !httpResult ||
    httpResult.status === 403 ||
    httpResult.status === 429 ||
    httpResult.status === 451 ||
    httpResult.status >= 500 ||
    (httpResult.contentType.includes("html") && httpResult.text.length < JS_RENDERED_TEXT_FLOOR)
  );
  if (!shouldFallback && httpResult) {
    return { ...httpResult, usedBrowser: false, engine: "http" };
  }
  // Tier 2 — local Playwright. Catches JS-heavy / lazy-rendered sites.
  // Lazy import so headless Chromium isn't loaded on every server startup —
  // only when the user actually scrapes something.
  let browserErr: any = null;
  try {
    const { scrape } = await import("./browser.js");
    const r = await scrape({ url, timeoutMs: opts.timeoutMs ?? 20_000 });
    const value = {
      status: r.status ?? 200,
      contentType: "text/html",
      text: r.text,
      title: r.title,
    };
    cacheSet(url, value);
    return { ...value, fromCache: false, usedBrowser: true, engine: "browser" };
  } catch (e: any) {
    browserErr = e;
  }
  // Tier 3 — Firecrawl. Only fires when (a) the key is configured, and (b)
  // both vanilla fetch AND local Playwright failed. Targets Cloudflare /
  // anti-bot sites that block our own headless chrome. Markdown-out so the
  // synth gets clean content. Lazy import to keep startup cheap.
  try {
    const { firecrawlEnabled, firecrawlScrape } = await import("./firecrawl.js");
    if (firecrawlEnabled()) {
      const fc = await firecrawlScrape({ url, timeoutMs: opts.timeoutMs ?? 20_000, maxChars: opts.maxBytes });
      const value = {
        status: fc.status,
        contentType: "text/markdown",
        text: fc.markdown,
        title: fc.title,
      };
      cacheSet(url, value);
      return { ...value, fromCache: false, usedBrowser: true, engine: "firecrawl" };
    }
  } catch {
    // Firecrawl tier failed too — keep going to the final fallback below.
  }
  // All tiers exhausted — return whichever earlier path gave us the most
  // signal so the caller doesn't see a hard failure.
  if (httpResult) return { ...httpResult, usedBrowser: false, engine: "http" };
  throw fetchErr ?? browserErr ?? new Error(`smartFetch: all tiers failed for ${url}`);
}
