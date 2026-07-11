import { existsSync, readdirSync, readFileSync, statSync, appendFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, basename, extname, sep, join, dirname } from "node:path";
import { config } from "../config.js";
import { ollamaGenerate, ollamaGenerateWithMeta } from "./ollama.js";
import { listVault, readVaultFile, searchVault, writeVaultFile, importBinaryIntoVault } from "./vault.js";
import { extractDocText, extractDocsParallel } from "./doc-extractor.js";
import { listOwnedRepos, recentCommits, openPRs, openIssues, readme, octokit } from "./github.js";
import { getSourceByLabel, getSource, runQuery, describeSource, listSources } from "./data-sources.js";
import { publishDataset, listDatasets } from "./adrs.js";
import { acquire as omniAcquire, acquireAndPublish as omniAcquirePublish, type OmniSpec } from "./omnisignal.js";
import { getConnectionByProvider } from "./integrations.js";
import { delegateToBestPeer, reviewWithPeer } from "./peers.js";
import { scanForSecurityRisks, redactHighSeverity, type SecurityKind } from "./security.js";
import { scrape, interact, renderMarkdownToPdf, type InteractAction } from "./browser.js";
import { enqueueVaultCommit } from "./commit-queue.js";
import { searchWeb, smartFetch } from "./web-client.js";
import { classifyDeliverable } from "./deliverable.js";
import { checkContentAgainstGovernance } from "./governance.js";

export type ArgSpec = { name: string; type: "string" | "number" | "boolean"; required: boolean; description: string };

export type Primitive = {
  name: string;
  description: string;
  args: ArgSpec[];
  // true = read-only, won't mutate state. used to decide whether a plan needs approval.
  readonly: boolean;
  handler: (args: Record<string, any>) => Promise<any>;
};

// Resolve a fs.find_in-style folder shortcut ("downloads" | "desktop" |
// "documents" | "vault" | "inbox" | "home" | "all" | an absolute path) to
// real root path(s). Exported so agent.ts's plan-repair step (converting a
// malformed fs.find_in call with no `name` into a proper fs.list_external
// listing) can resolve the same folder word without duplicating this table.
export function resolveFsFolderRoots(folderArg: string): string[] {
  const home = homedir();
  const shortcuts: Record<string, string> = {
    downloads: join(home, "Downloads"),
    download: join(home, "Downloads"),
    desktop: join(home, "Desktop"),
    documents: join(home, "Documents"),
    docs: join(home, "Documents"),
    music: join(home, "Music"),
    pictures: join(home, "Pictures"),
    photos: join(home, "Pictures"),
    videos: join(home, "Videos"),
    home: home,
    vault: config.vaultPath,
    inbox: join(config.vaultPath, "0-Inbox"),
  };
  const lowerArg = folderArg.toLowerCase();
  // "all" previously meant Downloads+Desktop+Documents+Inbox only — Music/
  // Pictures/Videos were completely unreachable under ANY "all" search
  // regardless of query, which is exactly wrong for "find my song/photo/clip"
  // (reproduced live 2026-07-10: a real "Dont Miss (Prod P.A).mp3" sitting in
  // Music was reported as "zero matches" because the search never looked
  // there, not because the file didn't exist).
  return lowerArg === "all" || lowerArg === "any" || lowerArg === "everywhere"
    ? [shortcuts.downloads, shortcuts.desktop, shortcuts.documents, shortcuts.music, shortcuts.pictures, shortcuts.videos, shortcuts.inbox]
    : [shortcuts[lowerArg] ?? resolve(folderArg)];
}

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
const FIND_CACHE_TTL_MS = Number(process.env.NEUROWORKS_FIND_CACHE_TTL_MS ?? "30000");
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

// Editor / OS junk that should never be returned as a "document" by file search.
// The big one: Office owner-lock stubs named "~$<file>.docx" — tiny (~162-byte)
// non-document files Office writes while a doc is open. They share the real
// file's name, sort newest-first, and aren't valid zip/docx, so an extractor
// hits "zip container cannot be read". Also: temp/partial downloads and
// Windows Thumbs.db. Caller already skips dotfiles separately.
export function isJunkFileName(name: string): boolean {
  return (
    /^~\$/.test(name) ||                         // Office owner-lock stub (~$Report.docx)
    /^~wrl\d+\.tmp$/i.test(name) ||              // Word temp file
    /\.(tmp|temp|crdownload|part|partial|download)$/i.test(name) || // in-progress / temp
    name.toLowerCase() === "thumbs.db" ||
    name.toLowerCase() === "desktop.ini"
  );
}

// Flexible list-arg parser — a planner-emitted value that's semantically a
// list arrives in one of several shapes depending on the model: an already-
// parsed array, a JSON-array string, or a comma-separated string. Used for
// any arg that can take multiple values (email.send's `to`, `attach_paths`).
function parseFlexibleList(raw: any): string[] {
  let items: any[] = [];
  if (Array.isArray(raw)) items = raw;
  else if (typeof raw === "string" && raw.trim()) {
    const s = raw.trim();
    if (s.startsWith("[")) {
      try { const parsed = JSON.parse(s); items = Array.isArray(parsed) ? parsed : [s]; }
      catch { items = s.split(","); }
    } else {
      items = s.split(",");
    }
  }
  return items.map((x: any) => String(x ?? "").trim()).filter(Boolean);
}

