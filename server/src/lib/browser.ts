import { chromium, type Browser, type Page } from "playwright";
import { resolve, join } from "node:path";
import { mkdirSync } from "node:fs";
import { config } from "../config.js";

// Shared with web-client.ts so fetch + scrape rotate through the same pool.
// Static UAs get fingerprinted; rotating between a few realistic ones makes
// the clawbot harder to block by simple anti-bot heuristics.
const SCRAPE_UA_POOL = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];
function pickScrapeUA(seed?: string): string {
  if (!seed) return SCRAPE_UA_POOL[Math.floor(Math.random() * SCRAPE_UA_POOL.length)];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return SCRAPE_UA_POOL[Math.abs(h) % SCRAPE_UA_POOL.length];
}

// Singleton browser. Launching chromium costs 1-3s and ~150 MB RSS — we share
// it across primitive calls and close it when the process exits. Each scrape
// gets its own context (cookie isolation) but reuses the underlying browser.
let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true }).catch(err => {
      // Don't cache a rejected launch — the next call should retry. This
      // matters when the user runs `playwright install` after the first call
      // already failed; without this reset they'd have to restart the server.
      browserPromise = null;
      throw err;
    });
    const close = async () => {
      try { const b = browserPromise; if (b) (await b).close(); } catch { /* already gone */ }
    };
    process.once("exit", close);
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  }
  return browserPromise;
}

export type ScrapeOptions = {
  url: string;
  selector?: string;       // CSS selector to extract instead of full page text
  waitFor?: string;        // CSS selector to wait for before extracting
  screenshot?: boolean;    // capture a PNG into the vault
  timeoutMs?: number;      // total navigation+wait budget (default 20s, max 60s)
  scrollToBottom?: boolean;// trigger lazy-loaded content
  userAgent?: string;      // override the rotation pool's pick (e.g. for reproducible debugging)
};

export type ScrapeResult = {
  url: string;             // final URL after redirects
  title: string;
  text: string;            // extracted text (selector or full page)
  html?: string;           // outerHTML of the selector if specified
  status?: number;         // HTTP status of the main response
  screenshot?: { path: string; bytes: number };
};

// Scrape a JS-rendered page. The page gets a fresh incognito context so cookies
// don't leak between calls. Times out at the user-specified or default budget.
// Action-driven browser session. `web.interact` is the multi-step parity for
// what Hermes' computer-use skill offers — navigate, fill a form, click,
// wait, extract — using the existing headless Chromium pool. Each step is a
// structured action so the planner doesn't have to generate Playwright code.
// Capped to 8 steps per call and 90 s total wall time to bound runaway loops.
export type InteractAction =
  | { type: "navigate"; url: string }
  | { type: "fill"; selector: string; value: string }
  | { type: "click"; selector: string }
  | { type: "wait_for"; selector: string; timeoutMs?: number }
  | { type: "wait_ms"; ms: number }
  | { type: "extract"; selector?: string }
  | { type: "screenshot"; name?: string };

export type InteractStepResult = { action: InteractAction; ok: boolean; error?: string; text?: string; url?: string; screenshot?: { path: string; bytes: number } };

