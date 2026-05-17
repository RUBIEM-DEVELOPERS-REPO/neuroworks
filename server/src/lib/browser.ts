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
export async function scrape(opts: ScrapeOptions): Promise<ScrapeResult> {
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