// db.* error helper — distinguishes "nothing registered at all" from "wrong
// label" so the synth (and the operator reading the run log) doesn't read a
// bad-label typo and a genuinely-unconfigured system as the same failure.
// 2026-07-09 reflection: db.query/db.describe_table failed 6/6 combined runs
// instantly (0s) with a bare "not found" message that didn't say WHY.
function noSourceError(label: string): string {
  if (listSources().length === 0) {
    return `db: no data sources are registered at all (asked for "${label}"). Connect one on the Data Sources page, or via connector.call for an external API — db.* has nothing to query yet.`;
  }
  return `Data source "${label}" not found — use db.list_sources to see available sources`;
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
    description: "Edit an existing markdown file in the vault according to an instruction. Reads the file, applies the edit (via LLM), scans the result for secrets, writes it back, and commits. REQUIRES the user to have authorised vault edits via NEUROWORKS_VAULT_EDIT=1 in .env — otherwise this tool refuses. Markdown only; refuses to edit binary docs.",
    readonly: false,
    args: [
      { name: "path", type: "string", required: true, description: "Vault-relative path to the .md file to edit" },
      { name: "instruction", type: "string", required: true, description: "What to change. Be specific — e.g. 'Add a Risks section at the end' or 'Replace the second paragraph with a clearer version'." },
    ],
    handler: async (args) => {
      // Top-level approval gate. The customer authorises vault editing by
      // setting NEUROWORKS_VAULT_EDIT=1 in .env. Until they do, the tool refuses
      // — this protects against unintended overwrites by an agent that picks
      // vault.edit speculatively. The refusal message tells the customer
      // exactly what to do.
      if (process.env.NEUROWORKS_VAULT_EDIT !== "1") {
        throw new Error("vault.edit refused: vault editing isn't authorised. To allow clawbot to edit docs in your vault, set NEUROWORKS_VAULT_EDIT=1 in clawbot/.env and restart the server.");
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
    name: "github.comment_on_issue",
    description: "Comment on a GitHub issue or pull request. Provide owner, repo, issue/PR number, and the comment body (markdown).",
    readonly: false,
    args: [
      { name: "owner", type: "string", required: true, description: "GitHub owner" },
      { name: "name", type: "string", required: true, description: "Repo name" },
      { name: "issueNumber", type: "number", required: true, description: "Issue or PR number" },
      { name: "body", type: "string", required: true, description: "Comment body (markdown)" },
    ],
    handler: async (args) => {
      const { data } = await octokit.issues.createComment({ owner: String(args.owner), repo: String(args.name), issue_number: Number(args.issueNumber), body: String(args.body) });
      return { id: data.id, url: data.html_url };
    },
  },
  {
    name: "github.update_issue",
    description: "Update an issue's title, body, state, or labels. Standard GitHub API — pass only the fields you want to change.",
    readonly: false,
    args: [
      { name: "owner", type: "string", required: true, description: "GitHub owner" },
      { name: "name", type: "string", required: true, description: "Repo name" },
      { name: "issueNumber", type: "number", required: true, description: "Issue number" },
      { name: "title", type: "string", required: false, description: "New title" },
      { name: "body", type: "string", required: false, description: "New body (markdown)" },
      { name: "state", type: "string", required: false, description: "New state: open or closed" },
      { name: "labels", type: "string", required: false, description: "Comma-separated labels to set" },
    ],
    handler: async (args) => {
      const payload: any = { owner: String(args.owner), repo: String(args.name), issue_number: Number(args.issueNumber) };
      if (args.title !== undefined) payload.title = String(args.title);
      if (args.body !== undefined) payload.body = String(args.body);
      if (args.state !== undefined) payload.state = String(args.state);
      if (args.labels !== undefined) payload.labels = String(args.labels).split(",").map(s => s.trim()).filter(Boolean);
      const { data } = await octokit.issues.update(payload);
      return { number: data.number, url: data.html_url, state: data.state, labels: data.labels?.map((l: any) => l.name) };
    },
  },
  {
    name: "github.request_review",
    description: "Request review on a pull request from specific reviewers. Pass owner, repo, PR number, and a comma-separated list of GitHub usernames as reviewers.",
    readonly: false,
    args: [
      { name: "owner", type: "string", required: true, description: "GitHub owner" },
      { name: "name", type: "string", required: true, description: "Repo name" },
      { name: "pullNumber", type: "number", required: true, description: "Pull request number" },
      { name: "reviewers", type: "string", required: true, description: "Comma-separated GitHub usernames to request review from" },
    ],
    handler: async (args) => {
      const reviewers = String(args.reviewers).split(",").map(s => s.trim()).filter(Boolean);
      const { data } = await octokit.pulls.requestReviewers({ owner: String(args.owner), repo: String(args.name), pull_number: Number(args.pullNumber), reviewers });
      return { requestedReviewers: data.requested_reviewers?.map((r: any) => r.login) ?? reviewers };
    },
  },
  {
    name: "github.list_issues",
    description: "List open issues for a repo. Optionally filter by label (comma-separated) or assignee. Returns number, title, author, labels, url.",
    readonly: true,
    args: [
      { name: "owner", type: "string", required: true, description: "GitHub owner" },
      { name: "name", type: "string", required: true, description: "Repo name" },
      { name: "labels", type: "string", required: false, description: "Comma-separated labels to filter by" },
      { name: "assignee", type: "string", required: false, description: "Filter by assignee username" },
      { name: "state", type: "string", required: false, description: "Issue state: open (default), closed, all" },
    ],
    handler: async (args) => {
      const state = (String(args.state ?? "open")) as "open" | "closed" | "all";
      const { data } = await octokit.issues.listForRepo({
        owner: String(args.owner), repo: String(args.name),
        state,
        ...(args.labels ? { labels: String(args.labels) } : {}),
        ...(args.assignee ? { assignee: String(args.assignee) } : {}),
        per_page: 50,
      });
      return { issues: data.map(i => ({ number: i.number, title: i.title, author: i.user?.login, labels: i.labels?.map((l: any) => l.name), state: i.state, url: i.html_url, createdAt: i.created_at })) };
    },
  },
  // ── Database connector primitives (db.*) ──
  {
    name: "db.list_sources",
    description: "List all connected database/file sources with their labels, kinds, and read-only status. Handy way to discover what source name to pass to other db.* primitives.",
    readonly: true,
    args: [],
    handler: async () => {
      const sources = listSources().map(s => ({
        id: s.id,
        label: s.label,
        kind: s.kind,
        notes: s.notes,
        department: s.department,
        readonly: s.readonly,
      }));
      return { sources };
    },
  },
  {
    name: "db.list_tables",
    description: "List available tables/collections in a connected data source. Source is identified by label (case-insensitive). For Excel sources, tables are the sheet names.",
    readonly: true,
    args: [
      { name: "source", type: "string", required: true, description: "Source label (case-insensitive)" },
    ],
    handler: async (args) => {
      const source = getSourceByLabel(String(args.source));
      if (!source) throw new Error(noSourceError(String(args.source)));
      const info = await describeSource(source);
      const tables = info.tables.map(t => ({
        name: t.name,
        columnCount: t.columns.length,
        columns: t.columns.map(c => `${c.name}:${c.type}`).join(", "),
      }));
      return { source: source.label, kind: source.kind, tables };
    },
  },
  {
    name: "db.describe_table",
    description: "Describe a specific table/column in a connected data source. Source by label, table by name. Returns column names with their data types.",
    readonly: true,
    args: [
      { name: "source", type: "string", required: true, description: "Source label (case-insensitive)" },
      { name: "table", type: "string", required: true, description: "Table name (or sheet name for Excel sources)" },
    ],
    handler: async (args) => {
      const source = getSourceByLabel(String(args.source));
      if (!source) throw new Error(noSourceError(String(args.source)));
      const info = await describeSource(source);
      const table = info.tables.find(t => t.name.toLowerCase() === String(args.table).toLowerCase());
      if (!table) throw new Error(`Table "${args.table}" not found in "${args.source}". Available: ${info.tables.map(t => t.name).join(", ")}`);
      return { source: source.label, kind: source.kind, table: table.name, columns: table.columns };
    },
  },
  {
    name: "db.query",
    description: "Run SQL (or query document) on a connected data source. Source is identified by label (case-insensitive). For SQL databases: pass standard SQL — SELECT / WITH / EXPLAIN / DESCRIBE. For MongoDB: pass a JSON document like {\"collection\":\"users\",\"filter\":{\"active\":true},\"limit\":50}. For Excel/CSV: pass a JSON like {\"sheet\":\"Sheet1\",\"filter\":{\"col\":\"Status\",\"op\":\"eq\",\"val\":\"Active\"},\"limit\":100}. Respects the source's read-only setting — writes are blocked unless the source was configured with writes enabled.",
    readonly: true,
    args: [
      { name: "source", type: "string", required: true, description: "Source label (case-insensitive)" },
      { name: "query", type: "string", required: true, description: "SQL statement or JSON query document" },
      { name: "limit", type: "number", required: false, description: "Max rows to return (default 200)" },
    ],
    handler: async (args) => {
      const source = getSourceByLabel(String(args.source));
      if (!source) throw new Error(noSourceError(String(args.source)));
      const limit = Math.max(1, Math.min(5000, Number(args.limit ?? 200)));
      const result = await runQuery(source, String(args.query), limit);
      return {
        source: source.label,
        kind: source.kind,
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
        truncated: result.truncated,
      };
    },
  },
  {
    name: "db.write",
    description: "INSERT/UPDATE/DELETE on a database source. Requires operator approval (HITL gate). The approval request shows the SQL, target source, and estimated impact. Only works on sources configured with writes enabled (readonly=false).",
    readonly: false,
    args: [
      { name: "source", type: "string", required: true, description: "Source label (case-insensitive)" },
      { name: "query", type: "string", required: true, description: "SQL statement (INSERT/UPDATE/DELETE)" },
      { name: "dryRun", type: "boolean", required: false, description: "If true, show what would happen without executing (default true for safety)" },
    ],
    handler: async (args) => {
      const source = getSourceByLabel(String(args.source));
      if (!source) throw new Error(`Data source "${args.source}" not found`);
      if (source.readonly) throw new Error(`Source "${args.source}" is read-only — request the operator to enable writes in Company Data settings`);
      const sql = String(args.query);
      const dryRun = args.dryRun !== false;
      if (dryRun) {
        // Return a preview without executing.
        return {
          source: source.label,
          kind: source.kind,
          sql,
          preview: true,
          message: `Preview of write to "${source.label}". A human operator will review this before execution. Submit with dryRun=false to execute.`,
        };
      }
      const result = await runQuery(source, sql);
      return {
        source: source.label,
        kind: source.kind,
        affected: result.rowCount,
        columns: result.columns,
        rows: result.rows,
      };
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
    description: "Persist a Zettelkasten permanent note to disk (2-Permanent/). Use ONLY when the user explicitly asks to SAVE / CAPTURE / FILE / STORE / ADD-TO-MY-VAULT a note. Do NOT use for tasks that just transform inline content into a deliverable (\"turn this transcript into action items\", \"rewrite this as a KB article\", \"format this as a memo\") — those want ollama.generate to produce the output in the response, not a vault write.",
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
    name: "web.interact",
    description: "Multi-step headless-browser session. Navigate, fill form fields, click, wait, take screenshots, extract text — up to 8 steps per call, 90s total wall budget. Use for tasks that need real browser actions (a search box + submit, a multi-step wizard, a JS-only page that only renders after a button click). Each step is structured so the planner never has to generate Playwright code.",
    readonly: false,
    args: [
      { name: "url", type: "string", required: true, description: "Initial URL to navigate to" },
      { name: "steps", type: "string", required: true, description: "JSON array (or already-parsed array) of step actions. Each is { type: 'navigate'|'fill'|'click'|'wait_for'|'wait_ms'|'extract'|'screenshot', ...params }. navigate {url}, fill {selector, value}, click {selector}, wait_for {selector, timeoutMs?}, wait_ms {ms}, extract {selector?}, screenshot {name?}." },
      { name: "totalTimeoutMs", type: "number", required: false, description: "Overall wall budget for the whole session (default 90000, max 120000)" },
    ],
    handler: async (args) => {
      let rawSteps: unknown = args.steps;
      if (typeof rawSteps === "string") { try { rawSteps = JSON.parse(rawSteps); } catch { rawSteps = []; } }
      const steps: InteractAction[] = Array.isArray(rawSteps) ? (rawSteps as InteractAction[]) : [];
      return await interact({
        startUrl: String(args.url),
        steps,
        totalTimeoutMs: args.totalTimeoutMs ? Number(args.totalTimeoutMs) : undefined,
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
          if (isJunkFileName(e.name)) continue; // hide Office lock stubs / temp / Thumbs.db
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
    name: "fs.extract_zip",
    description: "Extract a .zip archive on the user's machine into a folder, then return the list of files it contained. Use when the user says 'extract/unzip X', or when a task needs the contents of a .zip you found. Path MUST be an absolute path (e.g. $step_N.matches.0.path from fs.find_in). Extracts to a sibling '<name>-extracted/' folder unless 'dest' is given; read the resulting files with fs.read_external afterward. NOTE: .docx/.xlsx/.pptx are technically zips too but are handled by fs.read_external / doc.ocr — use this only for real .zip archives.",
    readonly: false,
    args: [
      { name: "path", type: "string", required: true, description: "Absolute path to the .zip file" },
      { name: "dest", type: "string", required: false, description: "Destination folder (default: a sibling '<name>-extracted' folder beside the archive)" },
    ],
    handler: async (args) => {
      const raw = String(args.path ?? "").trim();
      if (!raw) throw new Error("fs.extract_zip: 'path' is required");
      const zipPath = resolve(raw);
      const { assertSafeExternalPath } = await import("./security-gates.js");
      assertSafeExternalPath(zipPath);
      if (!existsSync(zipPath) || !statSync(zipPath).isFile()) throw new Error(`fs.extract_zip: no file at ${zipPath}`);
      const dest = resolve(String(args.dest ?? "").trim() || join(dirname(zipPath), `${basename(zipPath, extname(zipPath))}-extracted`));
      assertSafeExternalPath(dest);

      let AdmZip: any;
      try { AdmZip = (await import("adm-zip")).default ?? (await import("adm-zip")); }
      catch { throw new Error("zip support not installed — run `pnpm -C server add adm-zip`"); }
      let zip: any;
      try { zip = new AdmZip(zipPath); }
      catch (e: any) { return { error: `not a readable zip archive (it may be corrupt or not actually a zip): ${e?.message ?? e}` }; }

      let entries: any[];
      try { entries = zip.getEntries(); }
      catch (e: any) { return { error: `could not read the zip directory: ${e?.message ?? e}` }; }

      // Zip-bomb guard: cap entry count + total uncompressed size.
      const MAX_ENTRIES = 2000, MAX_TOTAL = 500 * 1024 * 1024;
      let total = 0;
      for (const en of entries) total += Number(en?.header?.size ?? 0);
      if (entries.length > MAX_ENTRIES) return { error: `refused: archive has ${entries.length} entries (cap ${MAX_ENTRIES})` };
      if (total > MAX_TOTAL) return { error: `refused: archive expands to ~${Math.round(total / 1048576)}MB (cap ${Math.round(MAX_TOTAL / 1048576)}MB)` };

      // Zip-slip guard: every entry must resolve INSIDE dest (no "../" escapes,
      // no absolute paths). Validate ALL before extracting anything.
      const destPrefix = dest.endsWith(sep) ? dest : dest + sep;
      for (const en of entries) {
        const target = resolve(dest, en.entryName);
        if (target !== dest && !target.startsWith(destPrefix)) {
          return { error: `refused: archive entry "${en.entryName}" would write outside the destination (zip-slip attempt)` };
        }
      }
      try { zip.extractAllTo(dest, /* overwrite */ true); }
      catch (e: any) { return { error: `extraction failed: ${e?.message ?? e}` }; }

      const files = entries
        .filter((en: any) => !en.isDirectory)
        .map((en: any) => ({ name: String(en.entryName), size: Number(en?.header?.size ?? 0) }));
      return {
        ok: true,
        extractedTo: dest,
        fileCount: files.length,
        files: files.slice(0, 200),
        truncated: files.length > 200,
      };
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
      // these via the chat reply. Override via NEUROWORKS_FS_UNRESTRICTED=1.
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
      if (!st.isFile()) {
        // Directory passed in — give back a structured listing instead of
        // erroring. The synth model can then report "the folder contains X,
        // Y, Z" rather than the chain dead-ending. We surface the doc files
        // first (PDF/DOCX/MD/...), then everything else.
        const DOC_EXTS_R = new Set([".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".md", ".markdown", ".txt", ".rtf", ".odt", ".ods", ".odp", ".csv"]);
        const entries = readdirSync(full, { withFileTypes: true });
        const docs: { name: string; path: string; ext: string }[] = [];
        const other: { name: string; path: string; ext: string }[] = [];
        for (const e of entries) {
          if (e.name.startsWith(".")) continue;
          const inner = resolve(full, e.name);
          const innerExt = extname(e.name).toLowerCase();
          (DOC_EXTS_R.has(innerExt) ? docs : other).push({ name: e.name, path: inner, ext: innerExt });
        }
        return {
          content: `Directory listing for ${full}:\n\nDocuments (${docs.length}):\n${docs.map(d => `- ${d.name}`).join("\n")}\n\nOther entries (${other.length}):\n${other.slice(0, 20).map(d => `- ${d.name}`).join("\n")}\n\nHint: call fs.read_external again with one of the document paths above (e.g. "${docs[0]?.path ?? other[0]?.path ?? full}") to read its content.`,
          kind: "directory",
          isDirectory: true,
          entries: [...docs, ...other.slice(0, 20)],
          documentCount: docs.length,
          resolvedFrom: raw,
          resolvedTo: full,
        };
      }
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
    description: "Find files in a known user folder (downloads / desktop / documents / music / pictures / videos / vault) whose name matches a substring. Use this FIRST when the customer says 'check my downloads for X', 'find this song', 'find that photo', or just 'whats in this doc X' (use folder='all' for the latter — searches Downloads, Desktop, Documents, Music, Pictures, Videos, and the vault Inbox in parallel). For a song/track/audio request prefer folder='music' first (faster, and the file is almost always there) before falling back to folder='all'. Cross-platform: resolves to ~/Downloads etc. on macOS/Linux and %USERPROFILE%\\Downloads on Windows. Returns matches sorted by how closely the name matches (an exact-ish match beats a token buried in a much longer name, e.g. an auto-captured vault research note titled after a whole sentence); ties fall back to newest-first so 'the X I just saved' wins among equally-good matches.",
    readonly: true,
    args: [
      { name: "folder", type: "string", required: true, description: "Folder shortcut: 'downloads' | 'desktop' | 'documents' | 'music' | 'pictures' | 'videos' | 'vault' | 'inbox' | 'home' | 'all' — or an absolute path. Use 'music' for a song/track/audio-file request, 'pictures' for a photo/image. 'all' searches Downloads + Desktop + Documents + Music + Pictures + Videos + Inbox in parallel." },
      { name: "name", type: "string", required: true, description: "Filename substring to match (case-insensitive). E.g. 'Aiia Reference Letter' matches 'Aiia-Reference-Letter.pdf'." },
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
      const roots = resolveFsFolderRoots(folderArg);
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
      // Unicode normalisation — when the planner copies the user's task
      // verbatim, the needle can contain non-breaking hyphens (U+2011),
      // en/em dashes (U+2013/2014), smart quotes (U+2018/U+2019/U+201C/
      // U+201D), nbsp (U+00A0), and ellipsis (U+2026). The filename on
      // disk uses plain ASCII, so any of those characters in the needle
      // would block every token from matching. Convert to ASCII first.
      function asciifyForSearch(s: string): string {
        return s
          .replace(/[‐-―−]/g, "-")    // various dashes → ASCII hyphen
          .replace(/[‘’‚‛]/g, "'") // smart single quotes → '
          .replace(/[“”„‟]/g, '"') // smart double quotes → "
          .replace(/ /g, " ")                    // nbsp → space
          .replace(/…/g, "...");                  // ellipsis → ...
      }
      const needle = asciifyForSearch(nameArg).toLowerCase();
      // Allow simple wildcard support: spaces or hyphens are interchangeable
      // ("Aiia Reference Letter" matches "Aiia-Reference-Letter.pdf"), and
      // multiple needle tokens all need to be present somewhere in the name.
      // Strip common noise words so a planner-generated needle like "the
      // CUT student offer letter" still finds "CUT_student_offer_letter.docx"
      // — without this the "the" token blocks every match.
      const NOISE_WORDS = new Set([
        // articles / prepositions / conjunctions
        "the", "a", "an", "of", "for", "with", "and", "or", "to", "in",
        "from", "on", "at", "by", "as", "into", "about",
        // file-meta words
        "called", "named", "titled", "labelled", "labeled",
        "file", "doc", "document", "pdf", "docx", "xlsx", "pptx", "txt", "markdown", "md",
        // pronouns / fillers
        "my", "your", "this", "that", "those", "these", "any", "some",
        "please", "kindly", "just", "also", "then", "now",
        // action verbs the planner often drags into the needle
        "find", "search", "look", "locate", "fetch", "grab", "get", "show",
        "list", "check", "view", "browse", "open", "read", "give", "send",
        "share", "summarize", "summarise", "summary", "summarized", "summarise",
        "review", "scan", "tell", "describe", "analyze", "analyse",
      ]);
      const rawTokens = needle.replace(/[-_\s]+/g, " ").split(" ").filter(Boolean);
      const filtered = rawTokens.filter(t => !NOISE_WORDS.has(t));
      // If filtering removed EVERY token (e.g. needle was "the doc"), keep
      // the raw tokens — better to over-match than to silently match all.
      const needleTokens = filtered.length > 0 ? filtered : rawTokens;
      type Hit = { path: string; name: string; ext: string; size: number; modified: string; folder: string; type?: "file" | "dir"; matchedFolder?: string };
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
            if (isJunkFileName(e.name)) continue;  // skip Office lock stubs (~$x.docx), temp/partial downloads, Thumbs.db
            const full = join(dir, e.name);
            if (e.isDirectory()) {
              // Directories are now candidate matches too — "summarize
              // Master Tender on my desktop" wants the folder, not a file.
              // We still recurse so files inside also become candidates.
              let dst: any;
              try { dst = statSync(full); } catch { /* tolerate */ }
              if (dst) {
                collected.push({
                  path: full,
                  name: e.name,
                  ext: "",
                  size: 0,
                  modified: dst.mtime.toISOString(),
                  folder: dir,
                  type: "dir",
                });
              }
              walk(full, d + 1);
              continue;
            }
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
              type: "file",
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
      function filterHits(files: Hit[]): Hit[] {
        const out: Hit[] = [];
        for (const h of files) {
          if (out.length >= limit) break;
          const normalised = asciifyForSearch(h.name).toLowerCase().replace(/[-_]+/g, " ");
          if (needleTokens.every(t => normalised.includes(t))) out.push(h);
        }
        return out;
      }
      // Fuzzy fallback — when strict ALL-tokens match yields nothing AND
      // the needle has 4+ content tokens, accept filenames where ≥70% of
      // the tokens match. Guards against the planner sneaking one stray
      // action-verb into a otherwise-good needle (e.g. "summarize CUT
      // student offer letter" → "summarize" missing from filename, but
      // the other 4 tokens hit). Conservative threshold + token-count
      // floor stops it firing on short needles where 1/2 match is noise.
      function fuzzyHits(files: Hit[], minMatch: number): Hit[] {
        const scored: { h: Hit; score: number }[] = [];
        for (const h of files) {
          const normalised = asciifyForSearch(h.name).toLowerCase().replace(/[-_]+/g, " ");
          let matched = 0;
          for (const t of needleTokens) if (normalised.includes(t)) matched += 1;
          if (matched >= minMatch) scored.push({ h, score: matched });
        }
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, limit).map(s => s.h);
      }
      let hits = filterHits(allFiles);
      if (hits.length === 0 && needleTokens.length >= 4) {
        const minMatch = Math.max(2, Math.ceil(needleTokens.length * 0.7));
        hits = fuzzyHits(allFiles, minMatch);
      }
      // Directory-aware expansion. If the strongest matches are DIRECTORIES
      // (e.g. "Master Tender" is a folder, not a file), expand each into the
      // documents it contains so a downstream fs.read_external chain hits an
      // actual document. The directory itself stays in the results as the
      // FIRST entry so the agent can still report what folder it found. We
      // expand at most 2 dirs and 10 inner docs to keep the response bounded.
      const DOC_EXTS = new Set([".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".md", ".markdown", ".txt", ".rtf", ".odt", ".ods", ".odp", ".csv"]);
      const dirHits = hits.filter(h => h.type === "dir").slice(0, 2);
      if (dirHits.length > 0) {
        const expanded: Hit[] = [];
        for (const dh of dirHits) {
          try {
            const inner = readdirSync(dh.path, { withFileTypes: true });
            const docs: Hit[] = [];
            for (const e of inner) {
              if (e.name.startsWith(".")) continue;
              if (!e.isFile()) continue;
              const innerExt = extname(e.name).toLowerCase();
              if (!DOC_EXTS.has(innerExt)) continue;
              const innerFull = join(dh.path, e.name);
              let innerSt: any;
              try { innerSt = statSync(innerFull); } catch { continue; }
              docs.push({
                path: innerFull,
                name: e.name,
                ext: innerExt,
                size: innerSt.size,
                modified: innerSt.mtime.toISOString(),
                folder: dh.path,
                type: "file",
                matchedFolder: dh.name,
              });
            }
            docs.sort((a, b) => (a.modified < b.modified ? 1 : -1));
            expanded.push(...docs.slice(0, 10));
          } catch { /* tolerate per-dir read failure */ }
        }
        // Files inside matched folders go BEFORE the folder itself so
        // fs.read_external picks a real document via matches[0].path.
        const fileHits = hits.filter(h => h.type !== "dir");
        hits = [...expanded, ...fileHits, ...dirHits].slice(0, limit);
      }
      // Zero-hit safety net — Windows NTFS doesn't always bump the
      // parent folder's mtime when a file lands inside it, so the cache
      // freshness check can miss a newly-downloaded file. If the search
      // returned NOTHING and we were reading from cache, re-walk once
      // (uncached) to make sure the absence is real.
      if (hits.length === 0 && cached) {
        const fresh: Hit[] = [];
        function walkFresh(dir: string, d: number) {
          if (d > depth) return;
          let entries: any[] = [];
          try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
          for (const e of entries) {
            if (e.name.startsWith(".")) continue;
            const full = join(dir, e.name);
            if (e.isDirectory()) {
              let dst: any;
              try { dst = statSync(full); } catch { /* tolerate */ }
              if (dst) {
                fresh.push({
                  path: full,
                  name: e.name,
                  ext: "",
                  size: 0,
                  modified: dst.mtime.toISOString(),
                  folder: dir,
                  type: "dir",
                });
              }
              walkFresh(full, d + 1);
              continue;
            }
            let st: any;
            try { st = statSync(full); } catch { continue; }
            if (!st.isFile()) continue;
            fresh.push({
              path: full,
              name: e.name,
              ext: extname(e.name).toLowerCase(),
              size: st.size,
              modified: st.mtime.toISOString(),
              folder: dir,
              type: "file",
            });
          }
        }
        for (const r of livingRoots) walkFresh(r, 1);
        cacheListing(livingRoots, depth, fresh);
        hits = filterHits(fresh);
        if (hits.length === 0 && needleTokens.length >= 4) {
          const minMatch = Math.max(2, Math.ceil(needleTokens.length * 0.7));
          hits = fuzzyHits(fresh, minMatch);
        }
      }
      // Match-quality first, newest as a tie-breaker. Pure recency sort let
      // a short, unrelated-but-token-overlapping name outrank the actual
      // target whenever it happened to be newer — e.g. an auto-captured
      // vault research note titled after the whole task sentence
      // ("...summit-recon-conso-to-all-the-.md", 893 bytes) outranked the
      // real "Summit Recon CONSO.xlsx" (610KB) because the note was
      // created more recently by an earlier failed attempt at the same
      // task, even though the needle only explains a small fraction of the
      // note's much longer slugified name (2026-07-09 incident: the wrong
      // file was actually emailed to 5 people before this fix). Score =
      // fraction of the basename (extension stripped) the matched needle
      // tokens actually cover — near 1.0 for an exact-ish match, low for a
      // token buried in a long unrelated name. Near-ties (genuinely
      // comparable matches) still fall back to newest-first, preserving
      // "the X I just downloaded" for the common multi-candidate case.
      function matchQuality(h: Hit): number {
        const base = h.name.replace(/\.[^.]+$/, "");
        const normalised = asciifyForSearch(base).toLowerCase().replace(/[-_]+/g, " ");
        if (normalised.length === 0) return 0;
        const covered = needleTokens.reduce((sum, t) => sum + (normalised.includes(t) ? t.length : 0), 0);
        return covered / normalised.length;
      }
      hits.sort((a, b) => {
        const dq = matchQuality(b) - matchQuality(a);
        if (Math.abs(dq) > 0.05) return dq;
        return a.modified < b.modified ? 1 : -1;
      });
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
    description: "Copy a file from the user's PC into their Obsidian vault and write a markdown sidecar so it shows up in NeuroWorks's knowledge view. Use for any 'move/copy/save/import/file this doc into my vault/knowledge/neuroworks' request. Preserves the original on disk by default — the user gets a SEARCHABLE copy in their second brain while the source stays where they had it. Chain with fs.find_in to resolve a partial filename first (e.g. find then import 'Aiia Reference Letter'). Returns the vault-relative paths of both the imported binary and the sidecar so the synth can render a link.",
    readonly: false,
    args: [
      { name: "path", type: "string", required: true, description: "Absolute path to the source file on the user's PC (chain from $step_0.matches.0.path after fs.find_in)" },
      { name: "vaultFolder", type: "string", required: false, description: "Vault destination folder (default '0-Inbox'). Standard Zettel folders: '0-Inbox' for fleeting captures, '1-Literature' for reference material, '1-projects' for project artifacts, '2-Permanent' for promoted notes. Custom folders (e.g. 'meetings', '2024-Q3/wins', 'team/sales') are auto-created. System folders ('_clawbot', '_archive', '_neuroworks', '.git', '.obsidian') and absolute or traversal paths are rejected — falls back to '0-Inbox' if unsafe." },
      { name: "title", type: "string", required: false, description: "Override the sidecar note title (default: extract from filename)" },
      { name: "removeOriginal", type: "boolean", required: false, description: "Delete the source file after import (default false — copy semantics). Set true when the user literally says 'move and delete' or 'remove from downloads'." },
      { name: "summarise", type: "boolean", required: false, description: "Extract a short auto-summary of the doc's text into the sidecar (default true for binary docs)" },
    ],
    handler: async (args) => {
      const src = String(args.path ?? "").trim();
      if (!src) throw new Error("fs.import_to_vault: 'path' is required");
      // SECURITY GATE: don't let an agent import .env or .ssh keys into the
      // vault as a bypass route. assertSafeExternalPath blocks known-sensitive
      // shapes (override with NEUROWORKS_FS_UNRESTRICTED=1 for trusted work).
      const { assertSafeExternalPath } = await import("./security-gates.js");
      assertSafeExternalPath(src);
      const fullSrc = resolve(src);
      if (!existsSync(fullSrc)) {
        throw new Error(`fs.import_to_vault: source file not found at "${fullSrc}". If you used a relative path or just a filename, run fs.find_in first to resolve it.`);
      }
      const st = statSync(fullSrc);
      if (!st.isFile()) throw new Error(`fs.import_to_vault: "${fullSrc}" is a directory, not a file. Loop over its contents and import individually.`);

      // Choose vault folder. The four standard Zettelkasten folders pass
      // through verbatim. ANY OTHER user-named folder ("meetings", "2024-Q3",
      // "projects/atlas") is accepted as long as it's a safe relative path —
      // mkdirSync inside importBinaryIntoVault will auto-create it on first
      // use. Previously the allow-list silently rewrote unknown folders to
      // 0-Inbox, which surprised users who asked to file uploads under their
      // own categories.
      // Guard rails — reject anything that could escape the vault, hit a
      // system-managed folder (where NeuroWorks tooling assumes ownership),
      // or look like an absolute path.
      const requested = String(args.vaultFolder ?? "0-Inbox").trim().replace(/^\/+|\/+$/g, "").replace(/\\/g, "/");
      const SYSTEM_PREFIXES = ["_clawbot", "_archive", "_neuroworks", ".git", ".obsidian"];
      const isSafeUserFolder = (p: string): boolean => {
        if (!p || p.length > 200) return false;
        if (/^[A-Za-z]:|^[/\\]/.test(p)) return false;            // no absolute paths
        if (p.split("/").some(seg => seg === "" || seg === "." || seg === "..")) return false; // no traversal
        if (!/^[A-Za-z0-9_./-]+$/.test(p)) return false;          // safe chars only
        const top = p.split("/")[0];
        if (SYSTEM_PREFIXES.some(prefix => top === prefix)) return false;
        return true;
      };
      const vaultFolder = isSafeUserFolder(requested) ? requested : "0-Inbox";

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
      // Depth cap is env-tunable (NEUROWORKS_RESEARCH_MAX_DEPTH, default 3).
      // Jobs 36172d9e/b6d90f2a burned ~346s each in research.deep — most of it
      // fetch+synth over sources 4-5 that rarely change the answer. Planners
      // habitually ask for depth 3; anything above the cap now clamps.
      const DEPTH_CAP = Math.min(5, Math.max(1, Number(process.env.NEUROWORKS_RESEARCH_MAX_DEPTH ?? "3")));
      const depth = Math.min(DEPTH_CAP, Math.max(1, Number(args.depth ?? 2)));
      const capture = args.capture !== false;

      // 1+2. Vault search + web search in PARALLEL — was sequential, costing
      // us the DDG/Bing round-trip (~500-1500ms) before vault even started.
      // Vault search is sync regex over files so it's effectively free; web
      // search is the slow part. Running them via Promise.all overlaps the
      // network round-trip with the regex pass.
      const [vaultHits, webResults] = await Promise.all([
        Promise.resolve().then(() => {
          try {
            // Exclude agent-internal job-tracker files (_neuroworks/jobs/*) —
            // those are scratch records of past runs, not real user knowledge.
            // Without this filter, research.deep cites its own past outputs as
            // "vault sources", which inflates citation_coverage with
            // self-referential noise and degrades grounding. Chat already
            // applies the same exclusion in agent.ts. Matches the path style
            // searchVault returns (forward-slash).
            return searchVault(query, 20).filter(h => !/^_neuroworks\/jobs\//i.test(h.path));
          }
          catch { return [] as ReturnType<typeof searchVault>; }
        }),
        searchWeb(query, depth).then(s => s.results).catch(() => [] as { title: string; url: string; snippet: string }[]),
      ]);

      // 3. Fetch the top N web pages in parallel via the smart client —
      //    cheap HTTP first, Playwright fallback when blocked/JS-only. Per-URL
      //    cache means a re-search across perspectives hits memory.
      const fetched: { url: string; title: string; text: string; ok: boolean; error?: string; usedBrowser?: boolean; status?: number; engine?: "http" | "browser" | "firecrawl" | "unknown" }[] = await Promise.all(
        webResults.map(async (w) => {
          try {
            const r = await smartFetch(w.url, { maxBytes: 80_000, timeoutMs: 8_000 });
            return {
              url: w.url,
              title: r.title ?? w.title,
              text: r.text.slice(0, 6_000),
              ok: true,
              usedBrowser: r.usedBrowser,
              status: (r as any).status,
              engine: ((r as any).engine ?? (r.usedBrowser ? "browser" : "http")) as any,
            };
          } catch (e: any) {
            return { url: w.url, title: w.title, text: "", ok: false, error: String(e?.message ?? e) };
          }
        })
      );

      // 3b. SOURCE VALIDATION — strict mode. Drops auth walls, captcha
      //     pages, 4xx/5xx, thin extractions, AND zero-relevance sources;
      //     ranks the survivors by query-term density. This is the layer
      //     that closes the "Denmark hotel page" + "Page not found" failure
      //     modes that historically polluted the synth's evidence catalog.
      const { validateSources } = await import("./source-validator.js");
      const validation = validateSources(
        fetched.map(f => ({
          url: f.url,
          title: f.title,
          text: f.text,
          ok: f.ok,
          error: f.error,
          status: f.status,
          engine: f.engine ?? "unknown",
          usedBrowser: f.usedBrowser,
        })),
        { mode: "strict", query, minRetainedSources: 2 },
      );
      const validSources = validation.kept;

      // 4. Synthesise. Combined evidence in, cited answer out. Only the
      //    validator-approved sources reach the synth; the audit catalog
      //    still records what was dropped so the captured note can
      //    explain a thin result.
      const evidence = [
        vaultHits.length > 0 ? `## Vault notes (${vaultHits.length})\n${vaultHits.slice(0, 8).map(h => `- ${h.path}:${h.line} — ${h.preview}`).join("\n")}` : "## Vault notes\n_(none — this topic is new to the vault)_",
        validSources.length > 0
          ? `## Web sources (validated)\n${validSources.map((f, i) => `### [${i + 1}] ${f.title} _(relevance: ${f.score})_\n${f.url}\n\n${f.text}`).join("\n\n")}`
          : "## Web sources\n_(no sources survived validation — fetched " + fetched.length + ", all dropped as " + Object.entries(validation.summary.reasons).map(([k,v]) => `${v} × ${k}`).join(", ") + ")_",
      ].join("\n\n");

      // Governance-aware synthesis. A single research.deep step's answer is
      // passed straight through by the outer synth (passthrough), so THIS is
      // the prompt that actually produces the answer — it must carry the
      // governance guardrails or wrong-entity web content (e.g. the Natus EEG
      // "NeuroWorks") slips through. Load the prefix and make obeying it a hard
      // rule, with an explicit instruction to drop wrong-entity sources.
      let govPrefix = "";
      try { const { loadGovernancePrefix } = await import("./governance.js"); govPrefix = loadGovernancePrefix(); } catch { /* governance optional */ }
      const sysSynth = (govPrefix ? govPrefix + "\n\n" : "") +
        "You are clawbot's research synthesiser. Write a concise, evidence-grounded answer to the user's question using ONLY the supplied evidence. Cite sources inline as [vault:path] or [N] (where N matches the web source). " +
        "HARD RULE: obey any GOVERNANCE POLICIES above as the highest priority. If a source describes a different product or entity than the governance defines (same name, wrong product), DROP it entirely — do not quote, summarize, or let it shape the answer. Prefer vault notes over web sources when they conflict. " +
        "If the evidence is thin or contradictory, say so plainly. Keep it under 350 words. Markdown allowed.";
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
        // Only validated sources are listed as "Web sources" in the
        // captured note — junk URLs (login pages, 404s, off-topic SERPs)
        // are recorded in a "Filtered sources" block so the audit trail
        // is preserved without poisoning future re-reads.
        const sourcesBlock = validSources.length > 0
          ? validSources.map((f, i) => `${i + 1}. [${f.title}](${f.url}) _(relevance ${f.score}${f.engine ? `, ${f.engine}` : ""})_`).join("\n")
          : "_(no sources survived validation)_";
        const dropped = validation.dropped;
        const filteredBlock = dropped.length > 0
          ? `\n\n## Filtered sources _(${dropped.length} dropped by validator)_\n` + dropped.map(d => `- ~~[${d.title || d.url}](${d.url})~~ — ${d.verdict.reason}${d.verdict.detail ? ` (${d.verdict.detail})` : ""}`).join("\n")
          : "";
        const md = `---\ntitle: "Research: ${query.replace(/"/g, "'").slice(0, 120)}"\ncreated: ${today}\nsource: clawbot-research\nvalidator: strict\nsources_kept: ${validSources.length}\nsources_dropped: ${dropped.length}\n---\n\n# Research: ${query}\n\n${synth.trim()}\n\n## Web sources\n${sourcesBlock}${filteredBlock}\n\n## Vault hits at time of research\n${vaultHits.slice(0, 8).map(h => `- [[${h.path}]] (line ${h.line})`).join("\n") || "_(none)_"}\n`;
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
        webSources: validSources.map(f => ({ url: f.url, title: f.title, ok: true, score: f.score, engine: f.engine })),
        webSourcesDropped: validation.dropped.map(d => ({ url: d.url, title: d.title, reason: d.verdict.reason, detail: d.verdict.detail })),
        validation: validation.summary,
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
    name: "email.send",
    description: "Send an actual email via the configured outbound transport (Mailjet HTTPS API, with SMTP fallback). Use this for ANY 'send an email to X', 'email X about Y', 'reply to Z' task — do NOT use web.interact to drive Gmail's web UI, that's not a real send path. RECIPIENTS: if the user names someone by NAME or ROLE rather than giving a literal address (e.g. 'email Godswill', 'send it to the project lead'), you MUST resolve their real address from the org directory FIRST via users.lookup (or users.list) — never invent or guess an address, and never use placeholder/example domains. MULTIPLE RECIPIENTS (e.g. 'send to all users'): `to` accepts a comma-separated list or a JSON array of addresses — do NOT use a wildcard reference like \"$step_N.users.*.email\", it will NOT resolve; instead reference the resolved array directly, e.g. {\"to\":\"$step_N.users.*.email\"} only works if step_N's args used users.list — if unsure, prefer building the array explicitly from users.list's result. ATTACHMENTS: when the user asks to 'send/attach the document/file/report', pass its absolute path(s) in attach_paths (from fs.find_in's matches[].path) — do NOT paste a document's raw content into the body as a substitute for attaching it. Returns { ok, transport, from, to, recipients, subject, sentAt, attachments? } so the synth can confirm actual delivery instead of fabricating one — ALWAYS check `ok` before claiming the email sent. Body accepts markdown — converted to plaintext + HTML automatically.",
    readonly: false,
    args: [
      { name: "to", type: "string", required: true, description: "Recipient's REAL email address, or MULTIPLE addresses as a comma-separated list / JSON array for a broadcast. If you only have a name/role, call users.lookup first to get it. Every address must be real — NOT a placeholder like name@example.com or '[project lead email]'." },
      { name: "subject", type: "string", required: true, description: "Email subject line (no Re: prefix unless replying)" },
      { name: "body", type: "string", required: true, description: "Email body in markdown — headings, bullets, links all rendered to HTML AND plaintext" },
      { name: "in_reply_to", type: "string", required: false, description: "Optional Message-ID of the message being replied to" },
      { name: "attach_paths", type: "string", required: false, description: "Absolute file path(s) to attach — typically $step_N.matches.0.path from fs.find_in. Accepts a single path, a comma-separated list, or a JSON array. Files are read from disk and attached as-is (PDF/XLSX/DOCX/images/etc, 10MB total cap). Use this instead of inlining a document's content in the body." },
    ],
    handler: async (args) => {
      const { sendEmail, coerceEmailBody } = await import("./email.js");
      const { assertSafeExternalPath } = await import("./security-gates.js");
      // `to` is a real string, an array (a resolved $step_N.path.*.field
      // wildcard resolves to one), a JSON-array string, or comma-separated.
      const to = parseFlexibleList(args.to);
      const subject = String(args.subject ?? "").trim();
      // Body may arrive as a prior step's result OBJECT, not a string — coerce
      // to readable markdown (pulls .answer/.text/etc.) instead of "[object Object]".
      const body = coerceEmailBody(args.body).trim();
      const inReplyTo = args.in_reply_to ? String(args.in_reply_to).trim() : undefined;
      const attachPaths = parseFlexibleList(args.attach_paths);
      // Same sensitive-path gate as fs.read_external/doc.ocr — an agent
      // attaching a file must clear the same bar as one reading it.
      for (const p of attachPaths) assertSafeExternalPath(p);
      return await sendEmail({ to, subject, body, inReplyTo, attachPaths: attachPaths.length ? attachPaths : undefined });
    },
  },
  {
    name: "doc.ocr",
    description: "Extract text from an IMAGE-ONLY document (scanned PDF, photo of a doc, .png/.jpg/.jpeg etc.) when fs.read_external returned empty or near-empty content. Two engines: 'auto' (default — local tesseract for images, cloud for PDFs), 'local' (offline tesseract.js, images only), 'cloud' (OpenRouter multimodal — accepts PDFs natively). Path MUST be an absolute path returned by fs.find_in. Returns { text, engine, model?, pages?, truncated }. Chain this AFTER fs.read_external when its content is short and the file is a PDF / image.",
    readonly: true,
    args: [
      { name: "path", type: "string", required: true, description: "Absolute path to the document (typically $step_N.resolvedTo from a prior fs.read_external, or $step_N.matches.0.path from fs.find_in)" },
      { name: "engine", type: "string", required: false, description: "'auto' (default) | 'local' | 'cloud'" },
    ],
    handler: async (args) => {
      const { ocrFile } = await import("./ocr.js");
      const raw = String(args.path ?? "").trim();
      if (!raw) throw new Error("doc.ocr: path required");
      const engine = (String(args.engine ?? "auto").toLowerCase() as "auto" | "local" | "cloud");
      if (!["auto", "local", "cloud"].includes(engine)) throw new Error(`doc.ocr: unknown engine "${engine}"`);
      const { assertSafeExternalPath } = await import("./security-gates.js");
      assertSafeExternalPath(raw);
      const result = await ocrFile(raw, engine);
      return { content: result.text, ...result, resolvedTo: raw };
    },
  },
  {
    // NOTE: NOT "db.schema" by source_id via db.list_sources' id field —
    // this is intentionally kept distinct from the primary db.list_sources
    // (line ~478) / db.query (line ~531) / db.describe_table family, which
    // are all label-based (source: string). This one accepts either a
    // source_id OR a label so existing callers using either shape work.
    name: "db.schema",
    description: "Get the schema (tables + columns) for a registered company database. Pass sourceId (id) OR source (label) from db.list_sources. Returns { tables: [{ name, columns: [{ name, type }] }] }.",
    readonly: true,
    args: [{ name: "sourceId", type: "string", required: true, description: "id or label from db.list_sources" }],
    handler: async (args) => {
      const key = String(args.sourceId ?? "");
      const src = getSource(key) ?? getSourceByLabel(key);
      if (!src) throw new Error(`db.schema: no data source matches id/label "${key}". Call db.list_sources first — if that returns an empty array, no company database is registered yet (ask the operator to connect one on the Data Sources page).`);
      return await describeSource(src);
    },
  },
  {
    name: "company.department_data",
    description: "Fetch operator-curated, department-specific company data (facts, policies, assumptions, territories, etc.) from the Company-data page. Pass a department name (e.g. 'Finance', 'HR', 'Sales') to get just that team's entries, or omit it to list every department that has data. Use this before a department task so you have the team's facts instead of guessing. Returns { departments:[{department,count}], data:[{department,title,content}] }.",
    readonly: true,
    args: [{ name: "department", type: "string", required: false, description: "Department name to filter by (case-insensitive). Omit to list all departments + their data." }],
    handler: async (args) => {
      const { listDepartmentData, listDepartments } = await import("./department-data.js");
      const department = args.department ? String(args.department) : undefined;
      const data = listDepartmentData(department).map(d => ({ department: d.department, title: d.title, content: d.content }));
      return { departments: listDepartments(), data };
    },
  },
  {
    name: "finance.snapshot",
    description: "RETIRED (2026-07-10) legacy push-model snapshot — the Finance System used to POST its dashboard to /api/public/dashboard and this read it back. That pushed data was stale and has been cleared; this now always returns available:false. For real financial figures, use connector.call on the live \"Aiia FinanceFlow\" connector instead (list-budgets, list-receipts, list-requisitions endpoints). Kept only in case the old push mechanism is ever revived.",
    readonly: true,
    args: [],
    handler: async () => {
      const { getFinanceSnapshot } = await import("./finance-snapshot.js");
      const snap = getFinanceSnapshot();
      if (!snap) {
        return { available: false, message: "No finance data has been pushed yet (this push-model mechanism is retired). Use connector.call on the live \"Aiia FinanceFlow\" connector instead — list-budgets, list-receipts, list-requisitions." };
      }
      const staleDays = Math.floor((Date.now() - new Date(snap.receivedAt).getTime()) / 86_400_000);
      return { available: true, mapped: snap.mapped, currency: snap.currency, period: snap.period, receivedAt: snap.receivedAt, staleDays };
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
      { name: "context", type: "string", required: false, description: "Optional framing for what the asker actually wanted (role, title/summary, deliverable intent). Lets the grader judge persona_fit and completeness against real intent instead of a terse task line." },
      { name: "grounded", type: "boolean", required: false, description: "Whether grounding/citations are EXPECTED for this answer. Pass false for a direct conversational answer produced from the model's own knowledge (no retrieval) — the grader then won't treat missing citations as factuality risk and judges mainly on persona_fit. Defaults to the deliverable-class heuristic (research = grounded)." },
    ],
    handler: async (args) => {
      const task = String(args.task);
      const answer = String(args.answer);
      const sources = args.sources ? String(args.sources) : "";
      const context = args.context ? String(args.context) : "";
      // Explicit ungrounded override: the caller knows this answer was produced
      // WITHOUT retrieval (e.g. a Hermes/direct conversational answer). Missing
      // citations are then expected, not a fault — so we don't let the research
      // rubric inflate factuality_risk for uncited-but-correct prose.
      const forceUngrounded = args.grounded === false;

      // Deterministic counts the grader uses to bound the LLM verdict.
      // Citations in this system come in three forms the synth is taught to
      // emit: inline numbered markers [1] [2], vault-path markers
      // [vault:notes/path.md], and bare URLs in references-only blocks.
      // Counting them upfront prevents the LLM scorer from giving a 0 when
      // the answer is well-cited but the scorer didn't recognise the format.
      const numberedMarkers = (answer.match(/\[\d+\]/g) ?? []).length;
      const vaultMarkers = (answer.match(/\[vault:[^\]]+\]/g) ?? []).length;
      const urlMatches = (answer.match(/https?:\/\/[^\s)<>"']+/g) ?? []).length;
      const totalCitations = numberedMarkers + vaultMarkers + urlMatches;
      // Substantive sentences: rough heuristic — split on sentence punctuation,
      // count those >= 40 chars. Avoids counting bullet leads ("- bullet")
      // and one-word fragments.
      const substantiveSentences = answer
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(s => s.length >= 40).length;
      const sourcesProvided = sources.trim().length > 0;
      // Citation floor: when sources WERE provided, we expect at least one
      // citation per ~3 substantive sentences. When NO sources were given,
      // citation_coverage doesn't apply (set floor to 1.0).
      const citationFloor = !sourcesProvided
        ? 1.0
        : substantiveSentences === 0
          ? 1.0
          : Math.min(1.0, totalCitations / Math.max(1, substantiveSentences / 3));

      // Deliverable-aware grading. The citation + strict-factuality rubric
      // fits research/analysis answers, but mis-scores other deliverables:
      // marketing copy is aspirational (no sources to cite), a runbook draws
      // on operational know-how (not citations), and code is judged on
      // correctness. Classify the deliverable from the task so the rubric and
      // weights match what was actually asked for. Shared with the planner
      // (deliverable.ts) so both agree on the deliverable type.
      // Classify against task + context: the context (title/summary/intent)
      // often carries the deliverable signal a terse task line omits.
      const deliverableClass = classifyDeliverable(context ? `${task}\n${context}` : task);
      // Citations apply only for a research deliverable that's ALSO expected to
      // be grounded. An explicit grounded:false override (conversational/direct
      // answer) drops the citation gate even for a research-classified task.
      const citationApplies = deliverableClass === "research" && !forceUngrounded;
      // For non-research / ungrounded deliverables, citation_coverage doesn't
      // apply — floor it to 1.0 so it can't drag the score, and let persona_fit
      // carry weight.
      const effectiveFloor = citationApplies ? citationFloor : 1.0;
      const classNote =
        forceUngrounded
          ? `\n\nDELIVERABLE TYPE: direct conversational answer. The model answered from its OWN knowledge with NO retrieved sources — it is EXPECTED to carry NO citations. Report citation_coverage as 1.0 (not applicable). Do NOT raise factuality_risk for uncited claims; raise it ONLY for internal contradictions or clearly false / implausible statements. Judge mainly on persona_fit: did it directly and correctly answer the question in the requested tone and format?`
        : deliverableClass === "creative"
          ? `\n\nDELIVERABLE TYPE: creative / marketing copy. This is aspirational product or marketing writing — it is EXPECTED to make forward-looking claims and carry NO citations. Do NOT raise factuality_risk for uncited or aspirational claims; raise it only for internal contradictions or clearly implausible statements. Report citation_coverage as 1.0 (not applicable). Judge mainly on persona_fit: tone, format adherence (e.g. requested bullet count), and persuasiveness.`
          : deliverableClass === "procedural"
          ? `\n\nDELIVERABLE TYPE: procedural / how-to / runbook. This draws on operational know-how, not external sources — it is EXPECTED to carry NO citations. Report citation_coverage as 1.0 (not applicable). Raise factuality_risk only for incorrect or unsafe steps. Judge mainly on persona_fit: completeness, correct ordering, and whether it honors the requested structure (e.g. number of steps).`
          : deliverableClass === "code"
          ? `\n\nDELIVERABLE TYPE: code / technical artifact. Citations are not applicable — report citation_coverage as 1.0. Raise factuality_risk only for incorrect or non-functional code. Judge mainly on persona_fit: correctness, completeness, and adherence to the requested form.`
          : `\n\nDELIVERABLE TYPE: research / analysis. Inline citations matter — score citation_coverage honestly against the evidence and raise factuality_risk for unsupported claims.`;

      const sys = `You are a quality scorer for an agent's draft answer. Score the draft on three axes from 0.0 (worst) to 1.0 (best):
1. factuality_risk — likelihood the answer contains hallucinated or unsupported claims (1.0 means high risk; lower is better).
2. citation_coverage — fraction of substantive claims backed by an inline citation. In this system, citations look like [1] [2] (numbered, matching the evidence catalog), [vault:path/to/note.md] (vault-path markers), or bare URLs. Count an answer as well-cited when it carries these markers. If NO sources are provided, citation_coverage MUST be 1.0 — there's nothing to cite against.
3. persona_fit — match between the answer's tone/structure and what the task asked for.

Output ONLY a JSON object, no prose, no fences:
{"factuality_risk":<0..1>,"citation_coverage":<0..1>,"persona_fit":<0..1>,"issues":["<short>",...],"pass":<true|false>}

Pass is true when factuality_risk < 0.4 AND citation_coverage > 0.4 AND persona_fit > 0.5.

When you're uncertain about citation_coverage, lean higher when you see [N] or [vault:...] markers in the answer.`;
      // When the caller supplies context (the asker's role, the request
      // title/summary, deliverable intent), tell the scorer to judge against
      // that stated intent rather than a literal reading of a terse task line —
      // this is what lifts persona_fit/completeness scores on requests whose
      // one-line task underspecifies what a good answer looks like.
      const contextNote = context
        ? `\n\nTASK CONTEXT: the asker's intent is described in the "Task context" block of the prompt. Judge persona_fit and completeness against that intent (the role, the request's title/summary, and what a good deliverable for it looks like) — not against a narrow literal reading of the one-line task. Do not penalise an answer for omitting things the context did not actually ask for.`
        : "";
      // The output is a small JSON blob (~80-200 tokens). 256 tokens is a
      // generous cap that stops the model from rambling and shaves 3-8s off
      // this call on local Ollama versus the default 1024-token budget.
      const scorePrompt = `Task: ${task}${context ? `\n\nTask context (what the asker actually wanted):\n${context.slice(0, 1500)}` : ""}\n\nDraft answer:\n${answer}${sources ? `\n\nSources:\n${sources.slice(0, 4000)}` : ""}`;
      // Resilient scoring: try the extraction profile (may route to OpenRouter)
      // first, but on a transient cloud failure (429 / rate limit / transport)
      // fall back to LOCAL Ollama so the QA gate never hard-fails. Without this
      // a bulk grading pass 500s on every OR rate-limit hit. profile=undefined
      // forces local generation (shouldRouteToOpenRouter is false with no profile).
      // temperature:0 pins the scorer's output so run-to-run grader noise
      // (run1 0.822 / run2 0.817 / run3 0.824 swings — all within sampling
      // noise) stops masquerading as quality regressions. 300s wall-time cap
      // kills the recurring pathological tail (5464s quality.check outlier in
      // the 2026-05-29 reflection, ~91 min on one job) — on timeout we
      // return a non-passing verdict rather than letting the QA gate hang.
      let raw: string = "";
      let timer: ReturnType<typeof setTimeout> | undefined;
      // Wall cap tightened 300s → 120s (NEUROWORKS_QUALITY_TIMEOUT_MS): with the
      // extraction profile on the cheap cloud tier the grader answers in
      // seconds, so anything past 2 min is a stall, not a slow grade. The
      // 2026-07-03 reflection flagged 76s→171s doublings under the old cap.
      const QUALITY_CAP_MS = Math.max(15_000, Number(process.env.NEUROWORKS_QUALITY_TIMEOUT_MS ?? "120000"));
      try {
        raw = await Promise.race<string>([
          (async () => {
            try {
              return await ollamaGenerate(scorePrompt, sys + classNote + contextNote, { profile: "extraction", maxTokens: 256, temperature: 0 });
            } catch (e: any) {
              const msg = String(e?.message ?? e);
              if (!/429|rate[\s-]?limit|fetch\s+failed|terminated|ECONNRESET|HTTP\s+5\d\d|timeout|other\s+side\s+closed/i.test(msg)) throw e;
              return await ollamaGenerate(scorePrompt, sys + classNote + contextNote, { profile: undefined, maxTokens: 256, temperature: 0 });
            }
          })(),
          new Promise<string>((_, rej) => { timer = setTimeout(() => rej(new Error(`quality.check wall-time cap (${Math.round(QUALITY_CAP_MS / 1000)}s) exceeded`)), QUALITY_CAP_MS); }),
        ]);
      } catch (e: any) {
        // Routine (non-research) deliverables fail OPEN on a grader stall: the
        // check is advisory there, and a fail-closed verdict cascades into
        // skill-draft + rescue re-synths that cost far more than the risk of
        // an ungraded runbook. Research stays fail-closed — uncited claims
        // slipping through is the exact failure the gate exists to catch.
        if (deliverableClass !== "research") {
          return { pass: true, factuality_risk: 0.3, citation_coverage: 1, persona_fit: 0.7, score: 0.7, issues: [`grader unavailable (${String(e?.message ?? e).slice(0, 100)}) — advisory pass for ${deliverableClass} deliverable`], deliverableClass, graderSkipped: true };
        }
        return { pass: false, factuality_risk: 1, citation_coverage: 0, persona_fit: 0, score: 0, issues: [`scorer failed: ${String(e?.message ?? e).slice(0, 160)}`], deliverableClass };
      } finally {
        if (timer) clearTimeout(timer);
      }
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) return { pass: false, factuality_risk: 1, citation_coverage: 0, persona_fit: 0, issues: ["scorer returned no JSON"], raw };
      try {
        const parsed = JSON.parse(m[0]);
        // Use the higher of the LLM's verdict and the deterministic floor for
        // citation_coverage. Stops the scorer from punishing answers that
        // are clearly well-cited but whose format it didn't recognise.
        const llmCitation = clamp01(parsed.citation_coverage);
        const citationCoverage = Math.max(llmCitation, effectiveFloor);
        const factualityRisk = clamp01(parsed.factuality_risk);
        const personaFit = clamp01(parsed.persona_fit);
        // Per-class scoring. Research weights factuality + citations heavily.
        // Non-research deliverables (creative / procedural / code) are carried
        // by persona_fit — citations don't apply and factuality is relaxed
        // (aspirational marketing copy and how-to steps shouldn't be punished
        // as "hallucinations"), so the rubric matches what was asked for.
        const score = citationApplies
          ? (1 - factualityRisk) * 0.4 + citationCoverage * 0.3 + personaFit * 0.3
          : forceUngrounded
            ? (1 - factualityRisk) * 0.2 + personaFit * 0.8
            : (1 - factualityRisk) * 0.3 + citationCoverage * 0.2 + personaFit * 0.5;
        // Re-derive pass per class:
        //  • research   — factuality + citations + persona_fit all gate.
        //  • ungrounded (direct conversational, grounded:false) — persona_fit is
        //    THE bar (did it answer correctly in the right shape). A small local
        //    grader's factuality_risk on uncited prose is noisy: empirically it
        //    parks CORRECT answers at ~0.7 (measured: a right burndown-chart
        //    explanation and a stub both scored 0.7), while persona_fit cleanly
        //    separates good (0.8+) from bad (<0.5) — including egregiously false
        //    answers (persona_fit 0). So factuality is only a high safety catch
        //    for egregious hallucination (>= 0.85), NOT the primary gate.
        //  • creative/procedural/code — persona_fit-led, factuality relaxed.
        const pass = citationApplies
          ? (factualityRisk < 0.4 && citationCoverage > 0.4 && personaFit > 0.5)
          : forceUngrounded
            ? (personaFit > 0.5 && factualityRisk < 0.85)
            : (factualityRisk < 0.5 && personaFit > 0.5);
        const issues = Array.isArray(parsed.issues) ? parsed.issues.slice(0, 6).map((s: any) => String(s).slice(0, 200)) : [];
        // If the floor lifted the verdict over the LLM's call, note that
        // openly so the operator can see when the deterministic guard fired.
        if (citationCoverage > llmCitation + 0.05) {
          issues.push(citationApplies
            ? `citation_coverage adjusted from ${llmCitation.toFixed(2)} to ${citationCoverage.toFixed(2)} (found ${totalCitations} citation markers in ${substantiveSentences} substantive sentences)`
            : `citation_coverage not applicable for ${deliverableClass} deliverable — set to 1.0`);
        }
        return {
          pass,
          factuality_risk: factualityRisk,
          citation_coverage: citationCoverage,
          persona_fit: personaFit,
          score: Math.round(score * 100) / 100,
          issues,
          deliverableClass,
          // Diagnostic counters so the UI / journal can show why a score moved.
          citationCounts: { numbered: numberedMarkers, vault: vaultMarkers, url: urlMatches, total: totalCitations, substantiveSentences, sourcesProvided },
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
    name: "governance.check",
    description: "Check a draft answer against the organization's accepted HARD governance constraints (extracted from uploaded policy docs under Governance). Returns { pass, violations }. Auto-injected after synthesis alongside quality.check/security.scan when any hard constraint has been reviewed and accepted — a no-op elsewhere.",
    readonly: true,
    args: [
      { name: "content", type: "string", required: true, description: "The draft answer text to check" },
    ],
    handler: async (args) => {
      const content = String(args.content);
      const gate = checkContentAgainstGovernance(content);
      return { pass: !gate.blocked, violations: gate.violations };
    },
  },
  {
    name: "brave.list_tabs",
    description: "List the URLs and titles of every open tab in the user's Brave browser (read-only). Requires the user to launch Brave with --remote-debugging-port=9222 AND set NEUROWORKS_BRAVE_READ=1 in .env. Returns { url, title, contextIndex, pageIndex } per tab — use the indices with brave.read_tab to fetch a specific tab's content. Refuses with a clear setup message when Brave isn't reachable.",
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
    description: "Fetch a skill .md file from a public URL (e.g. a GitHub raw URL or gist) and save it under skills/_user/ so it joins the local catalog. REQUIRES the user to have opted in via NEUROWORKS_REMOTE_SKILLS=1 in .env — refuses otherwise. Use to pull in community-curated playbooks.",
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
  // ── Integration primitives (integration.*) ──
  {
    name: "integration.slack.post",
    description: "Post a message to a connected Slack channel. Uses the first configured Slack webhook connection. Message is markdown text. Returns { ok, ts } on success.",
    readonly: false,
    args: [
      { name: "text", type: "string", required: true, description: "Message text (markdown supported by Slack webhooks)" },
    ],
    handler: async (args) => {
      const conn = getConnectionByProvider("slack");
      if (!conn) throw new Error("No Slack connection configured — add one on the Integrations page");
      const webhookUrl = conn.secrets.webhookUrl ?? conn.config.webhookUrl;
      if (!webhookUrl) throw new Error("Slack webhook URL not found in connection");
      const r = await fetch(webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: String(args.text) }) });
      if (!r.ok) throw new Error(`Slack webhook returned HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return { ok: true, ts: (await r.json().catch(() => ({}))).ts ?? "sent" };
    },
  },
  {
    name: "integration.gmail.send",
    description: "Send an email via the connected Google (Gmail) integration. Requires a configured Google connection with a Gmail API scope. Returns { id, threadId } on success.",
    readonly: false,
    args: [
      { name: "to", type: "string", required: true, description: "Recipient email address" },
      { name: "subject", type: "string", required: true, description: "Email subject line" },
      { name: "body", type: "string", required: true, description: "Email body (plain text or HTML)" },
      { name: "cc", type: "string", required: false, description: "CC recipient(s), comma-separated" },
      { name: "contentType", type: "string", required: false, description: "'text/plain' (default) or 'text/html'" },
    ],
    handler: async (args) => {
      const conn = getConnectionByProvider("google");
      if (!conn) throw new Error("No Google connection configured — add one on the Integrations page");
      const token = conn.secrets.accessToken;
      if (!token) throw new Error("Google access token not found");
      const to = String(args.to);
      const subject = String(args.subject);
      const body = String(args.body);
      const cc = args.cc ? String(args.cc) : "";
      const contentType = String(args.contentType ?? "text/plain");

      // Build RFC 2822 email raw string, then base64url encode it.
      const headers = [`To: ${to}`, `Subject: ${subject}`, `MIME-Version: 1.0`, `Content-Type: ${contentType}; charset=UTF-8`];
      if (cc) headers.push(`Cc: ${cc}`);
      const raw = btoa(unescape(encodeURIComponent(headers.join("\r\n") + "\r\n\r\n" + body)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ raw }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(`Gmail API error: ${err?.error?.message ?? `HTTP ${r.status}`}`);
      }
      const j: any = await r.json();
      return { id: j.id, threadId: j.threadId };
    },
  },
  {
    name: "integration.gmail.read",
    description: "Read emails from Gmail inbox. Returns messages matching a search query. Requires a configured Google connection with Gmail API scope.",
    readonly: true,
    args: [
      { name: "query", type: "string", required: false, description: "Gmail search query (same syntax as Gmail search bar). Default: recent 10 messages from the last 7 days." },
      { name: "maxResults", type: "number", required: false, description: "Max messages to return (default 10, max 50)" },
    ],
    handler: async (args) => {
      const conn = getConnectionByProvider("google");
      if (!conn) throw new Error("No Google connection configured — add one on the Integrations page");
      const token = conn.secrets.accessToken;
      if (!token) throw new Error("Google access token not found");
      const query = String(args.query ?? "newer_than:7d");
      const maxResults = Math.min(50, Math.max(1, Number(args.maxResults ?? 10)));

      // List matching message IDs.
      const listR = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!listR.ok) {
        const err = await listR.json().catch(() => ({}));
        throw new Error(`Gmail API error: ${err?.error?.message ?? `HTTP ${listR.status}`}`);
      }
      const listJ: any = await listR.json();
      const ids: string[] = (listJ.messages ?? []).map((m: any) => m.id);

      // Fetch full message details for each ID (max 10 by default to avoid rate limits).
      const messages: any[] = [];
      for (const id of ids.slice(0, maxResults)) {
        const msgR = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!msgR.ok) continue;
        const msg: any = await msgR.json();
        const headers = (msg.payload?.headers ?? []).reduce((acc: any, h: any) => { acc[h.name] = h.value; return acc; }, {});
        messages.push({
          id: msg.id,
          threadId: msg.threadId,
          from: headers.From ?? "",
          to: headers.To ?? "",
          subject: headers.Subject ?? "",
          date: headers.Date ?? "",
          snippet: msg.snippet ?? "",
        });
      }
      return { query, total: listJ.resultSizeEstimate ?? messages.length, messages };
    },
  },
  {
    name: "vault.write_pdf",
    description: "Render a markdown answer into a polished PDF (system typography, generous margins, GFM tables) and save it to the vault. Use when the deliverable is a board pack, customer-facing memo, or anything an operator will email out. Returns { path, bytes }.",
    readonly: false,
    args: [
      { name: "markdown", type: "string", required: true, description: "Markdown content to render" },
      { name: "title", type: "string", required: false, description: "Document title (used in <title>, no visible heading — your markdown's first H1 owns the on-page heading)" },
      { name: "filename", type: "string", required: true, description: "Filename WITHOUT directory, e.g. 'board-pack-q3.pdf'. Saved under `_neuroworks/exports/` in the vault. `.pdf` appended if missing." },
      { name: "landscape", type: "boolean", required: false, description: "Landscape orientation (default false — portrait Letter)" },
    ],
    handler: async (args) => {
      let filename = String(args.filename ?? "document.pdf").replace(/[/\\]/g, "-").replace(/^\.+/, "");
      if (!/\.pdf$/i.test(filename)) filename += ".pdf";
      const stamp = new Date().toISOString().slice(0, 10);
      const rel = `_neuroworks/exports/${stamp}-${filename}`;
      return await renderMarkdownToPdf({
        markdown: String(args.markdown ?? ""),
        title: args.title ? String(args.title) : undefined,
        vaultRelPath: rel,
        landscape: args.landscape === true,
      });
    },
  },
  {
    name: "calendar.activity",
    description: "Return the agents' own activity (jobs that ran) grouped by day across [from, to]. Use when the user asks 'what did I do last Tuesday' / 'what shipped this week' / 'summarise the team's output for the month'. Merges the in-memory job table with the persisted `_neuroworks/jobs/` JSONL files. Default window: the last 14 days.",
    readonly: true,
    args: [
      { name: "from", type: "string", required: false, description: "Window start YYYY-MM-DD (default: 13 days ago)" },
      { name: "to", type: "string", required: false, description: "Window end YYYY-MM-DD inclusive (default: today)" },
    ],
    handler: async (args) => {
      const { loadJobsInWindow } = await import("./job-store.js");
      const { listJobs } = await import("./jobs.js");
      // Bucket by LOCAL calendar day (server timezone == operator's) so "today"
      // / "yesterday" line up with the wall clock, not UTC.
      const localYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const today = new Date();
      const defTo = localYmd(today);
      const def = localYmd(new Date(today.getTime() - 13 * 24 * 60 * 60 * 1000));
      const from = String(args.from ?? def);
      const to = String(args.to ?? defTo);
      const fromMs = Date.parse(from + "T00:00:00.000");
      const toMs = Date.parse(to + "T23:59:59.999");
      const merged = new Map<string, any>();
      for (const j of loadJobsInWindow(fromMs, toMs)) merged.set(j.id, j);
      for (const j of listJobs()) {
        const at = Date.parse(j.finishedAt ?? j.startedAt);
        if (at >= fromMs && at <= toMs) merged.set(j.id, j);
      }
      const days = new Map<string, any[]>();
      for (const j of merged.values()) {
        const k = localYmd(new Date(j.finishedAt ?? j.startedAt));
        if (!days.has(k)) days.set(k, []);
        days.get(k)!.push({
          id: j.id, kind: j.kind, template: j.template, title: j.title,
          personaName: j.personaName, status: j.status,
          startedAt: j.startedAt, finishedAt: j.finishedAt,
          score: (j.result as any)?.quality?.score ?? null,
        });
      }
      return { from, to, days: [...days.entries()].map(([date, jobs]) => ({ date, jobs })).sort((a, b) => a.date.localeCompare(b.date)) };
    },
  },
  {
    name: "calendar.plan_day",
    description: "Synthesise a day plan for a date: today's meetings (from NEUROWORKS_CALENDAR_ICAL_URL if configured), scheduled clawbot tasks for that day-of-week, dated commitments recalled from long-term memory (memory.note facts anchored to this date), and any open follow-ups carried over from yesterday's activity. Returns the structured pieces; the planner is expected to feed them through the `daily-briefing` skill to produce the prose briefing.",
    readonly: true,
    args: [
      { name: "date", type: "string", required: false, description: "Target date YYYY-MM-DD (default: today)" },
    ],
    handler: async (args) => {
      const localYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const date = String(args.date ?? localYmd(new Date()));
      const fromMs = Date.parse(date + "T00:00:00.000");
      const toMs = Date.parse(date + "T23:59:59.999");
      const { loadJobsInWindow } = await import("./job-store.js");
      const { listJobs } = await import("./jobs.js");
      const merged = new Map<string, any>();
      for (const j of loadJobsInWindow(fromMs, toMs)) merged.set(j.id, j);
      for (const j of listJobs()) {
        const at = Date.parse(j.finishedAt ?? j.startedAt);
        if (at >= fromMs && at <= toMs) merged.set(j.id, j);
      }
      const activity = [...merged.values()].map(j => ({ id: j.id, title: j.title ?? j.kind, status: j.status, finishedAt: j.finishedAt, personaName: j.personaName }));

      // Yesterday's carryover — jobs that failed / awaited approval and may
      // still need attention. Same JOB_STORE window, one day back.
      const yFromMs = fromMs - 24 * 60 * 60 * 1000;
      const carryover: any[] = [];
      for (const j of loadJobsInWindow(yFromMs, fromMs)) {
        if (j.status === "failed" || j.status === "awaiting-approval" || j.status === "rejected") {
          carryover.push({ id: j.id, title: j.title ?? j.kind, status: j.status, finishedAt: j.finishedAt });
        }
      }

      let meetings: any[] = [];
      let meetingsError: string | undefined;
      const src = process.env.NEUROWORKS_CALENDAR_ICAL_URL;
      if (src) {
        try {
          const { readICalSource } = await import("./calendar-ical.js");
          const all = await readICalSource(src);
          meetings = all.filter(e => e.start.slice(0, 10) === date).sort((a, b) => a.start.localeCompare(b.start));
        } catch (e: any) { meetingsError = String(e?.message ?? e).slice(0, 200); }
      }

      let schedules: any[] = [];
      try {
        const { listSchedules } = await import("./schedules.js");
        const targetDow = new Date(date + "T12:00:00").getDay();
        schedules = (listSchedules() as any[]).filter(s => {
          const d = s.cadence?.daysOfWeek ?? [];
          return s.enabled && (d.length === 0 || d.includes(targetDow));
        }).map(s => ({ id: s.id, templateId: s.templateId, label: s.label, cadence: s.cadence }));
      } catch { /* schedules optional */ }

      // Memory → calendar link: dated facts the agent was told to remember
      // ("the Q3 board meeting is on 2026-07-15") surface as commitments on
      // their day, instead of dying in a JSONL file the planner never reads.
      let commitments: any[] = [];
      try {
        const { datedFactsInWindow } = await import("./memory.js");
        commitments = datedFactsInWindow(date, date).map(f => ({ subject: f.subject, fact: f.fact, source: f.source }));
      } catch { /* memory optional */ }

      return { date, meetings, meetingsError, schedules, activity, carryover, commitments };
    },
  },
  {
    name: "data.list_datasets",
    description: "List datasets published by the Intellinexus data pipeline. Returns [{ id, name, sector, source, recordCount, avgConfidence, rootHash, createdAt }]. These are the curated, hashed, golden-record datasets agents learn from — their RAG chunks are in the vault and surface via vault.search. Use this to discover what published data exists before answering a domain question.",
    readonly: true,
    args: [],
    handler: async () => {
      return {
        datasets: listDatasets().map(d => ({
          id: d.id, name: d.name, sector: d.sector, source: d.source,
          recordCount: d.recordCount, avgConfidence: d.avgConfidence,
          reviewQueue: d.reviewQueue, rootHash: d.rootHash, createdAt: d.createdAt,
          fields: d.fields, outputs: d.outputs,
        })),
      };
    },
  },
  {
    name: "omnisignal.acquire",
    description: "BASE RESEARCH TOOL. Acquire raw signal from many sources at once via Omnisignal (the Intellinexus pipeline's acquisition front-end) and get a merged, provenance-tagged record stream. Each source is a spec object: {kind:'web_search',query} | {kind:'web_page',urls:[...]} | {kind:'db',sourceLabel,query} | {kind:'local_file',path} | {kind:'vault',query}. Read-only — use to gather multi-source research before answering, or before publishing a dataset with omnisignal.publish.",
    readonly: true,
    args: [
      { name: "sources", type: "string", required: true, description: "JSON array of source specs, e.g. '[{\"kind\":\"web_search\",\"query\":\"Zimbabwe mobile tariffs\"},{\"kind\":\"vault\",\"query\":\"pricing\"}]'." },
    ],
    handler: async (args) => {
      let specs: OmniSpec[];
      try {
        const parsed = JSON.parse(String(args.sources ?? "[]"));
        if (!Array.isArray(parsed)) return { error: "sources must be a JSON array of specs" };
        specs = parsed;
      } catch { return { error: "sources is not valid JSON" }; }
      if (specs.length === 0) return { error: "provide at least one source spec" };
      const result = await omniAcquire(specs);
      return { total: result.total, report: result.report, records: result.records.slice(0, 200) };
    },
  },
  {
    name: "omnisignal.publish",
    description: "BASE RESEARCH SYSTEM. Acquire from multiple sources via Omnisignal, then run the full Intellinexus pipeline and PUBLISH a dataset agents learn from (normalize → hash → score → HITL → golden record → CSV/JSONL/RAG). One call turns live multi-source research into a readied, hashed, deduplicated knowledge pack. Sources use the same spec shape as omnisignal.acquire.",
    readonly: false,
    args: [
      { name: "name", type: "string", required: true, description: "Dataset name (becomes the knowledge-pack title)." },
      { name: "sources", type: "string", required: true, description: "JSON array of source specs (see omnisignal.acquire)." },
      { name: "sector", type: "string", required: false, description: "Optional sector tag." },
      { name: "keyField", type: "string", required: false, description: "Field to merge duplicates on (entity resolution). Omit for hash-only dedup." },
    ],
    handler: async (args) => {
      const name = String(args.name ?? "").trim();
      if (!name) return { error: "name is required" };
      let specs: OmniSpec[];
      try {
        const parsed = JSON.parse(String(args.sources ?? "[]"));
        if (!Array.isArray(parsed)) return { error: "sources must be a JSON array of specs" };
        specs = parsed;
      } catch { return { error: "sources is not valid JSON" }; }
      if (specs.length === 0) return { error: "provide at least one source spec" };
      const out = await omniAcquirePublish(name, specs, {
        sector: args.sector ? String(args.sector) : undefined,
        keyField: args.keyField ? String(args.keyField) : undefined,
      });
      if (!out.published) return { published: false, note: out.note, report: out.acquisition.report };
      const m = out.published.manifest;
      return {
        published: true, id: m.id, name: m.name, recordCount: m.recordCount, rawCount: m.rawCount,
        avgConfidence: m.avgConfidence, reviewQueue: m.reviewQueue, rootHash: m.rootHash,
        report: out.acquisition.report, outputs: m.outputs,
      };
    },
  },
  {
    name: "data.publish",
    description: "Run the Intellinexus data pipeline (normalize → cryptographic hash → confidence score → HITL gate → entity-resolution golden record → publish) and PUBLISH a dataset into the vault as ML CSV + knowledge-graph JSONL + RAG chunks + a knowledge-pack card. The dataset becomes a knowledge pack agents learn from. Provide rows either inline (rows = JSON array string) OR from a connected company data source (source = its label, query = SQL/JSON for that source).",
    readonly: false,
    args: [
      { name: "name", type: "string", required: true, description: "Human name for the dataset (becomes the pack title)." },
      { name: "rows", type: "string", required: false, description: "Inline records as a JSON array string, e.g. '[{\"name\":\"A\",\"value\":1}]'. Omit if using source+query." },
      { name: "source", type: "string", required: false, description: "Label of a connected company data source to pull rows from (see db.list)." },
      { name: "query", type: "string", required: false, description: "SQL (or the source's query syntax) to run against `source`. Read-only." },
      { name: "sector", type: "string", required: false, description: "Optional sector tag (fintech, agriculture, health, etc.)." },
      { name: "keyField", type: "string", required: false, description: "Field name used to merge duplicate rows into one golden record (entity resolution). Omit for hash-only dedup." },
    ],
    handler: async (args) => {
      const name = String(args.name ?? "").trim();
      if (!name) return { error: "name is required" };
      let rows: Record<string, unknown>[] = [];
      if (args.source && args.query) {
        const src = getSourceByLabel(String(args.source));
        if (!src) return { error: `no connected data source labelled "${args.source}" (see db.list)` };
        const r = await runQuery(src, String(args.query), 5000);
        rows = r.rows;
      } else if (args.rows) {
        try {
          const parsed = JSON.parse(String(args.rows));
          if (!Array.isArray(parsed)) return { error: "rows must be a JSON array" };
          rows = parsed;
        } catch { return { error: "rows is not valid JSON" }; }
      } else {
        return { error: "provide either rows (inline JSON array) or source+query" };
      }
      if (rows.length === 0) return { error: "no rows to publish" };
      const { manifest } = publishDataset({
        name,
        records: rows,
        sector: args.sector ? String(args.sector) : undefined,
        source: args.source ? `data-source:${args.source}` : "agent-inline",
        keyField: args.keyField ? String(args.keyField) : undefined,
      });
      return {
        published: true, id: manifest.id, name: manifest.name,
        recordCount: manifest.recordCount, rawCount: manifest.rawCount,
        avgConfidence: manifest.avgConfidence, reviewQueue: manifest.reviewQueue,
        rootHash: manifest.rootHash, outputs: manifest.outputs,
      };
    },
  },
  {
    name: "calendar.read_today",
    description: "Read today's events from an iCal feed (URL) or local .ics file. Returns [{ summary, start, end?, location?, description? }]. Source defaults to NEUROWORKS_CALENDAR_ICAL_URL in env — pass `source` to override per call. Use as the first step of a daily-briefing skill or whenever the persona needs to know what's on the calendar.",
    readonly: true,
    args: [
      { name: "source", type: "string", required: false, description: "iCal URL or .ics file path. Defaults to NEUROWORKS_CALENDAR_ICAL_URL." },
    ],
    handler: async (args) => {
      const src = String(args.source ?? process.env.NEUROWORKS_CALENDAR_ICAL_URL ?? "").trim();
      if (!src) return { error: "no source — pass `source` or set NEUROWORKS_CALENDAR_ICAL_URL in clawbot/.env (public Google Calendar 'secret iCal' URL or an Outlook publish link)" };
      try {
        const { readICalSource, todaysEvents } = await import("./calendar-ical.js");
        const all = await readICalSource(src);
        return { events: todaysEvents(all), totalParsed: all.length };
      } catch (e: any) {
        return { error: String(e?.message ?? e).slice(0, 300) };
      }
    },
  },
  {
    name: "inbox.read_unread",
    description: "Read recent unseen messages from the clawbot mailbox. Returns [{ from, subject, date, preview }]. Uses the existing NEUROWORKS_EMAIL_USER / NEUROWORKS_EMAIL_APP_PASSWORD credentials. Does NOT mark messages as seen — read-only. Use to surface what needs the operator's attention this morning.",
    readonly: true,
    args: [
      { name: "limit", type: "number", required: false, description: "Max messages to return (default 10, max 50)" },
    ],
    handler: async (args) => {
      const user = process.env.NEUROWORKS_EMAIL_USER;
      const pass = (process.env.NEUROWORKS_EMAIL_APP_PASSWORD ?? "").replace(/\s/g, "");
      if (!user || !pass) return { error: "email not configured — set NEUROWORKS_EMAIL_USER + NEUROWORKS_EMAIL_APP_PASSWORD in clawbot/.env" };
      const limit = Math.min(50, Math.max(1, Number(args.limit ?? 10)));
      const { ImapFlow } = await import("imapflow");
      const client = new ImapFlow({
        host: process.env.NEUROWORKS_EMAIL_IMAP_HOST ?? "imap.gmail.com",
        port: Number(process.env.NEUROWORKS_EMAIL_IMAP_PORT ?? 993),
        secure: true,
        auth: { user, pass },
        logger: false as any,
      });
      try {
        await client.connect();
        await client.mailboxOpen("INBOX");
        const uids = await client.search({ seen: false }) as number[];
        const recent = uids.slice(-limit).reverse();
        const out: { from?: string; subject?: string; date?: string; preview?: string }[] = [];
        for await (const msg of client.fetch(recent, { envelope: true, source: true, uid: true }, { uid: true })) {
          const env = msg.envelope;
          let preview = "";
          try {
            if (msg.source) {
              const { simpleParser } = await import("mailparser");
              const p = await simpleParser(msg.source);
              preview = (p.text ?? "").trim().replace(/\s+/g, " ").slice(0, 240);
            }
          } catch { /* tolerate */ }
          out.push({
            from: env?.from?.[0]?.address ?? undefined,
            subject: env?.subject ?? undefined,
            date: env?.date?.toISOString?.() ?? undefined,
            preview,
          });
        }
        return { messages: out, fetched: out.length };
      } catch (e: any) {
        return { error: String(e?.message ?? e).slice(0, 300) };
      } finally {
        try { await client.logout(); } catch { /* tolerate */ }
      }
    },
  },
  {
    name: "hermes.delegate",
    description: "Delegate a task to the Hermes Agent CLI (Nous Research) and return its answer. Use when the task needs one of Hermes's bundled skills (Linear / Notion / Slack / Google Workspace / Polymarket / arxiv / OCR / many others) that clawbot doesn't have a native primitive for. Spawns `hermes -z 'task' --yolo` as a subprocess, capped at 240 s. Requires Hermes installed locally and OPENROUTER_API_KEY in the clawbot environment (passed through to Hermes).",
    readonly: false,
    args: [
      { name: "task", type: "string", required: true, description: "The full task to send to Hermes — phrase it as you would to any agent." },
      { name: "timeoutMs", type: "number", required: false, description: "Wall budget for the Hermes call (default 240000, max 600000)" },
    ],
    handler: async (args) => {
      const { existsSync } = await import("node:fs");
      const path = await import("node:path");
      const { spawn } = await import("node:child_process");
      const home = process.env.HERMES_HOME ?? (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "hermes") : null) ?? (process.env.HOME ? path.join(process.env.HOME, ".hermes") : null);
      let bin: string | null = null;
      if (home) {
        for (const rel of ["hermes-agent/venv/Scripts/hermes.exe", "hermes-agent/venv/bin/hermes"]) {
          const p = path.join(home, rel);
          if (existsSync(p)) { bin = p; break; }
        }
      }
      if (!bin) return { error: "Hermes Agent not installed (looked under $HERMES_HOME / $LOCALAPPDATA/hermes). Install via the Nous Research installer." };
      // Scrub the parent Node/Python env so Hermes' venv bootstraps cleanly —
      // same fix the stress harness needed (without this, hermes died on
      // "init_import_site" in <1s).
      const env: Record<string, string> = { ...process.env } as any;
      for (const k of ["PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV", "PYTHONSTARTUP", "PYTHONNOUSERSITE", "PYTHONEXECUTABLE", "__PYVENV_LAUNCHER__"]) {
        delete env[k];
      }
      const timeoutMs = Math.min(600_000, Math.max(5_000, Number(args.timeoutMs ?? 240_000)));
      const task = String(args.task ?? "").trim();
      if (!task) return { error: "task is required" };
      return await new Promise<any>((resolve) => {
        const t0 = Date.now();
        const proc = spawn(bin!, ["-z", task, "--yolo"], { env, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = ""; let stderr = "";
        proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); if (stdout.length > 200_000) stdout = stdout.slice(0, 200_000); });
        proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); if (stderr.length > 20_000) stderr = stderr.slice(0, 20_000); });
        const timer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, timeoutMs);
        proc.on("close", (code) => {
          clearTimeout(timer);
          const elapsedMs = Date.now() - t0;
          resolve({
            answer: stdout.trim(),
            stderr: stderr.trim().slice(0, 2000) || undefined,
            exitCode: code,
            agent: "hermes",
            elapsedMs,
          });
        });
        proc.on("error", (e) => {
          clearTimeout(timer);
          resolve({ error: `hermes spawn failed: ${e.message}` });
        });
      });
    },
  },
  {
    name: "code.exec",
    description: "Run a short Python or Node.js snippet in a subprocess with a 30 s timeout. Output is captured (stdout + stderr) and returned to the planner. For data shaping, parsing, quick computation — anything you'd otherwise have to make the LLM imagine. GATED: requires NEUROWORKS_CODE_EXEC=1 in clawbot/.env (off by default — the host has no sandbox; treat code as trusted-author).",
    readonly: false,
    args: [
      { name: "language", type: "string", required: true, description: "'python' or 'node'" },
      { name: "code", type: "string", required: true, description: "Source. For Python, prefer stdlib (no pip on the fly). For Node, prefer pure JS (no npm)." },
      { name: "timeoutMs", type: "number", required: false, description: "Wall budget (default 30000, max 120000)" },
    ],
    handler: async (args) => {
      if (process.env.NEUROWORKS_CODE_EXEC !== "1") {
        return { error: "code.exec disabled — set NEUROWORKS_CODE_EXEC=1 in clawbot/.env and restart to enable. This primitive runs code in the host process; only enable in trusted environments." };
      }
      const lang = String(args.language ?? "").toLowerCase();
      if (lang !== "python" && lang !== "node") return { error: "language must be 'python' or 'node'" };
      const code = String(args.code ?? "");
      if (!code.trim()) return { error: "code is required" };
      const timeoutMs = Math.min(120_000, Math.max(1_000, Number(args.timeoutMs ?? 30_000)));
      const { spawn } = await import("node:child_process");
      const bin = lang === "python" ? (process.env.NEUROWORKS_PYTHON ?? "python") : "node";
      const flags = lang === "python" ? ["-c", code] : ["-e", code];
      return await new Promise<any>((resolve) => {
        const t0 = Date.now();
        const proc = spawn(bin, flags, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = ""; let stderr = "";
        proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); if (stdout.length > 32_000) stdout = stdout.slice(0, 32_000); });
        proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); if (stderr.length > 8_000) stderr = stderr.slice(0, 8_000); });
        const timer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, timeoutMs);
        proc.on("close", (code) => {
          clearTimeout(timer);
          resolve({ language: lang, exitCode: code, stdout: stdout.slice(0, 32_000), stderr: stderr.slice(0, 8_000), elapsedMs: Date.now() - t0 });
        });
        proc.on("error", (e) => { clearTimeout(timer); resolve({ error: `spawn failed: ${e.message}` }); });
      });
    },
  },
  {
    name: "knowledge.graph_query",
    description: "Build/update or query a local code+doc knowledge graph via the `graphify` CLI (github.com/Graphify-Labs/graphify) — turns a folder of code/docs into concepts + relationships you can query instead of grepping files. 'update' extracts/re-extracts the target folder into a graph (no LLM call, safe to re-run after edits — incremental). 'explain' returns a plain-language description of one concept and its neighbors. 'path' finds the shortest relationship path between two concepts. Requires the `graphify` CLI on PATH (uv tool install graphifyy).",
    readonly: false,
    args: [
      { name: "action", type: "string", required: true, description: "'update' (build/refresh the graph for target_path), 'explain' (describe one node), or 'path' (shortest path between two nodes)" },
      { name: "target_path", type: "string", required: true, description: "Absolute folder path to graph (for 'update') or the folder whose graphify-out/graph.json to query (for 'explain'/'path')" },
      { name: "node", type: "string", required: false, description: "Concept/node name — required for 'explain'" },
      { name: "node_a", type: "string", required: false, description: "Start node — required for 'path'" },
      { name: "node_b", type: "string", required: false, description: "End node — required for 'path'" },
    ],
    handler: async (args) => {
      const action = String(args.action ?? "").toLowerCase();
      if (!["update", "explain", "path"].includes(action)) return { error: "action must be 'update', 'explain', or 'path'" };
      const targetPath = String(args.target_path ?? "").trim();
      if (!targetPath) return { error: "target_path is required" };
      const { assertSafeExternalPath } = await import("./security-gates.js");
      assertSafeExternalPath(targetPath);
      const { spawn } = await import("node:child_process");
      const bin = process.env.NEUROWORKS_GRAPHIFY_BIN ?? "graphify";
      let cliArgs: string[];
      if (action === "update") {
        cliArgs = ["update", targetPath];
      } else if (action === "explain") {
        const node = String(args.node ?? "").trim();
        if (!node) return { error: "node is required for action 'explain'" };
        cliArgs = ["explain", node, "--graph", `${targetPath}/graphify-out/graph.json`];
      } else {
        const nodeA = String(args.node_a ?? "").trim();
        const nodeB = String(args.node_b ?? "").trim();
        if (!nodeA || !nodeB) return { error: "node_a and node_b are required for action 'path'" };
        cliArgs = ["path", nodeA, nodeB, "--graph", `${targetPath}/graphify-out/graph.json`];
      }
      const TIMEOUT_MS = action === "update" ? 120_000 : 20_000;
      return await new Promise<any>((resolve) => {
        const t0 = Date.now();
        let proc: any;
        try { proc = spawn(bin, cliArgs, { stdio: ["ignore", "pipe", "pipe"] }); }
        catch (e: any) { resolve({ error: `graphify not runnable (${e.message}) — install with: uv tool install graphifyy` }); return; }
        let stdout = ""; let stderr = "";
        proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); if (stdout.length > 32_000) stdout = stdout.slice(0, 32_000); });
        proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); if (stderr.length > 8_000) stderr = stderr.slice(0, 8_000); });
        const timer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* already dead */ } }, TIMEOUT_MS);
        proc.on("close", (code: number | null) => {
          clearTimeout(timer);
          resolve({ action, targetPath, exitCode: code, ok: code === 0, output: stdout.trim(), error: code === 0 ? undefined : (stderr.trim() || undefined), elapsedMs: Date.now() - t0 });
        });
        proc.on("error", (e: Error) => { clearTimeout(timer); resolve({ error: `graphify not runnable (${e.message}) — install with: uv tool install graphifyy` }); });
      });
    },
  },
  {
    name: "browser.harness_exec",
    description: "Run a short Python snippet against a REAL Chrome browser tab via browser-harness (github.com/browser-use/browser-harness) — CDP-level control: navigate, click by pixel coordinate, extract via JS, screenshot. Pre-imported helpers available in the snippet: new_tab(url) (use for FIRST navigation), ensure_real_tab(), page_info(), capture_screenshot(), click_at_xy(x,y), wait_for_load(), js(expr) for DOM extraction, cdp(\"Domain.method\", ...) for raw CDP. Use print(...) to return data — stdout is what comes back. Prefer this over web.interact when a site needs real browser rendering/login state the headless path can't reach. GATED: requires NEUROWORKS_BROWSER_HARNESS=1 (off by default — executes arbitrary Python with live browser + network access; only enable in trusted environments). Requires local Chrome with chrome://inspect/#remote-debugging enabled (the harness will prompt on first use) OR `browser-harness auth login` for a cloud browser.",
    readonly: false,
    args: [
      { name: "code", type: "string", required: true, description: "Python snippet to run. Helpers are pre-imported — do not import browser_harness yourself. End with print(...) to surface results." },
      { name: "timeout_ms", type: "number", required: false, description: "Wall budget (default 45000, max 120000) — browser actions are slower than plain code.exec" },
    ],
    handler: async (args) => {
      if (process.env.NEUROWORKS_BROWSER_HARNESS !== "1") {
        return { error: "browser.harness_exec disabled — set NEUROWORKS_BROWSER_HARNESS=1 in clawbot/.env and restart to enable. This primitive runs arbitrary Python with live browser + network access; only enable in trusted environments." };
      }
      const code = String(args.code ?? "");
      if (!code.trim()) return { error: "code is required" };
      const timeoutMs = Math.min(120_000, Math.max(5_000, Number(args.timeout_ms ?? 45_000)));
      const { spawn } = await import("node:child_process");
      const bin = process.env.NEUROWORKS_BROWSER_HARNESS_BIN ?? "browser-harness";
      return await new Promise<any>((resolve) => {
        const t0 = Date.now();
        let proc: any;
        try { proc = spawn(bin, [], { stdio: ["pipe", "pipe", "pipe"] }); }
        catch (e: any) { resolve({ error: `browser-harness not runnable (${e.message}) — install with: uv tool install browser-harness` }); return; }
        let stdout = ""; let stderr = "";
        proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); if (stdout.length > 32_000) stdout = stdout.slice(0, 32_000); });
        proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); if (stderr.length > 8_000) stderr = stderr.slice(0, 8_000); });
        const timer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* already dead */ } }, timeoutMs);
        proc.on("close", (code: number | null) => {
          clearTimeout(timer);
          resolve({ exitCode: code, ok: code === 0, output: stdout.trim(), error: code === 0 ? undefined : (stderr.trim() || undefined), elapsedMs: Date.now() - t0 });
        });
        proc.on("error", (e: Error) => { clearTimeout(timer); resolve({ error: `browser-harness not runnable (${e.message}) — install with: uv tool install browser-harness` }); });
        proc.stdin.write(code);
        proc.stdin.end();
      });
    },
  },
  {
    name: "memory.note",
    description: "Persist a single fact about a subject (a person, project, or topic) into the agent's long-term memory. Use to remember things like 'Priya prefers async over meetings', 'the auth migration is owned by Sam', 'the customer mentioned X budget'. Pass `date` (YYYY-MM-DD) for time-bound facts (a meeting, deadline, renewal) so they surface on that day's calendar plan. Stored at `_neuroworks/memory/<slug>.jsonl` and available to future sessions via `memory.recall`.",
    readonly: false,
    args: [
      { name: "subject", type: "string", required: true, description: "Who or what the fact is about — a name, project, or topic. Reused as the file key, so prefer canonical forms." },
      { name: "fact", type: "string", required: true, description: "The fact to remember. Short, declarative, attribution-free if possible." },
      { name: "source", type: "string", required: false, description: "Optional pointer (URL / vault path / jobId) so the fact can be re-verified later." },
      { name: "date", type: "string", required: false, description: "Optional calendar anchor YYYY-MM-DD for time-bound facts — links the fact to that day on calendar.plan_day / the daily briefing." },
    ],
    handler: async (args) => {
      const { noteFact } = await import("./memory.js");
      return noteFact({ subject: String(args.subject), fact: String(args.fact), source: args.source ? String(args.source) : undefined, date: args.date ? String(args.date) : undefined });
    },
  },
  {
    name: "memory.recall",
    description: "Return the last N facts persisted about a subject (latest first). Use at the start of any chat or team task to load context the agent should already know about the person / project being asked about.",
    readonly: true,
    args: [
      { name: "subject", type: "string", required: true, description: "Subject key — typically the same string you passed to `memory.note` earlier." },
      { name: "limit", type: "number", required: false, description: "Max facts to return (default 20)" },
    ],
    handler: async (args) => {
      const { recallSubject } = await import("./memory.js");
      const limit = Math.min(100, Math.max(1, Number(args.limit ?? 20)));
      return { facts: recallSubject(String(args.subject), limit) };
    },
  },
  {
    name: "memory.search",
    description: "Free-text search across every memory file. Use when you're not sure which subject a fact was filed under — searches subject, fact, and source fields.",
    readonly: true,
    args: [
      { name: "query", type: "string", required: true, description: "Search string (case-insensitive substring match)" },
      { name: "limit", type: "number", required: false, description: "Max hits (default 20)" },
    ],
    handler: async (args) => {
      const { searchMemory } = await import("./memory.js");
      const limit = Math.min(100, Math.max(1, Number(args.limit ?? 20)));
      return { facts: searchMemory(String(args.query), limit) };
    },
  },
  {
    name: "org.lookup",
    description: "Look up a person on the org chart (`_governance/people.md`) by id, display name, or persona_id. Returns title, manager, peers, reports. Use when a task names someone and you need to know who they are.",
    readonly: true,
    args: [{ name: "query", type: "string", required: true, description: "Person id, name, or persona_id" }],
    handler: async (args) => {
      const { lookupPerson } = await import("./org-chart.js");
      const p = lookupPerson(String(args.query ?? ""));
      return p ?? { error: `no person matching ${String(args.query)}` };
    },
  },
  {
    name: "org.escalation_path",
    description: "Return the manager chain for a person (id / name / persona_id), root last. Walks `manager` until it hits a person with no manager set (a human, by convention).",
    readonly: true,
    args: [{ name: "query", type: "string", required: true, description: "Person id, name, or persona_id" }],
    handler: async (args) => {
      const { escalationPath } = await import("./org-chart.js");
      return { chain: escalationPath(String(args.query ?? "")) };
    },
  },
  {
    name: "org.peers",
    description: "Return a person's peers (lateral teammates) from the org chart. Use for lateral handoffs — when a request lands on the wrong persona but a peer can cover it.",
    readonly: true,
    args: [{ name: "query", type: "string", required: true, description: "Person id, name, or persona_id" }],
    handler: async (args) => {
      const { peersOf } = await import("./org-chart.js");
      return { peers: peersOf(String(args.query ?? "")) };
    },
  },
  {
    name: "org.reports",
    description: "Return a person's direct reports from the org chart. Useful for status-report or team-digest tasks aimed at a team lead.",
    readonly: true,
    args: [{ name: "query", type: "string", required: true, description: "Person id, name, or persona_id" }],
    handler: async (args) => {
      const { reportsOf } = await import("./org-chart.js");
      return { reports: reportsOf(String(args.query ?? "")) };
    },
  },
  {
    name: "users.list",
    description: "List the people in the organization (the Users directory) — their name, email, role (admin/member/viewer), title, and department. Use to answer 'who is part of the org?', 'who's on the team?', 'who works in finance?', or to find someone's email before drafting/sending a message. Returns the directory; never returns passwords.",
    readonly: true,
    args: [],
    handler: async () => {
      const { directory } = await import("./users.js");
      return { users: directory() };
    },
  },
  {
    name: "users.lookup",
    description: "Look up ONE person in the organization's Users directory by name or email, and return their details (name, email, role, title, department). Use to resolve 'what's Jane's email?', 'who is Mr. Khumalo?', or to confirm someone is part of the org before acting. Returns null when there's no match.",
    readonly: true,
    args: [{ name: "query", type: "string", required: true, description: "A name or email (partial name allowed)" }],
    handler: async (args) => {
      const { lookupUser } = await import("./users.js");
      const user = lookupUser(String(args.query ?? ""));
      return user ? { user } : { user: null, note: "no matching person in the org directory" };
    },
  },
  {
    name: "human.request",
    description: "PAUSE the task and ask the human operator for something the system genuinely cannot supply itself: missing internal information (figures, credentials, context not in the vault/connectors/databases), a decision or sign-off, a document only they hold, or an offline/physical action. The task parks in a waiting state; when the human responds, it automatically continues with their input. items is a JSON array of {\"type\":\"answer\"|\"upload\"|\"approval\"|\"action\",\"prompt\":\"exactly what you need and why\"}. Use ONLY after the catalog truly can't provide it — never to dodge doable work.",
    readonly: true,
    args: [
      { name: "items", type: "string", required: true, description: "JSON array of typed asks, e.g. [{\"type\":\"answer\",\"prompt\":\"What is the approved Q3 budget ceiling (ZAR)?\"}]" },
      { name: "reason", type: "string", required: false, description: "One sentence on why the system can't finish without this" },
    ],
    handler: async (args) => {
      // Tolerant parsing — small planners emit the array as a string, an
      // already-parsed array, or a single bare object. Anything unusable
      // degrades to one generic "answer" item rather than failing the step
      // (failing here would turn a legitimate pause into a task error).
      const VALID = new Set(["answer", "upload", "approval", "action"]);
      let raw: any = args.items;
      if (typeof raw === "string") {
        try { raw = JSON.parse(raw); } catch { raw = [{ type: "answer", prompt: String(args.items) }]; }
      }
      if (raw && !Array.isArray(raw) && typeof raw === "object") raw = [raw];
      const items = (Array.isArray(raw) ? raw : [])
        .map((it: any) => ({
          type: VALID.has(String(it?.type)) ? String(it.type) : "answer",
          prompt: String(it?.prompt ?? it?.question ?? it?.ask ?? "").trim(),
        }))
        .filter((it: any) => it.prompt.length > 0)
        .slice(0, 10);
      if (items.length === 0) items.push({ type: "answer", prompt: "Provide the missing information needed to finish this task." });
      return {
        humanRequest: {
          items,
          reason: typeof args.reason === "string" && args.reason.trim() ? args.reason.trim().slice(0, 300) : undefined,
          requestedAt: new Date().toISOString(),
        },
        note: "task paused — waiting on the human operator",
      };
    },
  },
  {
    name: "integration.list",
    description: "List the external services the user has connected on the Integrations page (Slack, Telegram, Discord, GitHub, Notion, Linear, Google, etc.). Use to discover what channels/tools you can act on before reaching for slack.post / telegram.send / discord.post. Returns provider, label, and category — never secrets.",
    readonly: true,
    args: [],
    handler: async () => {
      const { listConnections } = await import("./integrations.js");
      return { connections: listConnections().map(c => ({ providerId: c.providerId, provider: c.providerName, label: c.label, category: c.category })) };
    },
  },
  {
    name: "slack.post",
    description: "Post a message to the user's connected Slack. Uses the Web API bot token (chat.postMessage) to a channel when configured — pass `channel` (id or #name) or rely on the connection's default channel — otherwise falls back to the saved Incoming Webhook. Requires a Slack connection on the Integrations page.",
    readonly: false,
    args: [
      { name: "text", type: "string", required: true, description: "Message text (Slack mrkdwn supported)" },
      { name: "channel", type: "string", required: false, description: "Channel id (C0123…) or #name. Bot-token mode only; defaults to the connection's default channel." },
    ],
    handler: async (args) => {
      const { getConnectionByProvider } = await import("./integrations.js");
      const conn = getConnectionByProvider("slack");
      if (!conn) return { error: "no Slack connection — add one on the Integrations page" };
      const text = String(args.text ?? "").trim();
      if (!text) return { error: "text is required" };
      const botToken = conn.secrets?.botToken;
      // Bot token → Web API chat.postMessage (needs a channel).
      if (botToken) {
        const channel = String(args.channel ?? conn.config?.defaultChannel ?? "").trim();
        if (!channel) return { error: "bot-token Slack needs a channel — pass `channel` or set a default channel on the connection" };
        const r = await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: { authorization: `Bearer ${botToken}`, "content-type": "application/json; charset=utf-8" },
          body: JSON.stringify({ channel, text }),
        });
        const j: any = await r.json().catch(() => ({}));
        return j?.ok ? { ok: true, posted: true, channel: j.channel, ts: j.ts, chars: text.length } : { error: `slack ${j?.error ?? r.status}` };
      }
      // Fall back to Incoming Webhook.
      if (conn.secrets?.webhookUrl) {
        const r = await fetch(conn.secrets.webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
        return r.ok ? { ok: true, posted: true, chars: text.length } : { error: `slack ${r.status}: ${(await r.text()).slice(0, 200)}` };
      }
      return { error: "Slack connection has neither a bot token nor a webhook URL" };
    },
  },
  {
    name: "telegram.send",
    description: "Send a message via the user's connected Telegram bot. Defaults to the saved chat id; pass chatId to override. Requires a Telegram connection on the Integrations page.",
    readonly: false,
    args: [
      { name: "text", type: "string", required: true, description: "Message text" },
      { name: "chatId", type: "string", required: false, description: "Override the default chat id" },
    ],
    handler: async (args) => {
      const { getConnectionByProvider } = await import("./integrations.js");
      const conn = getConnectionByProvider("telegram");
      if (!conn?.secrets?.botToken) return { error: "no Telegram connection — add one on the Integrations page" };
      const chatId = String(args.chatId ?? conn.config?.chatId ?? "").trim();
      if (!chatId) return { error: "no chatId (set a default on the Integrations page or pass chatId)" };
      const text = String(args.text ?? "").trim();
      if (!text) return { error: "text is required" };
      const r = await fetch(`https://api.telegram.org/bot${conn.secrets.botToken}/sendMessage`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      const j: any = await r.json().catch(() => ({}));
      return j?.ok ? { ok: true, sent: true, messageId: j.result?.message_id } : { error: `telegram: ${j?.description ?? `HTTP ${r.status}`}` };
    },
  },
  {
    name: "discord.post",
    description: "Post a message to the user's connected Discord channel (via the saved webhook). Requires a Discord connection on the Integrations page.",
    readonly: false,
    args: [{ name: "text", type: "string", required: true, description: "Message content" }],
    handler: async (args) => {
      const { getConnectionByProvider } = await import("./integrations.js");
      const conn = getConnectionByProvider("discord");
      if (!conn?.secrets?.webhookUrl) return { error: "no Discord connection — add one on the Integrations page" };
      const text = String(args.text ?? "").trim();
      if (!text) return { error: "text is required" };
      const r = await fetch(conn.secrets.webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: text.slice(0, 2000) }) });
      return (r.ok || r.status === 204) ? { ok: true, posted: true } : { error: `discord ${r.status}: ${(await r.text()).slice(0, 200)}` };
    },
  },
  {
    name: "msteams.post",
    description: "Post a message to the user's connected Microsoft Teams channel (via the saved Incoming Webhook). Use to notify a team of a result/alert. Requires a Microsoft Teams connection on the Integrations page.",
    readonly: false,
    args: [{ name: "text", type: "string", required: true, description: "Message text (Markdown supported in Teams)" }],
    handler: async (args) => {
      const { getConnectionByProvider } = await import("./integrations.js");
      const conn = getConnectionByProvider("msteams");
      if (!conn?.secrets?.webhookUrl) return { error: "no Microsoft Teams connection — add one on the Integrations page" };
      const text = String(args.text ?? "").trim();
      if (!text) return { error: "text is required" };
      const r = await fetch(conn.secrets.webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      return r.ok ? { ok: true, posted: true } : { error: `msteams ${r.status}: ${(await r.text()).slice(0, 200)}` };
    },
  },
  {
    name: "googlechat.post",
    description: "Post a message to the user's connected Google Chat space (via the saved webhook). Requires a Google Chat connection on the Integrations page.",
    readonly: false,
    args: [{ name: "text", type: "string", required: true, description: "Message text" }],
    handler: async (args) => {
      const { getConnectionByProvider } = await import("./integrations.js");
      const conn = getConnectionByProvider("googlechat");
      if (!conn?.secrets?.webhookUrl) return { error: "no Google Chat connection — add one on the Integrations page" };
      const text = String(args.text ?? "").trim();
      if (!text) return { error: "text is required" };
      const r = await fetch(conn.secrets.webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      return r.ok ? { ok: true, posted: true } : { error: `googlechat ${r.status}: ${(await r.text()).slice(0, 200)}` };
    },
  },
  {
    name: "webhook.post",
    description: "POST a JSON payload ({ text, source }) to the user's connected custom Webhook endpoint (Zapier/Make/n8n/own service). Use to push a result into an external automation. Requires a 'Webhook (custom)' connection on the Integrations page.",
    readonly: false,
    args: [{ name: "text", type: "string", required: true, description: "Payload text — sent as { text, source: 'neuroworks' }" }],
    handler: async (args) => {
      const { getConnectionByProvider } = await import("./integrations.js");
      const conn = getConnectionByProvider("webhook");
      if (!conn?.secrets?.webhookUrl) return { error: "no custom Webhook connection — add one on the Integrations page" };
      const text = String(args.text ?? "").trim();
      if (!text) return { error: "text is required" };
      const r = await fetch(conn.secrets.webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, source: "neuroworks" }) });
      return r.status < 500 ? { ok: true, posted: true, status: r.status } : { error: `webhook ${r.status}: ${(await r.text()).slice(0, 200)}` };
    },
  },
  {
    name: "connector.list",
    description: "List the company systems (external HTTP APIs) the operator has registered as Connectors. Use to discover which in-house/third-party systems you can read from or act on before reaching for connector.call. Returns id, label, baseUrl, description and a count of documented endpoints — never credentials.",
    readonly: true,
    args: [],
    handler: async () => {
      const { listConnectors } = await import("./connectors.js");
      return {
        connectors: listConnectors().map(c => ({
          id: c.id, label: c.label, baseUrl: c.baseUrl, description: c.description,
          writeEnabled: c.writeEnabled, endpoints: c.endpoints?.length ?? 0,
          auth: c.auth.type, lastTest: c.lastTest,
        })),
      };
    },
  },
  {
    name: "connector.describe",
    description: "Read the full manifest of one registered company-system Connector so you understand how to call it: its baseUrl, auth scheme, and the named endpoints (method + path + description + documented params). Always describe a connector before calling it. Pass the connector id or label. Never returns secrets.",
    readonly: true,
    args: [{ name: "connector", type: "string", required: true, description: "Connector id or label" }],
    handler: async (args) => {
      const { getConnectorPublic } = await import("./connectors.js");
      const c = getConnectorPublic(String(args.connector ?? ""));
      if (!c) return { error: `connector "${args.connector}" not found — list connectors first` };
      return {
        id: c.id, label: c.label, baseUrl: c.baseUrl, description: c.description,
        auth: c.auth, writeEnabled: c.writeEnabled, headers: c.headers ? Object.keys(c.headers) : [],
        endpoints: c.endpoints ?? [],
      };
    },
  },
  {
    name: "connector.call",
    description: "Make an authenticated HTTP request to a registered company-system Connector. Credentials are applied automatically from the stored connector — never include keys/tokens yourself. Calls are READ-ONLY (GET/HEAD) unless the operator enabled writes on that connector. Path is relative to the connector's baseUrl (e.g. '/v1/invoices' or '/customers/123'); cross-origin paths are rejected. Returns { ok, status, body } with the response (JSON parsed when possible).",
    readonly: false,
    args: [
      { name: "connector", type: "string", required: true, description: "Connector id or label" },
      { name: "path", type: "string", required: true, description: "Path relative to the connector baseUrl, e.g. /v1/orders" },
      { name: "method", type: "string", required: false, description: "HTTP method (default GET). Non-GET requires the connector to have writes enabled." },
      { name: "query", type: "string", required: false, description: "Query params as a flat JSON object, e.g. {\"status\":\"open\",\"limit\":50}" },
      { name: "body", type: "string", required: false, description: "Request body as JSON (or a raw string). Only used for non-GET methods." },
    ],
    handler: async (args) => {
      const { callConnector, listConnectors } = await import("./connectors.js");
      // query/body may arrive as a real object (planner emitted JSON) or a
      // JSON string (LLM stringified it) — accept both.
      const coerce = (v: any): any => {
        if (v === undefined || v === null || v === "") return undefined;
        if (typeof v === "string") { try { return JSON.parse(v); } catch { return v; } }
        return v;
      };
      const query = coerce(args.query);
      const connectorRef = String(args.connector ?? "");
      let path = String(args.path ?? "");
      let pathNote: string | undefined;
      // Path resolution against the connector's DECLARED endpoints. Live
      // orchestration testing showed agents guess paths from memory
      // ("/dashboard") instead of reading the manifest ("/api/public/
      // dashboard") and eat 404s. Resolve, in order: exact endpoint NAME,
      // exact declared path, then a declared path whose tail matches the
      // guess. Unknown paths still go through unchanged (some APIs have
      // undeclared routes) — but a 404 now returns the declared endpoint
      // list so the agent can self-correct in the next step.
      let declared: { name: string; method: string; path: string }[] = [];
      try {
        const ref = connectorRef.toLowerCase();
        const conn = listConnectors().find((c: any) => c.id === connectorRef || String(c.label ?? "").toLowerCase() === ref);
        declared = (conn?.endpoints ?? []).map((e: any) => ({ name: String(e.name ?? ""), method: String(e.method ?? "GET"), path: String(e.path ?? "") }));
        const guess = path.replace(/^\//, "").toLowerCase();
        const byName = declared.find(e => e.name.toLowerCase() === guess || e.name.toLowerCase() === guess.replace(/[/ ]+/g, "-") || e.name.toLowerCase() === guess.replace(/[/ ]+/g, "_"));
        const byPath = declared.find(e => e.path.replace(/^\//, "").toLowerCase() === guess);
        const byTail = !byName && !byPath && guess.length >= 4
          ? declared.find(e => e.path.toLowerCase().endsWith("/" + guess) || e.path.toLowerCase().endsWith(guess))
          : undefined;
        const hit = byName ?? byPath ?? byTail;
        if (hit && hit.path && hit.path !== path) {
          pathNote = `resolved "${path}" to the connector's declared endpoint ${hit.name} (${hit.path})`;
          path = hit.path;
        }
      } catch { /* resolution is best-effort — fall through to the raw path */ }
      const result: any = await callConnector(connectorRef, {
        method: args.method ? String(args.method) : "GET",
        path,
        query: (query && typeof query === "object") ? query as Record<string, any> : undefined,
        body: coerce(args.body),
      });
      if (pathNote && result && typeof result === "object") result.pathNote = pathNote;
      if (result && typeof result === "object" && result.status === 404 && declared.length > 0) {
        result.hint = `404 — "${path}" is not a declared endpoint on this connector. Declared endpoints: ${declared.slice(0, 12).map(e => `${e.name} (${e.method} ${e.path})`).join(", ")}. Retry with one of these paths.`;
      }
      return result;
    },
  },
  {
    name: "payment.link",
    description: "Create a payment link to BILL A CLIENT for a given amount, using the operator's connected Stripe account. Use when asked to 'send a payment link', 'invoice the client', 'collect R/$X', or 'charge the customer'. Returns { url } — a hosted page the client pays on. Amount is in major units (e.g. 4999.00). Requires Stripe configured (Settings → Payments).",
    readonly: false,
    args: [
      { name: "amount", type: "number", required: true, description: "Amount in major units, e.g. 4999.00" },
      { name: "description", type: "string", required: true, description: "What the payment is for (shown to the payer)" },
      { name: "currency", type: "string", required: false, description: "ISO currency (default from config, e.g. zar/usd)" },
    ],
    handler: async (args) => {
      const { config } = await import("../config.js");
      if (!config.paymentsEnabled) return { error: "payments not configured — set STRIPE_SECRET_KEY (Settings → Payments)" };
      const amount = Number(args.amount);
      if (!Number.isFinite(amount) || amount <= 0) return { error: "amount must be a positive number" };
      const description = String(args.description ?? "").trim();
      if (!description) return { error: "description is required" };
      try {
        const { createPaymentLink } = await import("./payments.js");
        const link = await createPaymentLink({ amount, description, currency: args.currency ? String(args.currency) : undefined });
        return { ok: true, url: link.url, amount: link.amount, currency: link.currency, description: link.description };
      } catch (e: any) {
        return { error: String(e?.message ?? e) };
      }
    },
  },
  {
    name: "payment.paynow_link",
    description: "Request a Paynow (Zimbabwe) payment for a client — EcoCash, OneMoney, card, or bank transfer. MONEY MOVES ONLY AFTER OPERATOR APPROVAL: this queues the payment on the Approvals page and returns { pendingApproval, approvalJobId }. Tell the user the payment is awaiting their approval — once they approve it, the payment link is created and appears in Reports (payment.paynow_poll checks it afterwards). Amount is in major units of the merchant account's currency. Requires Paynow configured (PAYNOW_INTEGRATION_ID/KEY).",
    readonly: false,
    args: [
      { name: "amount", type: "number", required: true, description: "Amount in major units, e.g. 150.00" },
      { name: "description", type: "string", required: true, description: "What the payment is for (shown to the payer)" },
      { name: "reference", type: "string", required: false, description: "Unique reference (auto-generated when omitted)" },
      { name: "email", type: "string", required: false, description: "Payer's email (Paynow auth email)" },
    ],
    handler: async (args) => {
      const { config } = await import("../config.js");
      if (!config.paynowEnabled) return { error: "Paynow not configured — set PAYNOW_INTEGRATION_ID and PAYNOW_INTEGRATION_KEY in .env" };
      const amount = Number(args.amount);
      if (!Number.isFinite(amount) || amount <= 0) return { error: "amount must be a positive number" };
      const description = String(args.description ?? "").trim();
      if (!description) return { error: "description is required" };
      // Agent-initiated payments NEVER execute directly — they queue an
      // awaiting-approval job the operator confirms on the Approvals page
      // (the approve endpoint then creates the real Paynow payment). The
      // operator's own Payments-page form still creates directly: a human
      // clicking the button IS the approval.
      const { newJob } = await import("./jobs.js");
      const j = newJob("payments:paynow-approval");
      j.status = "awaiting-approval";
      j.requiresApproval = true;
      j.template = "paynow-payment";
      j.title = `Paynow payment — ${amount.toFixed(2)}: ${description.slice(0, 80)}`;
      j.inputs = {
        amount,
        description,
        reference: args.reference ? String(args.reference) : undefined,
        email: args.email ? String(args.email) : undefined,
      };
      j.log.push(`[${new Date().toISOString()}] agent requested a Paynow payment — waiting for operator approval`);
      return {
        pendingApproval: true,
        approvalJobId: j.id,
        amount,
        description,
        note: "Payment queued for operator approval on the Approvals page. It will be created (and the pay link issued) only once approved — tell the user to approve it there.",
      };
    },
  },
  {
    name: "payment.paynow_poll",
    description: "Check the outcome of a Paynow payment created earlier with payment.paynow_link, using its pollUrl. Returns { status, paid } — status is one of Created/Sent/Cancelled/Failed/Paid/Awaiting Delivery/Delivered/Refunded.",
    readonly: true,
    args: [{ name: "pollUrl", type: "string", required: true, description: "The pollUrl returned by payment.paynow_link" }],
    handler: async (args) => {
      const { config } = await import("../config.js");
      if (!config.paynowEnabled) return { error: "Paynow not configured" };
      try {
        const { pollPaynowStatus } = await import("./paynow.js");
        return await pollPaynowStatus(String(args.pollUrl ?? ""));
      } catch (e: any) {
        return { error: String(e?.message ?? e) };
      }
    },
  },
  {
    name: "payment.status",
    description: "Check whether the payment gateway (Stripe) is configured and reachable, and which currency it settles in. Use before attempting payment.link if unsure. Returns { enabled, provider, currency, account? }.",
    readonly: true,
    args: [],
    handler: async () => {
      const { gatewayStatus } = await import("./payments.js");
      const s = await gatewayStatus();
      return { enabled: s.enabled, provider: s.provider, currency: s.currency, account: s.account, detail: s.detail };
    },
  },
  {
    name: "payment.list",
    description: "List recent payments (payment intents) from the operator's Stripe account — id, amount, currency, status. Use for revenue/collections questions like 'what came in this week' or 'has the client paid'. Requires Stripe configured.",
    readonly: true,
    args: [{ name: "limit", type: "number", required: false, description: "How many to return (default 20, max 100)" }],
    handler: async (args) => {
      const { config } = await import("../config.js");
      if (!config.paymentsEnabled) return { error: "payments not configured — set STRIPE_SECRET_KEY (Settings → Payments)" };
      try {
        const { listPayments } = await import("./payments.js");
        return { payments: await listPayments(Number(args.limit) || 20) };
      } catch (e: any) {
        return { error: String(e?.message ?? e) };
      }
    },
  },
  {
    name: "media.tts",
    description: "Generate spoken-audio narration of text using MiniMax text-to-speech. Use when the user asks to 'read this aloud', 'make a voiceover/narration', 'turn this into audio', or wants an audio version of a briefing/summary. Returns { path, bytes, model } — a local .mp3 the user can play. Requires MINIMAX_API_KEY (Integrations → MiniMax).",
    readonly: false,
    args: [
      { name: "text", type: "string", required: true, description: "The text to speak (markdown is stripped automatically before speaking)" },
      { name: "voice_id", type: "string", required: false, description: "Optional MiniMax voice id (default 'male-qn-qingse')" },
      { name: "emotion", type: "string", required: false, description: "Optional emotion: happy, sad, angry, fearful, disgusted, surprised, neutral" },
    ],
    handler: async (args) => {
      const { config } = await import("../config.js");
      if (!config.minimaxEnabled) return { error: "MiniMax not configured — add MINIMAX_API_KEY to enable text-to-speech." };
      const { minimaxTts } = await import("./minimax.js");
      const text = String(args.text ?? "").trim().replace(/[#*`_>]/g, "");
      if (!text) return { error: "text is required" };
      return await minimaxTts(text, {
        voiceId: args.voice_id ? String(args.voice_id) : undefined,
        emotion: args.emotion ? String(args.emotion) : undefined,
      });
    },
  },
  {
    name: "media.video",
    description: "Generate a short video from a text prompt (optionally an image as the first frame) using MiniMax Hailuo. Use for 'make a video of…', 'generate a clip…', 'animate this scene'. Async — can take a few minutes. Returns { downloadUrl, taskId, model }. Requires MINIMAX_API_KEY.",
    readonly: false,
    args: [
      { name: "prompt", type: "string", required: true, description: "Description of the video to generate" },
      { name: "first_frame_image", type: "string", required: false, description: "Optional public image URL or data URI to use as the opening frame (image-to-video)" },
    ],
    handler: async (args) => {
      const { config } = await import("../config.js");
      if (!config.minimaxEnabled) return { error: "MiniMax not configured — add MINIMAX_API_KEY to enable video generation." };
      const { minimaxVideo } = await import("./minimax.js");
      const prompt = String(args.prompt ?? "").trim();
      if (!prompt) return { error: "prompt is required" };
      return await minimaxVideo(prompt, { firstFrameImage: args.first_frame_image ? String(args.first_frame_image) : undefined });
    },
  },
  {
    name: "media.music",
    description: "Generate a music track from a style/mood prompt (and optional lyrics) using MiniMax music. Use for 'compose a jingle/theme/track', 'make background music'. Returns { path, bytes, model } — a local .mp3. Requires MINIMAX_API_KEY.",
    readonly: false,
    args: [
      { name: "prompt", type: "string", required: true, description: "Style / mood / genre description (e.g. 'upbeat corporate intro, 120bpm, piano + strings')" },
      { name: "lyrics", type: "string", required: false, description: "Optional lyrics to sing" },
    ],
    handler: async (args) => {
      const { config } = await import("../config.js");
      if (!config.minimaxEnabled) return { error: "MiniMax not configured — add MINIMAX_API_KEY to enable music generation." };
      const { minimaxMusic } = await import("./minimax.js");
      const prompt = String(args.prompt ?? "").trim();
      if (!prompt) return { error: "prompt is required" };
      return await minimaxMusic(prompt, { lyrics: args.lyrics ? String(args.lyrics) : undefined });
    },
  },
  {
    name: "media.avatar_video",
    description: "Generate an AI avatar / spokesperson video (a presenter speaking your script) using HeyGen. Use for 'make a talking-head/explainer/presenter video', 'have an avatar read this announcement'. Async — a render can take a few minutes; this waits for it. Returns { videoUrl, videoId, avatarId, voiceId }. Pass avatarId/voiceId from media.avatars / media.voices, or omit to use the account defaults. Requires HEYGEN_API_KEY.",
    readonly: false,
    args: [
      { name: "script", type: "string", required: true, description: "The words the avatar should say" },
      { name: "avatar_id", type: "string", required: false, description: "HeyGen avatar id (from media.avatars); omit for the account default" },
      { name: "voice_id", type: "string", required: false, description: "HeyGen voice id (from media.voices); omit for the account default" },
      { name: "background", type: "string", required: false, description: "Optional solid background colour hex, e.g. #ffffff" },
    ],
    handler: async (args) => {
      const { config } = await import("../config.js");
      if (!config.heygenEnabled) return { error: "HeyGen not configured — add HEYGEN_API_KEY to enable avatar video generation." };
      const script = String(args.script ?? "").trim();
      if (!script) return { error: "script is required" };
      const { heygenGenerateAndWait } = await import("./heygen.js");
      return await heygenGenerateAndWait({
        script,
        avatarId: args.avatar_id ? String(args.avatar_id) : undefined,
        voiceId: args.voice_id ? String(args.voice_id) : undefined,
        background: args.background ? String(args.background) : undefined,
      });
    },
  },
  {
    name: "media.avatars",
    description: "List the HeyGen avatars available on the account (id + name) so you can pick one for media.avatar_video. Requires HEYGEN_API_KEY.",
    readonly: true,
    args: [],
    handler: async () => {
      const { config } = await import("../config.js");
      if (!config.heygenEnabled) return { error: "HeyGen not configured — add HEYGEN_API_KEY." };
      const { heygenListAvatars } = await import("./heygen.js");
      const avatars = await heygenListAvatars();
      return { avatars: avatars.map(a => ({ avatar_id: a.avatar_id, name: a.avatar_name, gender: a.gender })) };
    },
  },
  {
    name: "media.voices",
    description: "List the HeyGen voices available (id + name + language) so you can pick one for media.avatar_video. Requires HEYGEN_API_KEY.",
    readonly: true,
    args: [],
    handler: async () => {
      const { config } = await import("../config.js");
      if (!config.heygenEnabled) return { error: "HeyGen not configured — add HEYGEN_API_KEY." };
      const { heygenListVoices } = await import("./heygen.js");
      const voices = await heygenListVoices();
      return { voices: voices.map(v => ({ voice_id: v.voice_id, name: v.name, language: v.language, gender: v.gender })) };
    },
  },
  {
    name: "orchestration.plan",
    description: "Decompose a complex objective into parallel sub-tasks, execute them simultaneously via independent agents, and synthesize the results. Use for multi-faceted research, cross-domain analysis, or any task that benefits from splitting work across specialists. Returns { id, label, status, subTasks: [{label, personaName, status, output}], finalReport }. Sub-tasks run in parallel — each agent sees only their own instructions. Final synthesis merges all outputs.",
    readonly: false,
    args: [
      { name: "objective", type: "string", required: true, description: "The complex objective to decompose and execute" },
    ],
    handler: async (args) => {
      const objective = String(args.objective ?? "").trim();
      if (!objective) return { error: "objective is required" };
      const { createOrchestration } = await import("./orchestrator.js");
      const run = await createOrchestration(objective);
      return {
        id: run.id,
        label: run.label,
        status: run.status,
        subTasks: run.subTasks.map(s => ({ id: s.id, label: s.label, personaName: s.personaName, status: s.status, error: s.error, elapsedMs: s.elapsedMs, output: s.output.slice(0, 2000) })),
        finalReport: run.finalReport.slice(0, 4000),
        elapsedMs: run.elapsedMs,
      };
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
    case "github.comment_on_issue":return s("issueNumber") ? `Commenting on issue #${s("issueNumber")}` : "Commenting on a GitHub issue";
    case "github.update_issue":return s("issueNumber") ? `Updating issue #${s("issueNumber")}` : "Updating a GitHub issue";
    case "github.request_review":return s("pullNumber") ? `Requesting review on PR #${s("pullNumber")}` : "Requesting review on a PR";
    case "github.list_issues":  return s("name") ? `Listing issues in ${s("name")}` : "Listing GitHub issues";
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
    case "db.list_sources":    return "Listing connected databases";
    case "db.list_tables":     return s("source") ? `Listing tables in ${s("source")}` : "Listing database tables";
    case "db.describe_table":  return s("source") && s("table") ? `Describing ${s("source")}.${s("table")}` : "Describing a table";
    case "db.query":           return s("source") ? `Querying ${s("source")}` : "Querying a database";
    case "db.write":           return s("source") ? `Writing to ${s("source")}` : "Writing to a database";
    case "integration.slack.post":return "Posting to Slack";
    case "integration.gmail.send":return s("to") ? `Sending email to ${s("to")}` : "Sending an email";
    case "integration.gmail.read":return s("query") ? `Reading Gmail for "${s("query")}"` : "Reading Gmail";
    case "clock.now":          return "Checking the clock";
    case "web.search":         return s("query") ? `Searching the web for "${s("query")}"` : "Searching the web";
    case "research.deep":      return s("query") ? `Researching "${s("query").slice(0, 80)}${s("query").length > 80 ? "…" : ""}" — vault + web` : "Researching";
    case "research.multiperspective": return s("topic") ? `Multi-perspective research: "${s("topic")}"` : "Multi-perspective research";
    case "peer.delegate":      return s("task") ? `Delegating to a peer clawbot` : "Delegating to a peer";
    case "peer.review":        return "Asking a peer to review the draft";
    case "orchestration.plan": return "Orchestrating parallel sub-agents for this task";
    case "quality.check":      return "Quality-checking the draft";
    case "security.scan":      return s("kind") ? `Security-scanning the ${s("kind")}` : "Security-scanning the content";
    case "governance.check":   return "Checking against governance policies";
    case "finance.snapshot":   return "Reading the latest Aiia Finance figures";
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