export async function interact(opts: { startUrl: string; steps: InteractAction[]; totalTimeoutMs?: number; userAgent?: string }): Promise<{ url: string; title: string; results: InteractStepResult[]; finalText: string }>{
  const { assertSafePublicUrl } = await import("./security-gates.js");
  assertSafePublicUrl(opts.startUrl);
  const totalDeadline = Date.now() + Math.min(120_000, Math.max(5_000, opts.totalTimeoutMs ?? 90_000));
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: opts.userAgent ?? pickScrapeUA(opts.startUrl),
    viewport: { width: 1280, height: 900 },
  });
  let page: Page | null = null;
  const results: InteractStepResult[] = [];
  try {
    page = await context.newPage();
    page.setDefaultTimeout(20_000);
    await page.goto(opts.startUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    const steps = (opts.steps ?? []).slice(0, 8);
    for (const step of steps) {
      if (Date.now() > totalDeadline) {
        results.push({ action: step, ok: false, error: "total time budget exceeded" });
        break;
      }
      try {
        if (step.type === "navigate") {
          assertSafePublicUrl(step.url);
          await page.goto(step.url, { waitUntil: "domcontentloaded", timeout: 20_000 });
          results.push({ action: step, ok: true, url: page.url() });
        } else if (step.type === "fill") {
          await page.fill(step.selector, step.value, { timeout: 8_000 });
          results.push({ action: step, ok: true });
        } else if (step.type === "click") {
          await page.click(step.selector, { timeout: 8_000 });
          results.push({ action: step, ok: true, url: page.url() });
        } else if (step.type === "wait_for") {
          await page.waitForSelector(step.selector, { timeout: Math.min(20_000, Math.max(500, step.timeoutMs ?? 8_000)) });
          results.push({ action: step, ok: true });
        } else if (step.type === "wait_ms") {
          await new Promise(r => setTimeout(r, Math.min(15_000, Math.max(0, step.ms))));
          results.push({ action: step, ok: true });
        } else if (step.type === "extract") {
          let text = "";
          if (step.selector) {
            const el = await page.$(step.selector);
            if (el) text = (await el.innerText().catch(() => "")) || "";
          }
          if (!text) text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
          results.push({ action: step, ok: true, text: text.replace(/\s{3,}/g, " \n").slice(0, 20_000) });
        } else if (step.type === "screenshot") {
          const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
          const slug = (step.name ?? page.url().replace(/^https?:\/\//, "")).replace(/[^a-zA-Z0-9.-]+/g, "-").slice(0, 60);
          const rel = `_neuroworks/screenshots/${stamp}-${slug}.png`;
          const full = resolve(config.vaultPath, rel);
          mkdirSync(join(full, ".."), { recursive: true });
          const buf = await page.screenshot({ fullPage: true, type: "png" });
          const { writeFileSync } = await import("node:fs");
          writeFileSync(full, buf);
          results.push({ action: step, ok: true, screenshot: { path: rel, bytes: buf.length } });
        } else {
          results.push({ action: step as any, ok: false, error: `unknown step type` });
        }
      } catch (e: any) {
        results.push({ action: step, ok: false, error: String(e?.message ?? e).slice(0, 200) });
        // Hard-stop after the first failure — the planner can retry with a
        // tweaked selector rather than blunder forward with broken state.
        break;
      }
    }
    const title = await page.title().catch(() => "");
    const finalText = (await page.evaluate(() => document.body?.innerText ?? "").catch(() => "")).replace(/\s{3,}/g, " \n").slice(0, 40_000);
    return { url: page.url(), title, results, finalText };
  } finally {
    try { await page?.close(); } catch {}
    try { await context.close(); } catch {}
  }
}

// Render markdown → polished PDF via the existing headless Chromium pool.
// Powers the `vault.write_pdf` primitive — turns clawbot's markdown output
// into an actual document the operator can email a customer or attach to a
// board pack, without adding wkhtmltopdf / pandoc as new deps.
export async function renderMarkdownToPdf(opts: { markdown: string; title?: string; vaultRelPath: string; landscape?: boolean }): Promise<{ path: string; bytes: number }> {
  const { marked } = await import("marked");
  const bodyHtml = await marked.parse(opts.markdown, { breaks: true, gfm: true });
  const title = (opts.title ?? "Document").replace(/</g, "&lt;");
  // System-stack typography, generous margins, no chrome. The same look as a
  // briefing memo printed on letterhead — nothing fancy, just readable.
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  @page { margin: 24mm 22mm; }
  body { font: 11pt/1.55 -apple-system, "Segoe UI", system-ui, Arial, sans-serif; color: #1d1d1f; max-width: 740px; margin: 0 auto; }
  h1 { font-size: 22pt; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 12pt; }
  h2 { font-size: 14pt; font-weight: 600; margin-top: 18pt; margin-bottom: 6pt; }
  h3 { font-size: 12pt; font-weight: 600; margin-top: 14pt; }
  p, li { margin: 6pt 0; }
  ul, ol { padding-left: 22pt; }
  table { border-collapse: collapse; width: 100%; margin: 10pt 0; font-size: 10pt; }
  th, td { border: 1px solid #d8d8da; padding: 6pt 8pt; text-align: left; vertical-align: top; }
  th { background: #f5f5f7; font-weight: 600; }
  code { font: 10pt "SF Mono", Menlo, Consolas, monospace; background: #f5f5f7; padding: 1pt 4pt; border-radius: 3pt; }
  pre { background: #f5f5f7; padding: 10pt; border-radius: 4pt; overflow-x: auto; font: 9.5pt "SF Mono", Menlo, Consolas, monospace; }
  pre code { background: transparent; padding: 0; }
  blockquote { margin: 8pt 0 8pt 0; padding-left: 12pt; border-left: 3pt solid #d8d8da; color: #515154; }
  a { color: #0066cc; text-decoration: none; }
  hr { border: 0; border-top: 1px solid #d8d8da; margin: 14pt 0; }
</style></head><body>${bodyHtml}</body></html>`;

  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const full = resolve(config.vaultPath, opts.vaultRelPath);
    mkdirSync(join(full, ".."), { recursive: true });
    await page.pdf({
      path: full,
      format: "Letter",
      landscape: !!opts.landscape,
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    const { statSync } = await import("node:fs");
    const bytes = statSync(full).size;
    return { path: opts.vaultRelPath, bytes };
  } finally {
    try { await page.close(); } catch {}
    try { await context.close(); } catch {}
  }
}

export async function scrape(opts: ScrapeOptions): Promise<ScrapeResult> {
  // SECURITY: same SSRF block as web.fetch. A headless browser fetching
  // 169.254.169.254 would happily return cloud metadata; the gate stops
  // that. Override via CLAWBOT_WEB_ALLOW_PRIVATE=1.
  const { assertSafePublicUrl } = await import("./security-gates.js");
  assertSafePublicUrl(opts.url);
  const timeoutMs = Math.min(60_000, Math.max(2_000, opts.timeoutMs ?? 20_000));
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: opts.userAgent ?? pickScrapeUA(opts.url),
    viewport: { width: 1280, height: 900 },
  });
  let page: Page | null = null;
  try {
    page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    const response = await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    if (opts.waitFor) {
      try { await page.waitForSelector(opts.waitFor, { timeout: timeoutMs }); }
      catch { /* selector never appeared — fall through with whatever we have */ }
    }
    if (opts.scrollToBottom) {
      // Three short scrolls + small idle, enough to wake most lazy lists
      // without blowing the timeout budget on infinite-scroll pages.
      await page.evaluate(async () => {
        const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
        for (let i = 0; i < 3; i++) {
          window.scrollBy(0, document.body.scrollHeight);
          await sleep(400);
        }
      });
    }
    const title = await page.title().catch(() => "");
    let text = "";
    let html: string | undefined;
    if (opts.selector) {
      const el = await page.$(opts.selector);
      if (el) {
        text = (await el.innerText().catch(() => "")) || "";
        html = (await el.evaluate(e => (e as Element).outerHTML).catch(() => "")) || undefined;
      }
    }
    if (!text) {
      // Full-page text. Capped to keep the planner's prompt under the model's
      // context window after a few pages get joined.
      text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
    }
    text = text.replace(/\s{3,}/g, " \n").slice(0, 80_000);

    let screenshot: ScrapeResult["screenshot"];
    if (opts.screenshot) {
      const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      const slug = opts.url.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9.-]+/g, "-").slice(0, 60);
      const rel = `_neuroworks/screenshots/${stamp}-${slug}.png`;
      const full = resolve(config.vaultPath, rel);
      mkdirSync(join(full, ".."), { recursive: true });
      const buf = await page.screenshot({ fullPage: true, type: "png" });
      const { writeFileSync } = await import("node:fs");
      writeFileSync(full, buf);
      screenshot = { path: rel, bytes: buf.length };
    }

    return {
      url: page.url(),
      title,
      text,
      html,
      status: response?.status(),
      screenshot,
    };
  } finally {
    try { await page?.close(); } catch {}
    try { await context.close(); } catch {}
  }
}
