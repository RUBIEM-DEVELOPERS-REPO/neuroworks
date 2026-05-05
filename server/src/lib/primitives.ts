import { existsSync, readdirSync, readFileSync, statSync, appendFileSync } from "node:fs";
import { resolve, basename, extname, sep, join } from "node:path";
import { config } from "../config.js";
import { ollamaGenerateWithMeta } from "./ollama.js";
import { listVault, readVaultFile, searchVault, writeVaultFile } from "./vault.js";
import { listOwnedRepos, recentCommits, openPRs, openIssues, readme, octokit } from "./github.js";

export type ArgSpec = { name: string; type: "string" | "number" | "boolean"; required: boolean; description: string };

export type Primitive = {
  name: string;
  description: string;
  args: ArgSpec[];
  // true = read-only, won't mutate state. used to decide whether a plan needs approval.
  readonly: boolean;
  handler: (args: Record<string, any>) => Promise<any>;
};

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
    description: "Read a markdown or text file from the vault. Path is relative to vault root.",
    readonly: true,
    args: [{ name: "path", type: "string", required: true, description: "Vault-relative path, e.g. 2-Permanent/202604271220-neuroworks.md" }],
    handler: async (args) => ({ content: readVaultFile(String(args.path)) }),
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
    handler: async (args) => { writeVaultFile(String(args.path), String(args.content)); return { written: String(args.path) }; },
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
    description: "HTTP GET a URL and return up to 100 KB of text (HTML stripped to plain text). Bounded to 8s.",
    readonly: true,
    args: [{ name: "url", type: "string", required: true, description: "Full URL including protocol" }],
    handler: async (args) => {
      const url = String(args.url);
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      try {
        const r = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
        const ct = r.headers.get("content-type") ?? "";
        const buf = await r.text();
        const truncated = buf.slice(0, 100_000);
        const text = ct.includes("html") ? truncated.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : truncated;
        return { status: r.status, contentType: ct, text };
      } finally { clearTimeout(t); }
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
    description: "Read a text file from anywhere on disk. Capped at 200 KB.",
    readonly: true,
    args: [{ name: "path", type: "string", required: true, description: "Absolute file path" }],
    handler: async (args) => {
      const full = resolve(String(args.path));
      if (!existsSync(full)) throw new Error(`file not found: ${full}`);
      const st = statSync(full);
      if (!st.isFile()) throw new Error("not a file");
      if (st.size > 200_000) throw new Error(`file too large (${st.size} bytes, cap 200000)`);
      return { content: readFileSync(full, "utf8"), size: st.size, ext: extname(full), name: basename(full) };
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

export function primitivesPromptCatalog(): string {
  return primitives.map(p => {
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
    case "vault.read":         return s("path") ? `Reading note ${s("path")}` : "Reading a note";
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
    case "fs.list_external":   return s("path") ? `Looking inside ${s("path")}` : "Browsing your files";
    case "fs.read_external":   return s("path") ? `Reading ${s("path")}` : "Reading a file";
    case "clock.now":          return "Checking the clock";
    default:                   return tool;
  }
}
