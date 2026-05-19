import { existsSync, readdirSync, readFileSync, statSync, appendFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, basename, extname, sep, join } from "node:path";
import { config } from "../config.js";
import { ollamaGenerate, ollamaGenerateWithMeta } from "./ollama.js";
import { listVault, readVaultFile, searchVault, writeVaultFile, importBinaryIntoVault } from "./vault.js";
import { extractDocText, extractDocsParallel } from "./doc-extractor.js";
import { listOwnedRepos, recentCommits, openPRs, openIssues, readme, octokit } from "./github.js";
import { delegateToBestPeer, reviewWithPeer } from "./peers.js";
import { scanForSecurityRisks, redactHighSeverity, type SecurityKind } from "./security.js";
import { scrape } from "./browser.js";
import { enqueueVaultCommit } from "./commit-queue.js";
import { searchWeb, smartFetch } from "./web-client.js";

export type ArgSpec = { name: string; type: "string" | "number" | "boolean"; required: boolean; description: string };

export type Primitive = {
  name: string;
  description: string;
  args: ArgSpec[];
  // true = read-only, won't mutate state. used to decide whether a plan needs approval.
  readonly: boolean;
  handler: (args: Record<string, any>) => Promise<any>;
};

// Per-root listing cache for fs.find_in. Many tasks in a row hit the
// same root (Downloads, Desktop, etc.); re-walking 10k+ files on every
// call is the dominant cost. Keyed on the (sorted-roots, depth) pair so
// folder='all' (4 roots) shares cache entries with folder='downloads'.
// Invalidates when either:
//   (a) 30s pass since the cache entry was written, OR
//   (b) the root directory's own mtime advances (catches new
//       downloads / new files dropped on Desktop).
// (b) is the more important trigger — TTL is just belt-and-suspenders.
type FindCacheEntry = {
  at: number;
  rootMtimes: number[];
  files: { path: string; name: string; ext: string; size: number; modified: string; folder: string }[];
};
const FIND_CACHE = new Map<string, FindCacheEntry>();
const FIND_CACHE_TTL_MS = Number(process.env.CLAWBOT_FIND_CACHE_TTL_MS ?? "30000");
const FIND_CACHE_MAX = 32;

function findCacheKey(roots: string[], depth: number): string {
  return [...roots].sort().join("|") + `@d=${depth}`;
}

function currentRootMtimes(roots: string[]): number[] {
  const out: number[] = [];
  for (const r of roots) {
    try { out.push(statSync(r).mtimeMs); } catch { out.push(0); }
  }
  return out;
}

export function pickCachedListing(roots: string[], depth: number): FindCacheEntry["files"] | null {
  const key = findCacheKey(roots, depth);
  const hit = FIND_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > FIND_CACHE_TTL_MS) { FIND_CACHE.delete(key); return null; }
  const current = currentRootMtimes(roots);
  // ANY root's mtime advanced → stale. We invalidate the WHOLE entry
  // rather than partial-refresh because partial state across roots is a
  // recipe for inconsistent results.
  if (current.length !== hit.rootMtimes.length) { FIND_CACHE.delete(key); return null; }
  for (let i = 0; i < current.length; i++) {
    if (current[i] !== hit.rootMtimes[i]) { FIND_CACHE.delete(key); return null; }
  }
  return hit.files;
}

export function cacheListing(roots: string[], depth: number, files: FindCacheEntry["files"]): void {
  if (FIND_CACHE.size >= FIND_CACHE_MAX) {
    // Drop the oldest entry to bound memory if a wide range of roots
    // got cached (unusual — most users stick to ~4 root combinations).
    const oldest = [...FIND_CACHE.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) FIND_CACHE.delete(oldest[0]);
  }
  FIND_CACHE.set(findCacheKey(roots, depth), {
    at: Date.now(),
    rootMtimes: currentRootMtimes(roots),
    files,
  });
}

