import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve, basename, extname, sep } from "node:path";
import { homedir } from "node:os";
import { config } from "../config.js";

const CATEGORIES: Record<string, string[]> = {
  Documents: [".pdf", ".docx", ".doc", ".md", ".txt", ".rtf", ".odt", ".epub"],
  Slides: [".pptx", ".ppt", ".key", ".odp"],
  Spreadsheets: [".xlsx", ".xls", ".csv", ".ods", ".numbers"],
  Images: [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".heic", ".cr2", ".raw", ".bmp", ".tiff"],
  Video: [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"],
  Audio: [".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac"],
  Archives: [".zip", ".tar", ".gz", ".rar", ".7z", ".bz2"],
  Web: [".html", ".htm"],
  Code: [".js", ".ts", ".tsx", ".jsx", ".json", ".py", ".rb", ".go", ".rs", ".sh", ".yaml", ".yml"],
};

const SKIP_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
const MAX_BYTES = 500 * 1024 * 1024; // 500 MB hard cap per file

type State = Record<string, [number, number]>; // filename -> [size, mtime_seconds]

function categorize(filename: string): string {
  const ext = extname(filename).toLowerCase();
  for (const [cat, exts] of Object.entries(CATEGORIES)) {
    if (exts.includes(ext)) return cat;
  }
  return "Other";
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function* walk(dir: string, depth = 0): Generator<string> {
  if (depth > 4) return;
  let entries: any[] = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith(".") || SKIP_NAMES.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full, depth + 1);
    else if (e.isFile()) yield full;
  }
}

export type SyncResult = {
  source: string;
  totalFiles: number;
  byCategory: Record<string, { name: string; relPath: string; size: number; mtimeMs: number }[]>;
  copiedThisRun: { name: string; size: number }[];
  copyErrors: { name: string; error: string }[];
  bytesCopied: number;
};

export function syncDownloads(opts: { source?: string }, push: (msg: string) => void): SyncResult {
  const source = resolve(opts.source && opts.source.trim() !== "" ? opts.source : join(homedir(), "Downloads"));
  if (!existsSync(source)) throw new Error(`source not found: ${source}`);
  push(`source: ${source}`);

  const vaultRoot = config.vaultPath;
  const dstBase = join(vaultRoot, "_knowledge", "downloads");
  const filesBase = join(dstBase, "files");
  const stateFile = join(dstBase, ".sync-state.json");
  mkdirSync(filesBase, { recursive: true });

  const state: State = existsSync(stateFile) ? safeJson(readFileSync(stateFile, "utf8")) ?? {} : {};
  const newState: State = {};

  const byCategory: Record<string, { name: string; relPath: string; size: number; mtimeMs: number }[]> = {};
  const copied: { name: string; size: number }[] = [];
  const errors: { name: string; error: string }[] = [];
  let bytesCopied = 0;
  let total = 0;

  for (const fullPath of walk(source)) {
    const name = basename(fullPath);
    let st;
    try { st = statSync(fullPath); } catch { continue; }
    if (!st.isFile()) continue;
    if (st.size > MAX_BYTES) { errors.push({ name, error: `over ${fmtSize(MAX_BYTES)} cap` }); continue; }

    total++;
    const cat = categorize(name);
    const catDir = join(filesBase, cat);
    mkdirSync(catDir, { recursive: true });
    const dst = join(catDir, name);
    const relPath = `files/${cat}/${name}`.split(sep).join("/");
    const sizeMtime: [number, number] = [st.size, Math.floor(st.mtimeMs / 1000)];

    const prev = state[name];
    const unchanged = prev && prev[0] === sizeMtime[0] && prev[1] === sizeMtime[1] && existsSync(dst);

    if (!unchanged) {
      try {
        copyFileSync(fullPath, dst);
        try { utimesSync(dst, st.atimeMs / 1000, st.mtimeMs / 1000); } catch {}
        copied.push({ name, size: st.size });
        bytesCopied += st.size;
      } catch (e: any) {
        errors.push({ name, error: e.message });
        continue;
      }
    }

    newState[name] = sizeMtime;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push({ name, relPath, size: st.size, mtimeMs: st.mtimeMs });
  }

  // Sort each category by mtime desc
  for (const cat of Object.keys(byCategory)) {
    byCategory[cat].sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  writeFileSync(stateFile, JSON.stringify(newState, null, 2), "utf8");
  push(`scanned ${total} files; copied ${copied.length} (${fmtSize(bytesCopied)}); errors ${errors.length}`);

  const inv = renderInventory(source, byCategory, copied, errors, bytesCopied);
  writeFileSync(join(dstBase, "inventory.md"), inv, "utf8");

  return { source, totalFiles: total, byCategory, copiedThisRun: copied, copyErrors: errors, bytesCopied };
}

function renderInventory(
  source: string,
  byCategory: Record<string, { name: string; relPath: string; size: number; mtimeMs: number }[]>,
  copied: { name: string; size: number }[],
  errors: { name: string; error: string }[],
  bytesCopied: number,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const cats = Object.keys(byCategory).sort((a, b) => byCategory[b].length - byCategory[a].length);
  const total = Object.values(byCategory).reduce((n, xs) => n + xs.length, 0);

  const lines: string[] = [];
  lines.push("---");
  lines.push(`title: Downloads inventory (${today})`);
  lines.push("tags: [downloads, inventory, clawbot]");
  lines.push(`created: ${today}`);
  lines.push("source: clawbot neuroworks sync-downloads");
  lines.push("---");
  lines.push("");
  lines.push("# Downloads inventory");
  lines.push("");
  lines.push(`Mirror of \`${source}\` on ${today}. Files are **copied** into \`files/<category>/\` so the vault has a self-contained archive — originals are never moved or deleted.`);
  lines.push("");
  lines.push(`Total files: **${total}** across **${cats.length}** categories. Copied this run: **${copied.length}** (${fmtSize(bytesCopied)}). Copy errors: **${errors.length}**.`);
  lines.push("");

  if (copied.length > 0) {
    lines.push(`## New / changed since last sync (${copied.length})`);
    lines.push("");
    for (const c of copied.slice(0, 60)) lines.push(`- \`${c.name}\``);
    if (copied.length > 60) lines.push(`- _…and ${copied.length - 60} more_`);
    lines.push("");
  }

  if (errors.length > 0) {
    lines.push(`## Copy errors (${errors.length})`);
    lines.push("");
    for (const e of errors.slice(0, 40)) lines.push(`- \`${e.name}\` — ${e.error}`);
    lines.push("");
  }

  for (const cat of cats) {
    const xs = byCategory[cat];
    lines.push(`## ${cat} (${xs.length})`);
    lines.push("");
    lines.push("| File | Size | Modified |");
    lines.push("|---|---|---|");
    for (const x of xs.slice(0, 250)) {
      const url = encodeURI(x.relPath).replace(/\(/g, "%28").replace(/\)/g, "%29");
      const mod = new Date(x.mtimeMs).toISOString().slice(0, 10);
      lines.push(`| [${x.name}](${url}) | ${fmtSize(x.size)} | ${mod} |`);
    }
    if (xs.length > 250) lines.push(`| _…${xs.length - 250} more not listed_ | | |`);
    lines.push("");
  }
  return lines.join("\n");
}

function safeJson(s: string): any { try { return JSON.parse(s); } catch { return null; } }
