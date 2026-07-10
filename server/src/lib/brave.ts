// Brave browser read-only integration via the Chrome DevTools Protocol.
//
// Brave is Chromium-based, so the same CDP that powers `chrome --remote-
// debugging-port=…` works for Brave. The user launches Brave once with the
// debug flag, then clawbot can enumerate open tabs and read their content
// without any extension installed. Read-only by design — we never click,
// type, or navigate. The agent just observes what the user is browsing.
//
// Setup (one-time, user-side):
//   1. Close all Brave windows.
//   2. Launch Brave with the debug flag:
//        Windows: "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe" --remote-debugging-port=9222
//        macOS:   /Applications/Brave\ Browser.app/Contents/MacOS/Brave\ Browser --remote-debugging-port=9222
//        Linux:   brave-browser --remote-debugging-port=9222
//   3. Set NEUROWORKS_BRAVE_READ=1 in .env to opt in.
//   4. Optional: BRAVE_DEBUG_PORT to change from default 9222.
//
// Privacy: read-only means we can SEE every tab the user has open. That's a
// lot of personal context — emails, banking, drafts. We refuse to operate
// unless the user has explicitly opted in via the env flag, and the agent
// can't write/navigate even when enabled.

import type { Browser, BrowserContext, Page } from "playwright";

// Reuse the same Playwright pulled in by browser.ts (it's already in the
// deps via the headless Chromium path). Lazy import keeps the chromium
// runtime out of the boot path.

let connectedBrowser: Browser | null = null;
let lastConnectAt = 0;
const CONNECT_TTL_MS = 60_000; // re-validate connection every minute

export function braveEnabled(): boolean {
  return process.env.NEUROWORKS_BRAVE_READ === "1";
}

function bravePort(): number {
  const raw = Number(process.env.BRAVE_DEBUG_PORT ?? "9222");
  if (!Number.isFinite(raw) || raw < 1024 || raw > 65535) return 9222;
  return raw;
}

// Connect (or reuse) the CDP connection to a running Brave. Returns null
// when Brave isn't running with the debug flag (so callers can surface a
// helpful error rather than crashing).
async function connect(): Promise<Browser | null> {
  if (!braveEnabled()) return null;
  // Reuse the existing connection if it's recent AND still alive. CDP
  // connections drop silently when the user closes Brave; isConnected()
  // catches that immediately so we re-connect instead of returning a dead
  // handle that throws on the first call.
  if (connectedBrowser && connectedBrowser.isConnected() && (Date.now() - lastConnectAt) < CONNECT_TTL_MS) {
    return connectedBrowser;
  }
  // Drop any stale handle before reconnecting so we don't leak the old
  // connection. The .close() is best-effort — a dropped CDP connection
  // is already half-closed.
  if (connectedBrowser) {
    try { await connectedBrowser.close(); } catch { /* already gone */ }
    connectedBrowser = null;
  }
  try {
    const { chromium } = await import("playwright");
    const wsEndpoint = `http://127.0.0.1:${bravePort()}`;
    // connectOverCDP attaches to an existing browser without launching one.
    // Brave exposes its debug endpoint at http://localhost:<port>; Playwright
    // accepts that URL and discovers the websocket from /json/version.
    const browser = await chromium.connectOverCDP(wsEndpoint, { timeout: 5000 });
    // Auto-clear the cache if the browser disconnects mid-life so the next
    // call gets a fresh attempt instead of using a dead handle.
    browser.on("disconnected", () => {
      if (connectedBrowser === browser) connectedBrowser = null;
    });
    connectedBrowser = browser;
    lastConnectAt = Date.now();
    return browser;
  } catch {
    connectedBrowser = null;
    return null;
  }
}

export type BraveTab = {
  url: string;
  title: string;
  contextIndex: number;   // which browser context (window) the tab belongs to
  pageIndex: number;      // index within the context's pages
};