export const primitives: Primitive[] = [
  {
    name: "vault.search",
    description: "Search the user's Obsidian vault for a query. Returns up to 50 matches as { path, line, preview }.",
    readonly: true,
    args: [{ name: "query", type: "string", required: true, description: "Words to search for" }],
    handler: async (args) => ({ matches: searchVault(String(args.query)) }),
  },
  {
    name: "vault.read",
    description: "Read a file from the vault. Supports markdown/text, PDF, DOCX, XLSX, and CSV — binary docs get extracted to text/markdown so you can read what's inside. Path is relative to vault root.",
    readonly: true,
    args: [{ name: "path", type: "string", required: true, description: "Vault-relative path, e.g. 2-Permanent/202604271220-neuroworks.md or 0-Inbox/spec.pdf" }],
    handler: async (args) => {
      const rel = String(args.path);
      const ext = extname(rel).toLowerCase();
      // Plain text/markdown — fast path, no parser load.
      if (ext === ".md" || ext === ".markdown" || ext === ".txt" || ext === "" || ext === ".rst" || ext === ".org") {
        return { content: readVaultFile(rel), kind: "text", ext };
      }
      // Binary doc — route through the extractor so the agent sees the
      // actual content, not the filename. Resolve absolute path inside the
      // vault; the extractor does the same safety checks.
      const full = resolve(config.vaultPath, rel);
      const r = await extractDocText(full);
      return {
        content: r.text,
        kind: r.kind,
        ext: r.ext,
        name: r.name,
        bytes: r.bytes,
        pages: r.pages,
        sheets: r.sheets,
        truncated: r.truncated,
      };
    },
  },
  {
    name: "vault.list",
    description: "List entries in a vault folder. Returns { name, path, type } per entry.",
    readonly: true,
    args: [{ name: "path", type: "string", required: false, description: "Vault-relative folder, blank for root" }],
    handler: async (args) => ({ entries: listVault(String(args.path ?? "")) }),
  },
  {
    name: "vault.write",
    description: "Write a markdown file to the vault. Use 0-Inbox/<name>.md for fleeting notes. Will be committed.",
    readonly: false,
    args: [
      { name: "path", type: "string", required: true, description: "Vault-relative path" },
      { name: "content", type: "string", required: true, description: "File body, including frontmatter" },
    ],
    handler: async (args) => {
      const path = String(args.path);
      writeVaultFile(path, String(args.content));
      // Commit via the shared queue so concurrent vault writes coalesce.
      void enqueueVaultCommit(`neuroworks: vault.write — ${path}`);
      return { written: path };
    },
  },
  {
    name: "vault.scan_docs",
    description: "Read MANY vault docs in parallel and return their extracted text. Use when the customer asks 'what's in my <folder>?' or 'summarize the docs in <folder>'. Supports MD, PDF, DOCX, XLSX, CSV. Caps at 12 docs per call to keep latency bounded — narrow with the `folder` arg if you need a specific area.",
    readonly: true,
    args: [
      { name: "folder", type: "string", required: false, description: "Vault-relative folder to scan, blank for vault root" },
      { name: "max", type: "number", required: false, description: "Max docs to read (default 12, cap 24)" },
      { name: "extensions", type: "string", required: false, description: "Comma-separated extensions to include, e.g. '.pdf,.docx'. Default: all known doc types." },
    ],
    handler: async (args) => {
      const folder = String(args.folder ?? "");
      const max = Math.max(1, Math.min(24, Number(args.max ?? 12)));
      const allowed = String(args.extensions ?? ".md,.markdown,.txt,.pdf,.docx,.xlsx,.xls,.csv")
        .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
      const entries = listVault(folder);
      const files = entries
        .filter(e => e.type === "file" && allowed.includes(extname(e.name).toLowerCase()))
        .slice(0, max);
      if (files.length === 0) return { folder, scanned: 0, docs: [], message: `No matching docs in "${folder || "<root>"}". Allowed extensions: ${allowed.join(", ")}` };
      // Resolve each to absolute then parallel-extract through the shared
      // extractor cache. Concurrency capped inside the extractor so we don't
      // OOM on a folder full of PDFs.
      const abs = files.map(f => resolve(config.vaultPath, f.path));
      const results = await extractDocsParallel(abs, { concurrency: 6 });
      // Strip absolute paths from the response — replace with vault-relative
      // ones so the LLM sees `0-Inbox/spec.pdf` not `D:\Main brain\...`.
      const docs = results.map((r: any) => {
        const relMatch = files.find(f => resolve(config.vaultPath, f.path) === r.path);
        const rel = relMatch ? relMatch.path : r.path;
        if (r.ok) {
          return {
            path: rel,
            kind: r.result.kind,
            name: r.result.name,
            bytes: r.result.bytes,
            pages: r.result.pages,
            sheets: r.result.sheets,
            truncated: r.result.truncated,
            content: r.result.text,
            ok: true,
          };
        }
        return { path: rel, ok: false, error: r.error };
      });
      return { folder, scanned: docs.length, docs };
    },
  },
  {
    name: "vault.edit",
    description: "Edit an existing markdown file in the vault according to an instruction. Reads the file, applies the edit (via LLM), scans the result for secrets, writes it back, and commits. REQUIRES the user to have authorised vault edits via CLAWBOT_VAULT_EDIT=1 in .env — otherwise this tool refuses. Markdown only; refuses to edit binary docs.",
    readonly: false,
    args: [
      { name: "path", type: "string", required: true, description: "Vault-relative path to the .md file to edit" },
      { name: "instruction", type: "string", required: true, description: "What to change. Be specific — e.g. 'Add a Risks section at the end' or 'Replace the second paragraph with a clearer version'." },
    ],
    handler: async (args) => {
      // Top-level approval gate. The customer authorises vault editing by
      // setting CLAWBOT_VAULT_EDIT=1 in .env. Until they do, the tool refuses
      // — this protects against unintended overwrites by an agent that picks
      // vault.edit speculatively. The refusal message tells the customer
      // exactly what to do.
      if (process.env.CLAWBOT_VAULT_EDIT !== "1") {
        throw new Error("vault.edit refused: vault editing isn't authorised. To allow clawbot to edit docs in your vault, set CLAWBOT_VAULT_EDIT=1 in clawbot/.env and restart the server.");
      }
      const path = String(args.path);
      const instruction = String(args.instruction);
      const ext = extname(path).toLowerCase();
      // Refuse non-markdown — re-writing a PDF or DOCX is not safe (we can
      // extract text but can't preserve formatting on write). For those,
      // capture an .md sidecar via vault.write instead.
      if (ext !== ".md" && ext !== ".markdown" && ext !== ".txt") {
        throw new Error(`vault.edit only supports .md / .markdown / .txt files. For ${ext} docs, extract via vault.read and write a new note with vault.write.`);
      }
      const original = readVaultFile(path);
      const sys = `You are editing a Markdown document. Apply the user's edit instruction and return the COMPLETE updated document — not a diff, not a partial, not commentary. Preserve everything the instruction doesn't change. Preserve frontmatter (--- blocks) unless the instruction explicitly modifies it. No "Here is the updated…" preamble. Output ONLY the new document body.`;
      const prompt = `Edit instruction:\n${instruction}\n\nOriginal document:\n\n${original}\n\nReturn the complete updated document:`;
      const edited = await ollamaGenerate(prompt, sys, { profile: "synthesis", complexity: original.length + instruction.length > 6000 ? "high" : "normal" } as any);
      // Strip a stray ``` fence if the model wrapped its output.
      const cleaned = edited.trim().replace(/^```(?:markdown)?\n([\s\S]+?)\n```$/i, "$1").trim();
      if (cleaned.length < 10) throw new Error("LLM returned an empty / near-empty edit; refusing to overwrite the original.");
      writeVaultFile(path, cleaned);
      void enqueueVaultCommit(`neuroworks: vault.edit — ${path} (${instruction.slice(0, 60)})`);
      return {
        edited: path,
        instruction,
        originalChars: original.length,
        editedChars: cleaned.length,
        delta: cleaned.length - original.length,
      };
    },
  },
  {
    name: "ollama.generate",
    description: "Run the local LLM. Use to summarize, draft, rephrase, or reason over text fetched by other steps. Optional `profile` picks the right model: 'synthesis' (default — long-form prose), 'triage' (fast classify), 'extraction' (strict JSON), 'planning'.",
    readonly: true,
    args: [
      { name: "prompt", type: "string", required: true, description: "User-side prompt" },
      { name: "system", type: "string", required: false, description: "Optional system instruction" },
      { name: "profile", type: "string", required: false, description: "synthesis|triage|extraction|planning|balanced — model router uses this to pick the best available model" },
    ],
    handler: async (args) => {
      const meta = await ollamaGenerateWithMeta(
        String(args.prompt),
        args.system ? String(args.system) : undefined,
        { profile: (args.profile as any) ?? "synthesis" },
      );
      // The `model` field surfaces the actual model picked by the router so
      // executePlan can stash it on the StepRun for journal + UI provenance.
      return { text: meta.text, model: meta.model };
    },
  },
  {
    name: "github.list_repos",
    description: "List all GitHub repos the user can access (owner/collaborator/org_member). Returns name, full, description, pushedAt, language.",
    readonly: true,
    args: [],
    handler: async () => ({ repos: await listOwnedRepos() }),
  },
  {
    name: "github.read_repo",
    description: "Get repo overview: README + recent commits + open PRs + open issues. Pass owner and name (split owner/name).",
    readonly: true,
    args: [
      { name: "owner", type: "string", required: true, description: "GitHub owner (e.g. RUBIEM-DEVELOPERS-REPO)" },
      { name: "name", type: "string", required: true, description: "Repo name" },
    ],
    handler: async (args) => {
      const owner = String(args.owner); const name = String(args.name);
      const since = new Date(Date.now() - 90 * 86400_000).toISOString();
      const [rd, commits, prs, issues] = await Promise.all([
        readme(owner, name), recentCommits(owner, name, since), openPRs(owner, name), openIssues(owner, name),
      ]);
      return { readme: rd, commits, prs, issues };
    },
  },
  {
    name: "github.list_branches",
    description: "List branches of a repo. Returns array of { name, sha }.",
    readonly: true,
    args: [
      { name: "owner", type: "string", required: true, description: "GitHub owner" },
      { name: "name", type: "string", required: true, description: "Repo name" },
    ],
    handler: async (args) => {
      const { data } = await octokit.repos.listBranches({ owner: String(args.owner), repo: String(args.name), per_page: 50 });
      return { branches: data.map(b => ({ name: b.name, sha: b.commit.sha })) };
    },
  },
  {
    name: "github.get_file",
    description: "Fetch the raw text of one file from a repo at HEAD of default branch.",
    readonly: true,
    args: [
      { name: "owner", type: "string", required: true, description: "GitHub owner" },
      { name: "name", type: "string", required: true, description: "Repo name" },
      { name: "path", type: "string", required: true, description: "Repo-relative file path" },
    ],
    handler: async (args) => {
      const { data } = await octokit.repos.getContent({ owner: String(args.owner), repo: String(args.name), path: String(args.path) });
      if (Array.isArray(data) || data.type !== "file") throw new Error("not a file");
      const buf = Buffer.from((data as any).content, "base64");
      return { content: buf.toString("utf8"), size: (data as any).size };
    },
  },
  {
    name: "github.create_issue",
    description: "Open a GitHub issue. Use sparingly. Title is required, body is markdown.",
    readonly: false,
    args: [
      { name: "owner", type: "string", required: true, description: "Owner" },
      { name: "name", type: "string", required: true, description: "Repo" },
      { name: "title", type: "string", required: true, description: "Issue title" },
      { name: "body", type: "string", required: false, description: "Markdown body" },
    ],
    handler: async (args) => {
      const { data } = await octokit.issues.create({ owner: String(args.owner), repo: String(args.name), title: String(args.title), body: args.body ? String(args.body) : undefined });
      return { number: data.number, url: data.html_url };
    },
  },
  {
    name: "vault.append",
    description: "Append content to an existing vault file (creates with content if missing).",
    readonly: false,
    args: [
      { name: "path", type: "string", required: true, description: "Vault-relative path" },
      { name: "content", type: "string", required: true, description: "Text to append (a leading newline is added)" },
    ],
    handler: async (args) => {
      const full = resolve(config.vaultPath, String(args.path));
      if (!full.startsWith(resolve(config.vaultPath))) throw new Error("path escapes vault");
      const text = (existsSync(full) ? "\n" : "") + String(args.content);
      appendFileSync(full, text, "utf8");
      void enqueueVaultCommit(`neuroworks: vault.append — ${String(args.path)}`);
      return { appended: String(args.path) };
    },
  },
  {
    name: "vault.create_zettel",
    description: "Create a Zettelkasten permanent note with proper frontmatter and YYYYMMDDHHmm ID. Returns the created path.",
    readonly: false,
    args: [
      { name: "title", type: "string", required: true, description: "One-sentence claim/title" },
      { name: "body", type: "string", required: true, description: "Note body (markdown)" },
      { name: "tags", type: "string", required: false, description: "Comma-separated tags" },
    ],
    handler: async (args) => {
      const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
      const slug = String(args.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "note";
      const path = `2-Permanent/${stamp}-${slug}.md`;
      const tags = String(args.tags ?? "").split(",").map(t => t.trim()).filter(Boolean);
      const today = new Date().toISOString().slice(0, 10);
      const md = `---\nid: ${stamp}\ntitle: ${args.title}\ntags: [${tags.join(", ")}]\ncreated: ${today}\n---\n\n# ${args.title}\n\n${args.body}\n`;
      writeVaultFile(path, md);
      void enqueueVaultCommit(`neuroworks: zettel — ${slug}`);
      return { path, id: stamp };
    },
  },
  {
    name: "vault.find_by_tag",
    description: "Find notes whose frontmatter tags include the given tag.",
    readonly: true,
    args: [{ name: "tag", type: "string", required: true, description: "Tag without leading #" }],
    handler: async (args) => {
      const tag = String(args.tag).toLowerCase();
      const matches = searchVault(`tags:`).filter(m => {
        try {
          const c = readVaultFile(m.path);
          const fm = c.match(/---\n([\s\S]*?)\n---/);
          if (!fm) return false;
          const tagsLine = fm[1].split("\n").find(l => l.startsWith("tags:"));
          return !!tagsLine && tagsLine.toLowerCase().includes(tag);
        } catch { return false; }
      });
      return { matches };
    },
  },
  {
    name: "web.fetch",
    description: "HTTP GET a URL and return up to 100 KB of readable text. HTML is run through a noise-stripping extractor (drops nav/footer/cookie banners, prefers <article>/<main> body). Rotates User-Agent. Per-URL response cached for 10 minutes. Auto-falls back to a Playwright (headless Chromium) render when the HTTP path returns blocked / empty / JS-only content, so JS-rendered SPAs work without the user having to pick a tool. Bounded to ~20s total when the browser path kicks in.",
    readonly: true,
    args: [
      { name: "url", type: "string", required: true, description: "Full URL including protocol" },
      { name: "force_browser", type: "boolean", required: false, description: "Skip the cheap HTTP attempt and go straight to Playwright" },
    ],
    handler: async (args) => {
      const url = String(args.url);
      if (args.force_browser === true) {
        const r = await smartFetch(url, { allowBrowser: true, cache: false });
        return r;
      }
      const r = await smartFetch(url);
      return r;
    },
  },
  {
    name: "web.scrape",
    description: "Render a URL in a real headless browser (Playwright + Chromium) and return the page text. Use this instead of web.fetch when the page needs JS to render, sits behind anti-bot, or requires waiting for content. Optional: a CSS `selector` to extract just one section, `waitFor` selector to delay extraction, `scrollToBottom` for lazy-load lists, `screenshot` to also save a PNG into _neuroworks/screenshots/ in the vault.",
    readonly: true,
    args: [
      { name: "url", type: "string", required: true, description: "Full URL including protocol" },
      { name: "selector", type: "string", required: false, description: "CSS selector to extract (defaults to whole-page text)" },
      { name: "waitFor", type: "string", required: false, description: "CSS selector to wait for before extracting" },
      { name: "screenshot", type: "boolean", required: false, description: "If true, saves a PNG to the vault and returns its path" },
      { name: "scrollToBottom", type: "boolean", required: false, description: "Trigger lazy-loaded content with three short scrolls" },
      { name: "timeoutMs", type: "number", required: false, description: "Navigation+wait budget (default 20000, max 60000)" },
    ],
    handler: async (args) => {
      return await scrape({
        url: String(args.url),
        selector: args.selector ? String(args.selector) : undefined,
        waitFor: args.waitFor ? String(args.waitFor) : undefined,
        screenshot: args.screenshot === true,
        scrollToBottom: args.scrollToBottom === true,
        timeoutMs: args.timeoutMs ? Number(args.timeoutMs) : undefined,
      });
    },
  },
  {
    name: "web.firecrawl",
    description: "Scrape a URL via the Firecrawl hosted service (returns clean markdown of the main content). Use this when a site is gated behind Cloudflare / anti-bot challenges that defeat local Playwright, or when you need consistent main-content extraction without HTML parsing. Requires FIRECRAWL_API_KEY in .env — refuses with a clear message when missing.",
    readonly: true,
    args: [
      { name: "url", type: "string", required: true, description: "Full URL including protocol" },
      { name: "onlyMainContent", type: "boolean", required: false, description: "Strip nav/footer/ads — defaults to true (almost always what you want)" },
      { name: "maxChars", type: "number", required: false, description: "Cap markdown response length (default 80000)" },
      { name: "timeoutMs", type: "number", required: false, description: "Request timeout (default 20000, max 60000)" },
    ],
    handler: async (args) => {
      const { firecrawlEnabled, firecrawlScrape } = await import("./firecrawl.js");
      if (!firecrawlEnabled()) {
        throw new Error("web.firecrawl refused: FIRECRAWL_API_KEY isn't set in clawbot/.env — get a key from firecrawl.dev and add it, then this primitive will be available.");
      }
      const r = await firecrawlScrape({
        url: String(args.url),
        onlyMainContent: args.onlyMainContent !== false,
        maxChars: args.maxChars ? Number(args.maxChars) : undefined,
        timeoutMs: args.timeoutMs ? Number(args.timeoutMs) : undefined,
      });
      return {
        url: r.url,
        title: r.title,
        markdown: r.markdown,
        status: r.status,
        engine: "firecrawl",
      };
    },
  },
  {
    name: "fs.list_external",
    description: "List entries in a directory anywhere on the user's machine. Returns name + size + modified. Skips hidden by default.",
    readonly: true,
    args: [
      { name: "path", type: "string", required: true, description: "Absolute directory path" },
      { name: "depth", type: "number", required: false, description: "Recursive depth (default 1, max 3)" },
    ],
    handler: async (args) => {
      const root = resolve(String(args.path));
      // SECURITY: refuse to enumerate known-sensitive directories (.ssh,
      // .aws, browser profile dirs). Same gate as fs.read_external because
      // a directory listing is the discovery step before exfiltration.
      const { assertSafeExternalPath } = await import("./security-gates.js");
      assertSafeExternalPath(root);
      if (!existsSync(root)) throw new Error(`path not found: ${root}`);
      const maxDepth = Math.min(3, Number(args.depth ?? 1));
      const entries: { path: string; name: string; type: "dir" | "file"; size?: number; modified?: string }[] = [];
      function walk(dir: string, depth: number) {
        if (depth > maxDepth || entries.length > 500) return;
        let xs: any[] = [];
        try { xs = readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of xs) {
          if (e.name.startsWith(".")) continue;
          const full = join(dir, e.name);
          let st: any; try { st = statSync(full); } catch { continue; }
          entries.push({ path: full, name: e.name, type: e.isDirectory() ? "dir" : "file", size: st.size, modified: st.mtime?.toISOString() });
          if (e.isDirectory()) walk(full, depth + 1);
          if (entries.length > 500) break;
        }
      }
      walk(root, 1);
      return { root, count: entries.length, entries };
    },
  },
  {
    name: "fs.read_external",
    // Description tightened so the LLM hands us a real path, not a vault-relative
    // one. We additionally fall back to vault resolution at runtime, so a small
    // hallucination ("notes/foo.md") still produces a result.
    description: "Read a text file from disk. Path MUST be either: (a) an absolute path like 'C:\\foo\\bar.md' or '/home/user/x.txt', OR (b) a path inside the user's Obsidian vault (we will resolve it for you). For vault-only reads prefer the dedicated `vault.read` tool — it returns matches even when the path is partial. Capped at 200 KB.",
    readonly: true,
    args: [{ name: "path", type: "string", required: true, description: "Absolute path OR vault-relative path. Backslashes ok on Windows." }],
    handler: async (args) => {
      const raw = String(args.path ?? "").trim();
      if (!raw) throw new Error("path is empty");
      // SECURITY GATE: refuse known-sensitive paths (.env, SSH keys, cloud
      // creds, browser stores, etc.) before we even touch the filesystem.
      // A prompt-injected LLM could otherwise be coaxed into exfiltrating
      // these via the chat reply. Override via CLAWBOT_FS_UNRESTRICTED=1.
      const { assertSafeExternalPath } = await import("./security-gates.js");
      assertSafeExternalPath(raw);
      // Try the path as given first (absolute or relative-to-CWD).
      const candidates: string[] = [];
      const direct = resolve(raw);
      candidates.push(direct);
      // Also try inside the vault — most LLM "file not found" mistakes are
      // vault-relative paths like "0-Inbox/foo.md" being treated as on-disk
      // paths. Resolving against the vault recovers cleanly.
      if (!raw.match(/^[a-zA-Z]:[\\/]/) && !raw.startsWith("/") && !raw.startsWith("\\")) {
        candidates.push(resolve(config.vaultPath, raw));
      }
      // Re-check the vault-resolved candidate too — vault-relative paths
      // could still resolve to a sensitive location.
      for (const c of candidates) assertSafeExternalPath(c);
      // Pick whichever candidate exists.
      const full = candidates.find(p => existsSync(p));
      if (!full) {
        // Produce a USEFUL error instead of a dead end. We list the parent
        // directory (if it exists) so the LLM has actual filenames to try
        // on the next attempt. The customer-facing chat will surface this
        // verbatim via the fallback-synthesis path.
        const probe = candidates[0];
        const probeParent = probe.replace(/[\\/][^\\/]+$/, "");
        let hint = "";
        if (existsSync(probeParent)) {
          try {
            const siblings = readdirSync(probeParent).slice(0, 10);
            hint = `\nParent directory ${probeParent} contains: ${siblings.map(s => `"${s}"`).join(", ")}${siblings.length === 10 ? ", …" : ""}`;
          } catch { /* ignore */ }
        }
        throw new Error(
          `file not found at any of: ${candidates.map(c => `"${c}"`).join(", ")}. ` +
          `If you meant a file in the vault, try the \`vault.read\` tool with a partial filename.${hint}`,
        );
      }
      const st = statSync(full);
      if (!st.isFile()) throw new Error(`path is a directory, not a file: ${full}. Use fs.list_external or vault.search to enumerate.`);
      // Binary docs (PDF/DOCX/XLSX) get extracted via the doc-extractor so
      // the agent can read what's actually inside, not just see "Untitled.docx"
      // as a filename. Plain text follows the original 200 KB cap to avoid
      // a 50-line config file masquerading as a 50 KB JSON dump.
      const ext = extname(full).toLowerCase();
      const isBinaryDoc = [".pdf", ".docx", ".xlsx", ".xls", ".xlsm"].includes(ext);
      if (isBinaryDoc) {
        const r = await extractDocText(full);
        return {
          content: r.text,
          kind: r.kind,
          size: st.size,
          ext: r.ext,
          name: r.name,
          pages: r.pages,
          sheets: r.sheets,
          truncated: r.truncated,
          resolvedFrom: raw,
          resolvedTo: full,
        };
      }
      if (st.size > 200_000) throw new Error(`file too large (${st.size} bytes, cap 200_000). Use a different tool or extract a section.`);
      return { content: readFileSync(full, "utf8"), size: st.size, ext, name: basename(full), resolvedFrom: raw, resolvedTo: full };
    },
  },
  {
    name: "fs.find_in",
    description: "Find files in a known user folder (downloads / desktop / documents / vault) whose name matches a substring. Use this FIRST when the customer says 'check my downloads for X', 'look in my documents for Y', or just 'whats in this doc X' (use folder='all' for the latter — searches Downloads, Desktop, Documents, and the vault Inbox in parallel). Cross-platform: resolves to ~/Downloads etc. on macOS/Linux and %USERPROFILE%\\Downloads on Windows. Returns matches sorted newest-first so 'the X I just saved' is first.",
    readonly: true,
    args: [
      { name: "folder", type: "string", required: true, description: "Folder shortcut: 'downloads' | 'desktop' | 'documents' | 'vault' | 'inbox' | 'home' | 'all' — or an absolute path. 'all' searches Downloads + Desktop + Documents + Inbox in parallel." },
      { name: "name", type: "string", required: true, description: "Filename substring to match (case-insensitive). E.g. 'AIIA Reference Letter' matches 'AIIA-Reference-Letter.pdf'." },
      { name: "limit", type: "number", required: false, description: "Max matches to return (default 10, cap 50)" },
      { name: "depth", type: "number", required: false, description: "Subfolder recursion depth (default 2, cap 4)" },
    ],
    handler: async (args) => {
      const folderArg = String(args.folder ?? "").trim();
      const nameArg = String(args.name ?? "").trim();
      if (!folderArg) throw new Error("fs.find_in: 'folder' is required");
      if (!nameArg) throw new Error("fs.find_in: 'name' is required");
      const limit = Math.max(1, Math.min(50, Number(args.limit ?? 10)));
      const depth = Math.max(1, Math.min(4, Number(args.depth ?? 2)));
      // Resolve folder shortcut → absolute path, cross-platform.
      // homedir() returns /Users/<user> on macOS, C:\Users\<user> on Windows,
      // /home/<user> on Linux. Default Downloads/Desktop/Documents folders
      // sit directly under that on all three. The "vault" shortcut maps to
      // the configured Obsidian vault path. "home" is allowed but its
      // search still goes through the same security gate, so .ssh/.aws
      // etc. inside ~ get refused. "all" expands to a list — we hit all
      // common user-doc folders so "whats in this doc X" works without
      // the caller having to guess which folder X lives in.
      const home = homedir();
      const shortcuts: Record<string, string> = {
        downloads: join(home, "Downloads"),
        download: join(home, "Downloads"),
        desktop: join(home, "Desktop"),
        documents: join(home, "Documents"),
        docs: join(home, "Documents"),
        home: home,
        vault: config.vaultPath,
        inbox: join(config.vaultPath, "0-Inbox"),
      };
      const lowerArg = folderArg.toLowerCase();
      const roots: string[] = lowerArg === "all" || lowerArg === "any" || lowerArg === "everywhere"
        ? [shortcuts.downloads, shortcuts.desktop, shortcuts.documents, shortcuts.inbox]
        : [shortcuts[lowerArg] ?? resolve(folderArg)];
      // Security gate — refuses .ssh / .aws / cred-store dirs even if the
      // customer somehow asks for them by absolute path. Applied per-root.
      const { assertSafeExternalPath } = await import("./security-gates.js");
      for (const r of roots) assertSafeExternalPath(r);
      const missingRoots = roots.filter(r => !existsSync(r));
      // For 'all' we tolerate missing folders (some users don't have a
      // ~/Desktop) and only fail when EVERY root is missing.
      if (missingRoots.length === roots.length) {
        throw new Error(`fs.find_in: no folders exist at ${missingRoots.map(r => `"${r}"`).join(", ")} (resolved from "${folderArg}").`);
      }
      const livingRoots = roots.filter(r => existsSync(r));
      const needle = nameArg.toLowerCase();
      // Allow simple wildcard support: spaces or hyphens are interchangeable
      // ("AIIA Reference Letter" matches "AIIA-Reference-Letter.pdf"), and
      // multiple needle tokens all need to be present somewhere in the name.
      const needleTokens = needle.replace(/[-_\s]+/g, " ").split(" ").filter(Boolean);
      type Hit = { path: string; name: string; ext: string; size: number; modified: string; folder: string };
      // Per-root listing cache. Many calls in a row hit the same root
      // ("look in my downloads for X", then "ok now find Y", then "find
      // Z") and re-walking Downloads (10k+ files for some users) on
      // every call is the dominant cost. We cache the FULL file list
      // per (root, depth) — needle filtering runs against the cached
      // list, not the disk. The cached list expires when (a) 30s pass
      // OR (b) the root directory's mtime advances past what we saw at
      // cache time (catches a new download landing in the folder).
      const cached = pickCachedListing(livingRoots, depth);
      let allFiles: Hit[];
      if (cached) {
        allFiles = cached;
      } else {
        const collected: Hit[] = [];
        function walk(dir: string, d: number) {
          if (d > depth) return;
          let entries: any[] = [];
          try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
          for (const e of entries) {
            if (e.name.startsWith(".")) continue; // skip hidden / dotfiles
            const full = join(dir, e.name);
            if (e.isDirectory()) { walk(full, d + 1); continue; }
            let st: any;
            try { st = statSync(full); } catch { continue; }
            if (!st.isFile()) continue;
            collected.push({
              path: full,
              name: e.name,
              ext: extname(e.name).toLowerCase(),
              size: st.size,
              modified: st.mtime.toISOString(),
              folder: dir,
            });
          }
        }
        for (const r of livingRoots) walk(r, 1);
        allFiles = collected;
        cacheListing(livingRoots, depth, collected);
      }
      // Filter by needle tokens against the cached listing. Matching
      // logic preserved verbatim: every token must appear in the
      // basename with separators normalised to spaces.
      const hits: Hit[] = [];
      for (const h of allFiles) {
        if (hits.length >= limit) break;
        const normalised = h.name.toLowerCase().replace(/[-_]+/g, " ");
        if (needleTokens.every(t => normalised.includes(t))) hits.push(h);
      }
      // Newest first — "the X I just downloaded" is the most likely match.
      hits.sort((a, b) => (a.modified < b.modified ? 1 : -1));
      return {
        folder: folderArg,
        resolvedRoots: livingRoots,
        // Keep `resolvedRoot` for backwards compat with single-folder callers.
        resolvedRoot: livingRoots[0] ?? "",
        query: nameArg,
        count: hits.length,
        matches: hits,
      };
    },
  },
  {
    name: "fs.import_to_vault",
    description: "Copy a file from the user's PC into their Obsidian vault and write a markdown sidecar so it shows up in NeuroWorks's knowledge view. Use for any 'move/copy/save/import/file this doc into my vault/knowledge/neuroworks' request. Preserves the original on disk by default — the user gets a SEARCHABLE copy in their second brain while the source stays where they had it. Chain with fs.find_in to resolve a partial filename first (e.g. find then import 'AIIA Reference Letter'). Returns the vault-relative paths of both the imported binary and the sidecar so the synth can render a link.",
    readonly: false,
    args: [
      { name: "path", type: "string", required: true, description: "Absolute path to the source file on the user's PC (chain from $step_0.matches.0.path after fs.find_in)" },
      { name: "vaultFolder", type: "string", required: false, description: "Vault destination folder (default '0-Inbox'). Allowed: '0-Inbox', '1-Literature', '1-projects', '2-Permanent'. Use 0-Inbox for fleeting captures, 1-Literature for reference material, 1-projects for project artifacts." },
      { name: "title", type: "string", required: false, description: "Override the sidecar note title (default: extract from filename)" },
      { name: "removeOriginal", type: "boolean", required: false, description: "Delete the source file after import (default false — copy semantics). Set true when the user literally says 'move and delete' or 'remove from downloads'." },
      { name: "summarise", type: "boolean", required: false, description: "Extract a short auto-summary of the doc's text into the sidecar (default true for binary docs)" },
    ],
    handler: async (args) => {
      const src = String(args.path ?? "").trim();
      if (!src) throw new Error("fs.import_to_vault: 'path' is required");
      // SECURITY GATE: don't let an agent import .env or .ssh keys into the
      // vault as a bypass route. assertSafeExternalPath blocks known-sensitive
      // shapes (override with CLAWBOT_FS_UNRESTRICTED=1 for trusted work).
      const { assertSafeExternalPath } = await import("./security-gates.js");
      assertSafeExternalPath(src);
      const fullSrc = resolve(src);
      if (!existsSync(fullSrc)) {
        throw new Error(`fs.import_to_vault: source file not found at "${fullSrc}". If you used a relative path or just a filename, run fs.find_in first to resolve it.`);
      }
      const st = statSync(fullSrc);
      if (!st.isFile()) throw new Error(`fs.import_to_vault: "${fullSrc}" is a directory, not a file. Loop over its contents and import individually.`);

      // Choose vault folder. Allow-list the four standard top-level folders;
      // reject anything weird so the agent can't pollute _clawbot/ etc.
      const requested = String(args.vaultFolder ?? "0-Inbox").trim().replace(/^\/+|\/+$/g, "");
      const allowedFolders = ["0-Inbox", "1-Literature", "1-projects", "2-Permanent"];
      const vaultFolder = allowedFolders.includes(requested) ? requested : "0-Inbox";

      const srcName = basename(fullSrc);
      const ext = extname(srcName).toLowerCase();
      const stem = srcName.slice(0, srcName.length - ext.length);
      // Slug for the sidecar — kebab-case, ASCII, capped at 60 chars so it
      // plays well with Obsidian wikilinks and filesystem limits.
      const slug = stem.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "imported";
      const stamp = new Date().toISOString().slice(0, 10);
      const today = stamp;
      const importedAt = new Date().toISOString();

      // Filename collision: append -2, -3, etc. so we never overwrite an
      // existing vault file.
      function uniqueRel(folder: string, name: string): string {
        const base = name.slice(0, name.length - extname(name).length);
        const baseExt = extname(name);
        let candidate = `${folder}/${name}`;
        let i = 2;
        while (existsSync(resolve(config.vaultPath, candidate))) {
          candidate = `${folder}/${base}-${i}${baseExt}`;
          i++;
        }
        return candidate;
      }
      const binaryRel = uniqueRel(vaultFolder, srcName);
      const sidecarRel = uniqueRel(vaultFolder, `${stamp}-${slug}.md`);

      // 1. Copy the binary into the vault.
      const copied = importBinaryIntoVault(binaryRel, fullSrc);

      // 2. Try to extract a summary if it's a binary doc (PDF/DOCX/XLSX).
      //    For plain markdown/text we read directly. Best-effort — a failed
      //    extraction shouldn't block the import; we still copied the binary.
      const wantSummary = args.summarise !== false;
      const binaryDocExt = new Set([".pdf", ".docx", ".xlsx", ".xls", ".xlsm"]);
      let extractedExcerpt = "";
      let kind = ext.replace(/^\./, "") || "file";
      let pages: number | undefined;
      if (wantSummary) {
        try {
          if (binaryDocExt.has(ext)) {
            const r = await extractDocText(copied.abs);
            extractedExcerpt = (r.text ?? "").slice(0, 2000).trim();
            kind = r.kind || kind;
            pages = r.pages;
          } else if (ext === ".md" || ext === ".markdown" || ext === ".txt") {
            const raw = readFileSync(copied.abs, "utf8");
            // Strip any leading frontmatter so the excerpt is real content.
            const stripped = raw.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
            extractedExcerpt = stripped.slice(0, 2000);
          }
        } catch (e: any) {
          // Don't fail the import — just note that we couldn't extract.
          extractedExcerpt = `_Couldn't auto-extract text (${String(e?.message ?? e).slice(0, 80)}). The binary is still in the vault — open it directly to read._`;
        }
      }

      const noteTitle = String(args.title ?? "").trim() || stem.replace(/[-_]+/g, " ").trim() || srcName;
      const sizeKB = (st.size / 1024).toFixed(1);
      const sidecarBody = [
        `---`,
        `title: "${noteTitle.replace(/"/g, "'")}"`,
        `imported_from: "${fullSrc.replace(/\\/g, "/")}"`,
        `imported_at: ${importedAt}`,
        `created: ${today}`,
        `kind: ${kind}`,
        `size_kb: ${sizeKB}`,
        pages != null ? `pages: ${pages}` : null,
        `tags: [imported, neuroworks]`,
        `---`,
        ``,
        `# ${noteTitle}`,
        ``,
        `Imported from \`${fullSrc}\` on ${today}. Original size ${sizeKB} KB${pages != null ? `, ${pages} page${pages === 1 ? "" : "s"}` : ""}.`,
        ``,
        `The full file is filed in your vault at [[${binaryRel}]] — click through to open it in Obsidian, or browse it under NeuroWorks Knowledge.`,
        ``,
        wantSummary && extractedExcerpt ? `## Excerpt (first ${Math.min(2000, extractedExcerpt.length)} chars)\n\n${extractedExcerpt}\n` : "",
        `## Source provenance`,
        `- Original path: \`${fullSrc}\``,
        `- Imported by: clawbot \`fs.import_to_vault\``,
        `- ${args.removeOriginal === true ? "Original was REMOVED from the PC after import." : "Original preserved on the PC."}`,
        ``,
      ].filter(Boolean).join("\n");

      writeVaultFile(sidecarRel, sidecarBody);
      void enqueueVaultCommit(`neuroworks: import — ${srcName} → ${vaultFolder}`);

      // 3. Optionally remove the original. Only when the user explicitly
      //    asked (removeOriginal=true) — default is COPY semantics so a
      //    misfired "save this to my vault" never destroys the PC copy.
      let removedOriginal = false;
      if (args.removeOriginal === true) {
        try {
          rmSync(fullSrc, { force: false });
          removedOriginal = true;
        } catch (e: any) {
          // Don't fail the import — the vault copy is the important part.
          // Just surface that the removal didn't happen.
          extractedExcerpt += `\n\n_Note: couldn't remove the original at ${fullSrc} (${String(e?.message ?? e).slice(0, 80)}). It's still on your PC._`;
        }
      }

      return {
        importedTo: binaryRel,
        sidecar: sidecarRel,
        originalPath: fullSrc,
        sizeBytes: st.size,
        kind,
        pages,
        excerptChars: extractedExcerpt.length,
        removedOriginal,
        vaultFolder,
        // Hint for the synth: the user wants to know what's in the doc AND
        // that it's been filed. Both bits matter.
        message: `Filed "${srcName}" to your vault at ${binaryRel} (sidecar: ${sidecarRel}).${removedOriginal ? " Original removed from PC." : ""}`,
      };
    },
  },
  {
    name: "web.search",
    description: "Search the public web. Tries DuckDuckGo first; falls back to Bing if DDG returns nothing or fails. Returns up to 10 results as { title, url, snippet } plus the engine that produced them. Use to find sources before web.fetch.",
    readonly: true,
    args: [
      { name: "query", type: "string", required: true, description: "Search query" },
      { name: "limit", type: "number", required: false, description: "Max results (default 8, cap 10)" },
    ],
    handler: async (args) => {
      const query = String(args.query);
      const limit = Math.min(10, Math.max(1, Number(args.limit ?? 8)));
      const r = await searchWeb(query, limit);
      return { query, engine: r.engine, tried: r.tried, results: r.results };
    },
  },
  {
    name: "research.deep",
    description: "Open-ended research on a topic: searches the vault, searches the web, fetches the top sources in parallel, synthesises a cited answer with the local LLM, and (by default) captures a research note in 0-Inbox/. Use this when the user asks about something the vault may not yet cover.",
    readonly: false,
    args: [
      { name: "query", type: "string", required: true, description: "The research question or topic" },
      { name: "depth", type: "number", required: false, description: "Number of web sources to fetch (default 3, cap 5)" },
      { name: "capture", type: "boolean", required: false, description: "If true (default), saves a note to 0-Inbox/ with sources" },
    ],
    handler: async (args) => {
      const query = String(args.query);
      const depth = Math.min(5, Math.max(1, Number(args.depth ?? 3)));
      const capture = args.capture !== false;

      // 1+2. Vault search + web search in PARALLEL — was sequential, costing
      // us the DDG/Bing round-trip (~500-1500ms) before vault even started.
      // Vault search is sync regex over files so it's effectively free; web
      // search is the slow part. Running them via Promise.all overlaps the
      // network round-trip with the regex pass.
      const [vaultHits, webResults] = await Promise.all([
        Promise.resolve().then(() => {
          try { return searchVault(query, 20); }
          catch { return [] as ReturnType<typeof searchVault>; }
        }),
        searchWeb(query, depth).then(s => s.results).catch(() => [] as { title: string; url: string; snippet: string }[]),
      ]);

      // 3. Fetch the top N web pages in parallel via the smart client —
      //    cheap HTTP first, Playwright fallback when blocked/JS-only. Per-URL
      //    cache means a re-search across perspectives hits memory.
      const fetched: { url: string; title: string; text: string; ok: boolean; error?: string; usedBrowser?: boolean }[] = await Promise.all(
        webResults.map(async (w) => {
          try {
            const r = await smartFetch(w.url, { maxBytes: 80_000, timeoutMs: 8_000 });
            return { url: w.url, title: r.title ?? w.title, text: r.text.slice(0, 6_000), ok: true, usedBrowser: r.usedBrowser };
          } catch (e: any) {
            return { url: w.url, title: w.title, text: "", ok: false, error: String(e?.message ?? e) };
          }
        })
      );

      // 4. Synthesise. Combined evidence in, cited answer out.
      const evidence = [
        vaultHits.length > 0 ? `## Vault notes (${vaultHits.length})\n${vaultHits.slice(0, 8).map(h => `- ${h.path}:${h.line} — ${h.preview}`).join("\n")}` : "## Vault notes\n_(none — this topic is new to the vault)_",
        fetched.filter(f => f.ok && f.text).length > 0
          ? `## Web sources\n${fetched.filter(f => f.ok && f.text).map((f, i) => `### [${i + 1}] ${f.title}\n${f.url}\n\n${f.text}`).join("\n\n")}`
          : "## Web sources\n_(none reachable)_",
      ].join("\n\n");

      const sysSynth = "You are clawbot's research synthesiser. Write a concise, evidence-grounded answer to the user's question using ONLY the supplied evidence. Cite sources inline as [vault:path] or [N] (where N matches the web source). If the evidence is thin or contradictory, say so plainly. Keep it under 350 words. Markdown allowed.";
      // Synth in a try/catch so a transient LLM failure doesn't throw away
      // all the web evidence we just fetched. On failure we build a usable
      // fallback from the gathered sources rather than returning an error.
      let synth: string;
      let synthError: string | undefined;
      try {
        // 350-word target ≈ 500 tokens; 512 cap stops the model from rambling
        // past the brief and shaves 10-20s on local Ollama vs the 1024 default.
        synth = await ollamaGenerate(`Question: ${query}\n\n${evidence}\n\nWrite the answer.`, sysSynth, { profile: "synthesis", complexity: "high", maxTokens: 512 } as any);
      } catch (e: any) {
        synthError = String(e?.message ?? e).slice(0, 200);
        const okSources = fetched.filter((f: any) => f.ok && f.text);
        const bullets = okSources.map((f: any, i: number) => {
          const firstSentence = (f.text ?? "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/)[0] ?? "";
          return `[${i + 1}] **${f.title}** (${f.url}) — ${firstSentence.slice(0, 240)}`;
        }).join("\n\n");
        synth = `## Partial result\n\nThe synthesiser couldn't run (\`${synthError}\`), so here are the sources I gathered for: **${query}**\n\n### Vault hits\n${vaultHits.length > 0 ? vaultHits.slice(0, 5).map((h: any) => `- ${h.path}:${h.line} — ${h.preview}`).join("\n") : "_(none)_"}\n\n### Web sources\n${bullets || "_(no reachable web sources)_"}\n\n_Review the sources directly and try again later._`;
      }

      // 5. Capture as a 0-Inbox note. The vault MOC says: fleeting / unprocessed
      //    thoughts go here. Promote later when matured into atomic insight.
      let captured: { path: string } | undefined;
      if (capture) {
        const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
        const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "research";
        const path = `0-Inbox/${stamp}-research-${slug}.md`;
        const today = new Date().toISOString().slice(0, 10);
        const sourcesBlock = fetched.filter(f => f.ok).map((f, i) => `${i + 1}. [${f.title}](${f.url})`).join("\n") || "_(no reachable web sources)_";
        const md = `---\ntitle: "Research: ${query.replace(/"/g, "'").slice(0, 120)}"\ncreated: ${today}\nsource: clawbot-research\n---\n\n# Research: ${query}\n\n${synth.trim()}\n\n## Web sources\n${sourcesBlock}\n\n## Vault hits at time of research\n${vaultHits.slice(0, 8).map(h => `- [[${h.path}]] (line ${h.line})`).join("\n") || "_(none)_"}\n`;
        try {
          writeVaultFile(path, md);
          captured = { path };
          void enqueueVaultCommit(`neuroworks: research — ${slug}`);
        } catch { /* don't fail the whole research because the note didn't write */ }
      }

      return {
        query,
        answer: synth.trim(),
        vaultHits: vaultHits.slice(0, 8),
        webSources: fetched.map(f => ({ url: f.url, title: f.title, ok: f.ok, error: f.error })),
        captured,
      };
    },
  },
  {
    name: "research.multiperspective",
    description: "Investigate a topic from MULTIPLE perspectives in parallel. Fans out sub-agents (each one a different framing: mainstream consensus, critical / skeptic, practitioner / applied, recent developments) — searches the web from each angle, fetches top sources, and synthesises a structured cross-perspective report with citations. Use for any task asking to 'analyse', 'research', 'explain X', 'investigate', or 'compare perspectives on X'. Captures the report to 0-Inbox/.",
    readonly: false,
    args: [
      { name: "topic", type: "string", required: true, description: "The topic or question to investigate" },
      { name: "perspectives", type: "string", required: false, description: "Comma-separated custom perspectives. Default: 'mainstream, critical, practitioner, recent'" },
      { name: "sourcesPerPerspective", type: "number", required: false, description: "Top web sources to fetch per perspective (default 2, cap 4)" },
      { name: "capture", type: "boolean", required: false, description: "If true (default), saves the report to 0-Inbox/" },
    ],
    handler: async (args) => {
      const topic = String(args.topic);
      const perspectivesRaw = String(args.perspectives ?? "").trim();
      const perspectives = (perspectivesRaw
        ? perspectivesRaw.split(",").map(s => s.trim()).filter(Boolean)
        : ["mainstream", "critical", "practitioner", "recent"]
      ).slice(0, 6);
      const sourcesPer = Math.min(4, Math.max(1, Number(args.sourcesPerPerspective ?? 2)));
      const capture = args.capture !== false;

      // Vault-first — read whatever the user already has. Surface as one
      // additional "perspective" so synth can compare external findings to the
      // user's own notes.
      const vaultHits = searchVault(topic, 20);

      // Each perspective gets its own framed query. The framings are
      // heuristic templates tuned to bias DDG's results toward that angle —
      // not perfect, but cheap and reproducible.
      const framingTemplates: Record<string, (t: string) => string> = {
        mainstream: t => `${t} overview definition`,
        critical: t => `${t} criticism limitations problems`,
        practitioner: t => `${t} case study practical example how to`,
        recent: t => `${t} 2026 latest news update`,
        historical: t => `${t} history origin background`,
        contrarian: t => `${t} contrarian view alternative perspective`,
        academic: t => `${t} research paper study findings`,
        beginner: t => `${t} beginner introduction simple explanation`,
      };

      const perspectiveQueries = perspectives.map(name => {
        const key = name.toLowerCase().replace(/[^a-z]+/g, "");
        const tmpl = framingTemplates[key];
        const query = tmpl ? tmpl(topic) : `${topic} ${name}`;
        return { name, query };
      });

      // Run all perspective searches in parallel — each is a sub-agent doing
      // independent work. Uses the hardened searchWeb (DDG → Bing fallback)
      // and fetchWeb (readability + per-URL cache), so a source shared
      // across perspectives is fetched exactly once.
      const perspectiveResults = await Promise.all(perspectiveQueries.map(async ({ name, query }) => {
        let webResults: { title: string; url: string; snippet: string }[] = [];
        try {
          const s = await searchWeb(query, sourcesPer);
          webResults = s.results;
        } catch { /* tolerate per-perspective failure */ }
        const fetched = await Promise.all(webResults.map(async (w) => {
          try {
            const r = await smartFetch(w.url, { maxBytes: 60_000, timeoutMs: 8_000 });
            return { url: w.url, title: r.title ?? w.title, text: r.text.slice(0, 4_000), ok: true, usedBrowser: r.usedBrowser };
          } catch (e: any) {
            return { url: w.url, title: w.title, text: "", ok: false, error: String(e?.message ?? e) };
          }
        }));
        return { name, query, sources: fetched };
      }));

      // Build a global numbered source list. Synth cites as [N].
      const numbered: { ref: number; perspective: string; url: string; title: string; text: string }[] = [];
      let n = 1;
      for (const p of perspectiveResults) {
        for (const s of p.sources) {
          if (s.ok && s.text) {
            numbered.push({ ref: n++, perspective: p.name, url: s.url, title: s.title, text: s.text });
          }
        }
      }

      // Synthesis prompt: enforce the structured shape the Researcher persona
      // expects. The synth model returns the body of a research note.
      const evidence = perspectiveResults.map(p => {
        const refs = p.sources.filter(s => s.ok).map(s => {
          const idx = numbered.find(x => x.url === s.url)?.ref;
          return `[${idx}] ${s.title}\n${s.text}`;
        }).join("\n\n");
        return `### Perspective: ${p.name}\nSearch query: "${p.query}"\n${refs || "_(no reachable sources)_"}`;
      }).join("\n\n");
      const vaultBlock = vaultHits.length > 0
        ? `\n### Vault notes (${vaultHits.length})\n${vaultHits.slice(0, 8).map(h => `- [[${h.path}]] (line ${h.line}) — ${h.preview}`).join("\n")}`
        : "";

      const sysSynth = `You are a structured research synthesiser. Write a single multi-perspective research note from the supplied evidence.

Output shape (use these exact section headings):
## Topic statement
One paragraph framing the question precisely.

## Perspectives
A subsection per perspective with the perspective name as ### heading. Inside, write 2-4 sentences summarising what THAT perspective's sources say, citing each substantive claim as [N].

## Cross-cutting themes
Bullet list of points where perspectives converged, with [N] citations.

## Open questions
Bullet list of unresolved or contested claims, naming which perspectives disagree.

## Bottom line
One paragraph — your best honest synthesis, with the strongest caveats called out.

Rules:
- Never invent claims. If a perspective had no sources, say so explicitly in its section.
- When perspectives contradict, NAME the contradiction. Don't paper over.
- Cite every substantive claim as [N]. If you can't cite it, drop the claim.
- Markdown only. No code fences around the whole thing.`;

      // Synth via the LLM. THIS is the call that historically threw "fetch
      // failed" when Ollama was briefly down — and because synth ran outside
      // any try/catch, the per-perspective web evidence (which DID succeed)
      // got thrown away with it. Now: if synth throws, we build a usable
      // fallback report directly from the gathered evidence so the customer
      // still gets value out of the run.
      let synth: string;
      let synthError: string | undefined;
      try {
        // Multi-perspective notes have 5 fixed sections — typically 400-600
        // words / ~800 tokens. 768 is plenty without giving the model room
        // to spiral into a wall-of-text. ~15-30s saved on local Ollama.
        synth = await ollamaGenerate(
          `Topic: ${topic}\n\nEvidence:\n${evidence}\n${vaultBlock}\n\nWrite the structured research note.`,
          sysSynth,
          { profile: "synthesis", complexity: "high", maxTokens: 768 } as any,
        );
      } catch (e: any) {
        synthError = String(e?.message ?? e).slice(0, 200);
        // Fallback report: stitch the gathered evidence into the same shape
        // the synth would have produced, but without the LLM's polish. Better
        // than throwing 5 minutes of fetched web content into the bin.
        const fallbackPerspectives = perspectiveResults.map(p => {
          const usable = p.sources.filter(s => s.ok && s.text);
          if (usable.length === 0) {
            return `### Perspective: ${p.name}\n_(no reachable sources for query "${p.query}")_`;
          }
          const bullets = usable.map(s => {
            const idx = numbered.find(x => x.url === s.url)?.ref;
            const firstSentence = s.text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/)[0] ?? "";
            return `- [${idx}] **${s.title}** — ${firstSentence.slice(0, 200)}`;
          }).join("\n");
          return `### Perspective: ${p.name}\n${bullets}`;
        }).join("\n\n");
        synth = `## Topic statement\n${topic}\n\n## Perspectives\n\n${fallbackPerspectives}\n\n## Cross-cutting themes\n_(synthesis step failed: \`${synthError}\` — manual review of the sources below recommended)_\n\n## Open questions\n_(synthesis unavailable)_\n\n## Bottom line\n_The LLM synthesiser couldn't run. Sources are listed; the customer should review them directly._`;
      }

      // Capture to vault — uses the same 0-Inbox/ pattern as research.deep so
      // the user's existing flow (promote to 2-Permanent via Knowledge page)
      // works on these notes too.
      let captured: { path: string } | undefined;
      if (capture) {
        const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
        const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "research";
        const path = `0-Inbox/${stamp}-multiperspective-${slug}.md`;
        const today = new Date().toISOString().slice(0, 10);
        const sourcesBlock = numbered.length > 0
          ? numbered.map(s => `${s.ref}. [${s.title}](${s.url}) *(${s.perspective})*`).join("\n")
          : "_(no reachable web sources)_";
        const md = `---
title: "Multi-perspective: ${topic.replace(/"/g, "'").slice(0, 120)}"
created: ${today}
source: clawbot-multiperspective
perspectives: [${perspectives.map(p => `"${p}"`).join(", ")}]
tags: [research, multiperspective]
---

# Multi-perspective research: ${topic}

${synth.trim()}

## Sources
${sourcesBlock}

## Vault hits at time of research
${vaultHits.slice(0, 8).map(h => `- [[${h.path}]] (line ${h.line})`).join("\n") || "_(none)_"}
`;
        try {
          writeVaultFile(path, md);
          captured = { path };
          void enqueueVaultCommit(`neuroworks: multiperspective — ${slug}`);
        } catch { /* tolerate */ }
      }

      return {
        topic,
        perspectives: perspectives,
        answer: synth.trim(),
        vaultHits: vaultHits.slice(0, 8),
        perspectiveResults: perspectiveResults.map(p => ({
          name: p.name,
          query: p.query,
          sources: p.sources.map(s => ({ url: s.url, title: s.title, ok: s.ok, error: s.error })),
        })),
        sourceCount: numbered.length,
        captured,
      };
    },
  },
  {
    name: "peer.delegate",
    description: "Hand a task off to a peer clawbot (the lightest-loaded one). Returns the peer's final answer once the peer's job completes. Use when the local clawbot is overloaded or when you want a second model's perspective.",
    readonly: true,
    args: [
      { name: "task", type: "string", required: true, description: "Plain-English task to delegate" },
      { name: "persona", type: "string", required: false, description: "Optional persona id to apply on the peer" },
    ],
    handler: async (args) => {
      const task = String(args.task);
      const persona = args.persona ? String(args.persona) : undefined;
      return await delegateToBestPeer({ task, persona });
    },
  },
  {
    name: "peer.review",
    description: "Send a draft answer to a peer clawbot for quality review. Returns { verdict, issues, revised_answer, confidence }. Use after synthesising a non-trivial answer to catch errors and tighten prose.",
    readonly: true,
    args: [
      { name: "task", type: "string", required: true, description: "The original task / question" },
      { name: "answer", type: "string", required: true, description: "The draft answer to review" },
    ],
    handler: async (args) => {
      const task = String(args.task);
      const answer = String(args.answer);
      return await reviewWithPeer({ task, answer });
    },
  },
  {
    name: "quality.check",
    description: "Score a draft answer on three axes — factuality_risk, citation_coverage, persona_fit — and return { pass, score, issues }. Cheaper and more structured than peer.review; use after synthesis to catch hallucinations and missing citations.",
    readonly: true,
    args: [
      { name: "task", type: "string", required: true, description: "The original task / question" },
      { name: "answer", type: "string", required: true, description: "The draft answer to check" },
      { name: "sources", type: "string", required: false, description: "Optional sources/evidence text (comma-separated paths or free text)" },
    ],
    handler: async (args) => {
      const task = String(args.task);
      const answer = String(args.answer);
      const sources = args.sources ? String(args.sources) : "";
      const sys = `You are a quality scorer for an agent's draft answer. Score the draft on three axes from 0.0 (worst) to 1.0 (best):
1. factuality_risk — likelihood the answer contains hallucinated or unsupported claims (1.0 means high risk; lower is better).
2. citation_coverage — fraction of substantive claims backed by a cited source (paths, URLs, or clearly attributed quotes).
3. persona_fit — match between the answer's tone/structure and what the task asked for.

Output ONLY a JSON object, no prose, no fences:
{"factuality_risk":<0..1>,"citation_coverage":<0..1>,"persona_fit":<0..1>,"issues":["<short>",...],"pass":<true|false>}

Pass is true when factuality_risk < 0.4 AND citation_coverage > 0.4 AND persona_fit > 0.5.`;
      // The output is a small JSON blob (~80-200 tokens). 256 tokens is a
      // generous cap that stops the model from rambling and shaves 3-8s off
      // this call on local Ollama versus the default 1024-token budget.
      const raw = await ollamaGenerate(`Task: ${task}\n\nDraft answer:\n${answer}${sources ? `\n\nSources:\n${sources.slice(0, 4000)}` : ""}`, sys, { profile: "extraction", maxTokens: 256 });
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) return { pass: false, factuality_risk: 1, citation_coverage: 0, persona_fit: 0, issues: ["scorer returned no JSON"], raw };
      try {
        const parsed = JSON.parse(m[0]);
        const score = (1 - clamp01(parsed.factuality_risk)) * 0.4 + clamp01(parsed.citation_coverage) * 0.3 + clamp01(parsed.persona_fit) * 0.3;
        return {
          pass: parsed.pass === true,
          factuality_risk: clamp01(parsed.factuality_risk),
          citation_coverage: clamp01(parsed.citation_coverage),
          persona_fit: clamp01(parsed.persona_fit),
          score: Math.round(score * 100) / 100,
          issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 6).map((s: any) => String(s).slice(0, 200)) : [],
        };
      } catch {
        return { pass: false, factuality_risk: 1, citation_coverage: 0, persona_fit: 0, issues: ["scorer JSON unparseable"], raw };
      }
    },
  },
  {
    name: "security.scan",
    description: "Scan a blob of text for secrets, suspicious URLs, and command-injection markers before it gets written to the vault or pushed to GitHub. Returns { pass, findings, redacted }. Use as a pre-flight before any vault.write of agent-generated content.",
    readonly: true,
    args: [
      { name: "content", type: "string", required: true, description: "Text to scan" },
      { name: "kind", type: "string", required: false, description: "Optional context: 'note' | 'code' | 'commit-message' (default 'note')" },
    ],
    handler: async (args) => {
      const content = String(args.content);
      const kind = String(args.kind ?? "note") as SecurityKind;
      const findings = scanForSecurityRisks(content, kind);
      const high = findings.filter(f => f.severity === "high").length;
      const redacted = high > 0 ? redactHighSeverity(content, findings) : content;
      return { pass: high === 0, findings, redacted, kind };
    },
  },
  {
    name: "brave.list_tabs",
    description: "List the URLs and titles of every open tab in the user's Brave browser (read-only). Requires the user to launch Brave with --remote-debugging-port=9222 AND set CLAWBOT_BRAVE_READ=1 in .env. Returns { url, title, contextIndex, pageIndex } per tab — use the indices with brave.read_tab to fetch a specific tab's content. Refuses with a clear setup message when Brave isn't reachable.",
    readonly: true,
    args: [],
    handler: async () => {
      const { listBraveTabs } = await import("./brave.js");
      const tabs = await listBraveTabs();
      return { count: tabs.length, tabs };
    },
  },
  {
    name: "brave.read_tab",
    description: "Read the visible text of a specific tab in the user's Brave browser (read-only — no clicks, no navigation). Use the (contextIndex, pageIndex) returned by brave.list_tabs. Optionally pass a CSS `selector` to extract just one section, or `maxChars` to cap content size (default 20000).",
    readonly: true,
    args: [
      { name: "contextIndex", type: "number", required: true, description: "Window index from brave.list_tabs" },
      { name: "pageIndex", type: "number", required: true, description: "Tab index within the window from brave.list_tabs" },
      { name: "selector", type: "string", required: false, description: "CSS selector to extract instead of full page text" },
      { name: "maxChars", type: "number", required: false, description: "Cap response text length (default 20000, max 80000)" },
    ],
    handler: async (args) => {
      const { readBraveTab } = await import("./brave.js");
      return await readBraveTab({
        contextIndex: Number(args.contextIndex),
        pageIndex: Number(args.pageIndex),
        selector: args.selector ? String(args.selector) : undefined,
        maxChars: args.maxChars ? Number(args.maxChars) : undefined,
      });
    },
  },
  {
    name: "brave.search_tabs",
    description: "Find open Brave tabs whose URL or title matches a query (case-insensitive substring). Cheaper than reading every tab when the user references one in particular ('the GitHub issue I had open'). Returns up to `limit` matching tabs in the same shape as brave.list_tabs.",
    readonly: true,
    args: [
      { name: "query", type: "string", required: true, description: "Substring to match against URL or title" },
      { name: "limit", type: "number", required: false, description: "Max matches (default 10, cap 50)" },
    ],
    handler: async (args) => {
      const { searchBraveTabs } = await import("./brave.js");
      const limit = Math.min(50, Math.max(1, Number(args.limit ?? 10)));
      const tabs = await searchBraveTabs(String(args.query), limit);
      return { query: String(args.query), count: tabs.length, tabs };
    },
  },
  {
    name: "skill.list",
    description: "List all available skill playbooks the agent can load for guidance (research-deep, email-writing, code-review, summarization, brief-writing, meeting-notes, vault-organization, planning-doc). Each entry returns name, description, and which intents it applies_to. Use this to discover what guidance is on offer for a given task shape.",
    readonly: true,
    args: [],
    handler: async () => {
      const { listSkills } = await import("./skills.js");
      const skills = listSkills();
      return {
        count: skills.length,
        skills: skills.map(s => ({ name: s.name, description: s.description, applies_to: s.applies_to, source: s.source })),
      };
    },
  },
  {
    name: "skill.load",
    description: "Load a skill playbook by name (e.g. 'email-writing', 'code-review'). Returns the full markdown body — use it as additional system guidance before producing the deliverable. List available skills with skill.list first if unsure which to pull.",
    readonly: true,
    args: [
      { name: "name", type: "string", required: true, description: "Skill name (from skill.list)" },
    ],
    handler: async (args) => {
      const { loadSkill } = await import("./skills.js");
      const skill = loadSkill(String(args.name));
      if (!skill) throw new Error(`Skill not found: "${args.name}". Run skill.list to see what's available.`);
      return { name: skill.name, description: skill.description, applies_to: skill.applies_to, source: skill.source, body: skill.body };
    },
  },
  {
    name: "skill.suggest",
    description: "Suggest the most relevant skill playbook(s) for a given intent. Pass the intent label (draft-email, summarize, review, plan, research, etc.) and get back up to 2 matching skills, sorted by specificity. Useful right after intent detection to know which playbook to load before drafting.",
    readonly: true,
    args: [
      { name: "intent", type: "string", required: true, description: "Intent label (e.g. 'draft-email', 'summarize', 'review')" },
      { name: "limit", type: "number", required: false, description: "Max suggestions to return (default 2, cap 4)" },
    ],
    handler: async (args) => {
      const { suggestSkillsForIntent } = await import("./skills.js");
      const limit = Math.min(4, Math.max(1, Number(args.limit ?? 2)));
      const suggestions = suggestSkillsForIntent(String(args.intent), limit);
      return {
        intent: String(args.intent),
        suggestions: suggestions.map(s => ({ name: s.name, description: s.description, applies_to: s.applies_to })),
      };
    },
  },
  {
    name: "skill.draft",
    description: "Ask the LLM to write a brand-new skill playbook for an intent that has no curated skill yet. The draft gets saved to skills/_user/ and immediately becomes available to skill.list / skill.suggest. Use this when the agent has tried a task and lacked the guidance needed — close the loop by writing the missing playbook.",
    readonly: false,
    args: [
      { name: "intent", type: "string", required: true, description: "Intent label to target (e.g. 'draft-email', 'design-review')" },
      { name: "taskSample", type: "string", required: true, description: "The actual user request that exposed the skill gap — gives the drafter context" },
      { name: "failureReason", type: "string", required: false, description: "Optional: what went wrong last time, so the drafted skill addresses it" },
    ],
    handler: async (args) => {
      const { draftSkillForIntent } = await import("./skills.js");
      const skill = await draftSkillForIntent({
        intent: String(args.intent),
        taskSample: String(args.taskSample),
        failureReason: args.failureReason ? String(args.failureReason) : undefined,
      });
      if (!skill) {
        throw new Error(`skill.draft: the LLM produced an unusable draft (missing frontmatter / too short). Try again with a more specific failureReason.`);
      }
      return {
        drafted: skill.name,
        path: skill.path,
        applies_to: skill.applies_to,
        description: skill.description,
        bodyChars: skill.body.length,
      };
    },
  },
  {
    name: "skill.fetch_remote",
    description: "Fetch a skill .md file from a public URL (e.g. a GitHub raw URL or gist) and save it under skills/_user/ so it joins the local catalog. REQUIRES the user to have opted in via CLAWBOT_REMOTE_SKILLS=1 in .env — refuses otherwise. Use to pull in community-curated playbooks.",
    readonly: false,
    args: [
      { name: "url", type: "string", required: true, description: "HTTPS URL to a raw .md file with optional YAML frontmatter (name/description/applies_to)" },
    ],
    handler: async (args) => {
      const { fetchRemoteSkill } = await import("./skills.js");
      const r = await fetchRemoteSkill(String(args.url));
      return {
        saved: r.saved,
        skill: { name: r.skill.name, description: r.skill.description, applies_to: r.skill.applies_to, source: r.skill.source },
      };
    },
  },
  {
    name: "clock.now",
    description: "Return the current local + UTC time. Useful when scheduling or stamping notes.",
    readonly: true,
    args: [],
    handler: async () => {
      const d = new Date();
      return { iso: d.toISOString(), local: d.toString(), date: d.toISOString().slice(0, 10), unix: Math.floor(d.getTime() / 1000) };
    },
  },
];