// List all open tabs across every Brave window. Returns a stable index pair
// (contextIndex, pageIndex) the caller can use with readTab.
export async function listBraveTabs(): Promise<BraveTab[]> {
  const browser = await connect();
  if (!browser) {
    throw new Error(
      braveEnabled()
        ? `Couldn't reach Brave on port ${bravePort()}. Launch Brave with --remote-debugging-port=${bravePort()} and keep it running.`
        : "Brave integration is disabled. Set NEUROWORKS_BRAVE_READ=1 in .env to enable, then launch Brave with --remote-debugging-port=9222."
    );
  }
  const tabs: BraveTab[] = [];
  const contexts = browser.contexts();
  for (let ci = 0; ci < contexts.length; ci++) {
    const ctx = contexts[ci];
    const pages = ctx.pages();
    for (let pi = 0; pi < pages.length; pi++) {
      const page = pages[pi];
      // Page.url() and page.title() can both throw on a closing tab — guard
      // each so a single dying tab doesn't abort the whole enumeration.
      let url = "";
      let title = "";
      try { url = page.url(); } catch { continue; }
      try { title = await page.title(); } catch { title = ""; }
      // Skip non-http(s) tabs — chrome://, about:blank, devtools, etc. The
      // agent has no use for those and they tend to be noisy.
      if (!/^https?:/i.test(url)) continue;
      tabs.push({ url, title, contextIndex: ci, pageIndex: pi });
    }
  }
  return tabs;
}

export type BraveTabContent = {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
};

// Read the visible text of a specific tab. Read-only: no click, no scroll,
// no eval beyond extracting innerText. Cap content size to keep the synth
// prompt manageable.
export async function readBraveTab(args: {
  contextIndex: number;
  pageIndex: number;
  maxChars?: number;
  selector?: string;
}): Promise<BraveTabContent> {
  const browser = await connect();
  if (!browser) throw new Error("Brave is not reachable — see brave.list_tabs for setup instructions.");
  const cap = Math.max(500, Math.min(80_000, args.maxChars ?? 20_000));
  const contexts = browser.contexts();
  const ctx: BrowserContext | undefined = contexts[args.contextIndex];
  if (!ctx) throw new Error(`No browser context at index ${args.contextIndex}`);
  const pages = ctx.pages();
  const page: Page | undefined = pages[args.pageIndex];
  if (!page) throw new Error(`No tab at index ${args.pageIndex} in context ${args.contextIndex}`);
  let url = "";
  let title = "";
  try { url = page.url(); } catch {}
  try { title = await page.title(); } catch {}
  let text = "";
  try {
    if (args.selector) {
      const el = await page.$(args.selector);
      if (el) text = (await el.innerText().catch(() => "")) || "";
    }
    if (!text) {
      text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
    }
  } catch (e: any) {
    throw new Error(`Couldn't read tab ${args.contextIndex}/${args.pageIndex}: ${String(e?.message ?? e).slice(0, 200)}`);
  }
  const truncated = text.length > cap;
  return { url, title, text: text.slice(0, cap), truncated };
}

// Find tabs whose URL or title matches a query (case-insensitive substring).
// Useful when the user says "what's on that GitHub issue I had open?" — the
// agent can grep instead of reading every tab.
export async function searchBraveTabs(query: string, limit = 10): Promise<BraveTab[]> {
  const all = await listBraveTabs();
  if (!query.trim()) return all.slice(0, limit);
  const q = query.toLowerCase();
  const hits = all.filter(t => t.url.toLowerCase().includes(q) || t.title.toLowerCase().includes(q));
  return hits.slice(0, limit);
}

// Health probe — used by /api/status to render whether Brave is reachable.
export async function braveHealth(): Promise<{ enabled: boolean; ok: boolean; port?: number; tabCount?: number; error?: string }> {
  if (!braveEnabled()) return { enabled: false, ok: false };
  try {
    const tabs = await listBraveTabs();
    return { enabled: true, ok: true, port: bravePort(), tabCount: tabs.length };
  } catch (e: any) {
    return { enabled: true, ok: false, port: bravePort(), error: String(e?.message ?? e).slice(0, 120) };
  }
}