void sep;

export function findPrimitive(name: string): Primitive | undefined {
  return primitives.find(p => p.name === name);
}

export function primitivesPromptCatalog(opts: { compact?: boolean } = {}): string {
  const compact = opts.compact === true;
  return primitives.map(p => {
    if (compact) {
      // Compact mode: just args by name (drop types) and the first sentence of
      // the description. Cuts the planner prompt by ~40% without losing the
      // signal the model uses to pick tools.
      const argsList = p.args.length === 0 ? "()" : `(${p.args.map(a => `${a.name}${a.required ? "" : "?"}`).join(",")})`;
      const firstSentence = p.description.split(/(?<=[.!?])\s+/)[0].slice(0, 140);
      return `- ${p.name}${argsList}${p.readonly ? "" : " [WRITE]"} — ${firstSentence}`;
    }
    const argsList = p.args.length === 0 ? "(none)" : p.args.map(a => `${a.name}:${a.type}${a.required ? "" : "?"}`).join(", ");
    return `- ${p.name}(${argsList})${p.readonly ? "" : " [WRITE]"} — ${p.description}`;
  }).join("\n");
}

// Suppress unused warning while config import is preserved for future authentication-aware primitives.
void config;

// Plain-English label for a step, used in the chat UI so users see
// "Searching your second brain for 'X'" instead of `vault.search(query="X")`.
export function humanStepLabel(tool: string, args: Record<string, any> = {}): string {
  const a = args ?? {};
  const s = (k: string) => (typeof a[k] === "string" ? a[k] : "");
  switch (tool) {
    case "vault.search":       return s("query") ? `Searching your second brain for "${s("query")}"` : "Searching your second brain";
    case "vault.read":         return s("path") ? `Reading ${s("path")}` : "Reading a doc";
    case "vault.scan_docs":    return s("folder") ? `Scanning docs in ${s("folder")}` : "Scanning docs across the vault";
    case "vault.edit":         return s("path") ? `Editing ${s("path")}` : "Editing a vault doc";
    case "vault.list":         return s("path") ? `Listing ${s("path")}` : "Listing your vault";
    case "vault.write":        return s("path") ? `Writing ${s("path")}` : "Writing a note";
    case "vault.append":       return s("path") ? `Adding to ${s("path")}` : "Adding to a note";
    case "vault.create_zettel":return s("title") ? `Creating zettel "${s("title")}"` : "Creating a zettel";
    case "vault.find_by_tag":  return s("tag") ? `Finding notes tagged #${s("tag")}` : "Finding tagged notes";
    case "github.list_repos":  return "Listing your GitHub repos";
    case "github.read_repo":   return s("name") ? `Reading the ${s("name")} repo` : "Reading a GitHub repo";
    case "github.list_branches":return s("name") ? `Listing branches in ${s("name")}` : "Listing branches";
    case "github.get_file":    return s("path") && s("name") ? `Fetching ${s("path")} from ${s("name")}` : "Fetching a file from GitHub";
    case "github.create_issue":return s("title") ? `Opening issue "${s("title")}"` : "Opening a GitHub issue";
    case "ollama.generate":    return "Thinking about it";
    case "web.fetch":          return s("url") ? `Reading ${s("url")}` : "Reading a webpage";
    case "web.scrape":         return s("url") ? `Browsing ${s("url")} (Playwright)` : "Browsing a webpage";
    case "web.firecrawl":      return s("url") ? `Scraping ${s("url")} (Firecrawl)` : "Scraping via Firecrawl";
    case "brave.list_tabs":    return "Listing your open Brave tabs";
    case "brave.read_tab":     return "Reading a Brave tab";
    case "brave.search_tabs":  return s("query") ? `Finding Brave tabs matching "${s("query")}"` : "Searching your Brave tabs";
    case "skill.list":         return "Listing available skills";
    case "skill.load":         return s("name") ? `Loading the "${s("name")}" skill` : "Loading a skill";
    case "skill.suggest":      return "Picking the right skill for this task";
    case "skill.fetch_remote": return s("url") ? `Pulling skill from ${s("url")}` : "Pulling a remote skill";
    case "skill.draft":        return s("intent") ? `Drafting a "${s("intent")}" skill` : "Drafting a new skill";
    case "fs.list_external":   return s("path") ? `Looking inside ${s("path")}` : "Browsing your files";
    case "fs.read_external":   return s("path") ? `Reading ${s("path")}` : "Reading a file";
    case "fs.find_in": {
      const folder = s("folder");
      const name = s("name");
      if (!folder || !name) return "Searching your local folders";
      const f = folder.toLowerCase();
      const where = (f === "all" || f === "any" || f === "everywhere")
        ? "your Downloads, Desktop, Documents, and vault Inbox"
        : `your ${folder}`;
      return `Looking in ${where} for "${name}"`;
    }
    case "fs.import_to_vault": {
      const path = s("path");
      const folder = s("vaultFolder") || "0-Inbox";
      if (!path) return "Filing a file into your second brain";
      const file = path.split(/[\\/]/).pop() ?? path;
      return `Filing "${file}" into your second brain (${folder})`;
    }
    case "clock.now":          return "Checking the clock";
    case "web.search":         return s("query") ? `Searching the web for "${s("query")}"` : "Searching the web";
    case "research.deep":      return s("query") ? `Researching "${s("query").slice(0, 80)}${s("query").length > 80 ? "…" : ""}" — vault + web` : "Researching";
    case "research.multiperspective": return s("topic") ? `Multi-perspective research: "${s("topic")}"` : "Multi-perspective research";
    case "peer.delegate":      return s("task") ? `Delegating to a peer clawbot` : "Delegating to a peer";
    case "peer.review":        return "Asking a peer to review the draft";
    case "quality.check":      return "Quality-checking the draft";
    case "security.scan":      return s("kind") ? `Security-scanning the ${s("kind")}` : "Security-scanning the content";
    default:                   return tool;
  }
}

function clamp01(n: any): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

// parseDdgLite/parseBing live in lib/web-client.ts now — the primitives use
// the hardened client for all web search and fetch operations.
