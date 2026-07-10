// Document text extraction for non-plaintext vault files. When the customer
// drops a PDF, Word doc, or spreadsheet into their vault, clawbot needs to
// see what's INSIDE it — not just "Untitled.docx" as a filename. This module
// is the unified entry point: pass it a path, get back markdown-flavoured
// text, regardless of source format.
//
// Cached by (path + mtime + size) so re-reads inside a single sub-agent burst
// don't re-parse a 30-page PDF. The cache is in-memory only — restarting the
// server re-parses on first access. Acceptable since extraction is fast for
// typical office docs (sub-second to a few seconds for big PDFs).

import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, basename } from "node:path";

export type ExtractResult = {
  text: string;
  kind: "markdown" | "pdf" | "docx" | "xlsx" | "csv" | "txt" | "code" | "unsupported";
  ext: string;
  name: string;
  bytes: number;
  pages?: number;       // PDFs
  sheets?: string[];    // XLSX
  truncated?: boolean;  // we capped at MAX_BYTES_OUT
  fromCache: boolean;
};

const MAX_BYTES_IN = 25 * 1024 * 1024;   // 25 MB cap on input file
const MAX_BYTES_OUT = 500_000;            // 500 KB cap on extracted text
const CACHE_MAX = 64;

type CacheEntry = { key: string; result: ExtractResult; at: number };
const cache = new Map<string, CacheEntry>();

function cacheKey(path: string, mtimeMs: number, size: number): string {
  return `${path}::${Math.round(mtimeMs)}::${size}`;
}

function rememberInCache(path: string, mtimeMs: number, size: number, result: ExtractResult): void {
  const key = cacheKey(path, mtimeMs, size);
  cache.set(key, { key, result: { ...result, fromCache: true }, at: Date.now() });
  if (cache.size > CACHE_MAX) {
    // Evict the oldest. Linear scan is fine at 64 entries.
    let oldest: CacheEntry | undefined;
    for (const v of cache.values()) {
      if (!oldest || v.at < oldest.at) oldest = v;
    }
    if (oldest) cache.delete(oldest.key);
  }
}

function lookupCache(path: string, mtimeMs: number, size: number): ExtractResult | null {
  const hit = cache.get(cacheKey(path, mtimeMs, size));
  return hit ? hit.result : null;
}

function clampText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_BYTES_OUT) return { text, truncated: false };
  return { text: text.slice(0, MAX_BYTES_OUT), truncated: true };
}

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".rst", ".org", ".log"]);
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java", ".rb", ".c", ".cpp", ".h", ".hpp", ".sh", ".bash", ".zsh", ".ps1", ".sql", ".html", ".css", ".scss", ".json", ".yaml", ".yml", ".toml", ".xml", ".ini"]);

// Main entry point. Detects format by extension, dispatches to the right
// parser, caches the result. Throws only on file-not-found / read errors —
// parsing errors fall through with `kind: "unsupported"` and a friendly text
// fallback so callers can decide how to handle.
export async function extractDocText(absPath: string): Promise<ExtractResult> {
  if (!existsSync(absPath)) throw new Error(`file not found: ${absPath}`);
  const st = statSync(absPath);
  if (!st.isFile()) throw new Error(`not a file: ${absPath}`);
  if (st.size > MAX_BYTES_IN) throw new Error(`file too large for extraction (${st.size} bytes, cap ${MAX_BYTES_IN})`);

  const cached = lookupCache(absPath, st.mtimeMs, st.size);
  if (cached) return cached;

  const ext = extname(absPath).toLowerCase();
  const name = basename(absPath);
  const baseMeta = { ext, name, bytes: st.size, fromCache: false };

  let result: ExtractResult;

  if (TEXT_EXTENSIONS.has(ext) || ext === "") {
    const raw = readFileSync(absPath, "utf8");
    const { text, truncated } = clampText(raw);
    result = { ...baseMeta, text, kind: ext === ".md" || ext === ".markdown" ? "markdown" : "txt", truncated };
  } else if (CODE_EXTENSIONS.has(ext)) {
    const raw = readFileSync(absPath, "utf8");
    const { text, truncated } = clampText(raw);
    result = { ...baseMeta, text, kind: "code", truncated };
  } else if (ext === ".pdf") {
    result = await extractPdf(absPath, baseMeta);
  } else if (ext === ".docx") {
    result = await extractDocx(absPath, baseMeta);
  } else if (ext === ".xlsx" || ext === ".xls" || ext === ".xlsm") {
    result = await extractXlsx(absPath, baseMeta);
  } else if (ext === ".csv" || ext === ".tsv") {
    const raw = readFileSync(absPath, "utf8");
    const { text, truncated } = clampText(raw);
    result = { ...baseMeta, text, kind: "csv", truncated };
  } else {
    // Last resort: try to read as text. Many "weird" files (configs, no-ext
    // scripts) are still UTF-8.
    try {
      const raw = readFileSync(absPath, "utf8");
      // Reject binary-looking content (high ratio of null/non-printable bytes).
      const head = raw.slice(0, 2000);
      const printable = head.replace(/[\t\n\r\x20-\x7E]/g, "").length;
      const ratio = head.length > 0 ? printable / head.length : 1;
      if (ratio > 0.2) {
        result = { ...baseMeta, text: `(${ext || "unknown"} binary file — no text extractor configured)`, kind: "unsupported" };
      } else {
        const { text, truncated } = clampText(raw);
        result = { ...baseMeta, text, kind: "txt", truncated };
      }
    } catch (e: any) {
      result = { ...baseMeta, text: `(failed to read: ${String(e?.message ?? e).slice(0, 200)})`, kind: "unsupported" };
    }
  }

  rememberInCache(absPath, st.mtimeMs, st.size, result);
  return result;
}

// PDF — pdf-parse-fork loads each page's text content. We DON'T preserve
// layout; consuming the prose is what matters for the agent. Inline image
// captions, tables, and form fields come through as best-effort plaintext.
//
// Auto-OCR fallback: when pdf-parse returns near-empty text (image-only
// PDFs — scans, photos of documents), we transparently invoke the OCR
// layer so the agent gets the actual content instead of an empty string.
// Opt out with CLAWBOT_OCR_AUTO=0 or by passing an image-only PDF larger
// than the OCR cap (handled inside ocrFile).
const OCR_AUTO = process.env.CLAWBOT_OCR_AUTO !== "0";
const OCR_MIN_TEXT_THRESHOLD = 100; // chars below which we suspect image-only
async function extractPdf(path: string, meta: { ext: string; name: string; bytes: number; fromCache: boolean }): Promise<ExtractResult> {
  try {
    const mod: any = await import("pdf-parse-fork");
    const parser = mod.default ?? mod;
    const buf = readFileSync(path);
    const out = await parser(buf, { max: 200 }); // cap at 200 pages
    const rawText = String(out?.text ?? "").trim();
    const pages = out?.numpages ?? undefined;
    // Image-only PDF? Fall back to OCR if enabled.
    if (OCR_AUTO && rawText.length < OCR_MIN_TEXT_THRESHOLD) {
      try {
        const { ocrFile } = await import("./ocr.js");
        const ocr = await ocrFile(path, "auto");
        const { text: clamped, truncated } = clampText(ocr.text);
        return {
          ...meta,
          text: clamped,
          kind: "pdf",
          pages,
          truncated,
        };
      } catch (ocrErr: any) {
        // OCR failed — return the original (empty) text with a hint in the
        // text body so the synth model knows what happened.
        const note = `(no text extractable from this PDF; OCR fallback failed: ${String(ocrErr?.message ?? ocrErr).slice(0, 200)})`;
        return { ...meta, text: rawText.length > 0 ? rawText : note, kind: "pdf", pages, truncated: false };
      }
    }
    const { text, truncated } = clampText(rawText);
    return { ...meta, text, kind: "pdf", pages, truncated };
  } catch (e: any) {
    return { ...meta, text: `(PDF extraction failed: ${String(e?.message ?? e).slice(0, 200)})`, kind: "pdf" };
  }
}

// DOCX — mammoth converts to markdown directly, which is the format the
// rest of the agent prefers anyway. Headings, lists, bold/italic, links all
// survive. Tables come through as Markdown tables.
async function extractDocx(path: string, meta: { ext: string; name: string; bytes: number; fromCache: boolean }): Promise<ExtractResult> {
  try {
    const mod: any = await import("mammoth");
    const m = mod.default ?? mod;
    const buf = readFileSync(path);
    const out = await m.convertToMarkdown({ buffer: buf });
    const { text, truncated } = clampText(String(out?.value ?? "").trim());
    return { ...meta, text, kind: "docx", truncated };
  } catch (e: any) {
    return { ...meta, text: `(DOCX extraction failed: ${String(e?.message ?? e).slice(0, 200)})`, kind: "docx" };
  }
}

// XLSX — SheetJS gives us per-sheet rows, which we render as Markdown tables.
// Multi-sheet workbooks become multi-section markdown so the agent can
// distinguish "Revenue" sheet from "Costs" sheet by heading.
async function extractXlsx(path: string, meta: { ext: string; name: string; bytes: number; fromCache: boolean }): Promise<ExtractResult> {
  try {
    const mod: any = await import("xlsx");
    const XLSX = mod.default ?? mod;
    // Read the bytes ourselves — SheetJS's ESM build ships without fs wired
    // (XLSX.readFile throws "Cannot access file <path>" on a file that exists
    // unless set_fs() was called). Passing a buffer sidesteps fs entirely.
    const buf = readFileSync(path);
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true, cellText: false });
    const sheetNames: string[] = wb.SheetNames ?? [];
    const sections: string[] = [];
    for (const name of sheetNames.slice(0, 12)) {
      const sheet = wb.Sheets[name];
      const csv: string = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
      const lines = csv.split("\n").filter(Boolean).slice(0, 500);
      sections.push(`## Sheet: ${name}\n\n\`\`\`csv\n${lines.join("\n")}\n\`\`\``);
    }
    const merged = sections.join("\n\n");
    const { text, truncated } = clampText(merged);
    return { ...meta, text, kind: "xlsx", sheets: sheetNames, truncated };
  } catch (e: any) {
    return { ...meta, text: `(XLSX extraction failed: ${String(e?.message ?? e).slice(0, 200)})`, kind: "xlsx" };
  }
}

// Parallel batch extraction. Used by vault.scan_docs to read N files at once.
// We cap concurrency so 50 PDFs in a folder don't OOM the server. Each result
// includes the path so callers can correlate inputs and outputs.
export async function extractDocsParallel(
  absPaths: string[],
  opts: { concurrency?: number } = {},
): Promise<{ path: string; ok: true; result: ExtractResult }[] | { path: string; ok: false; error: string }[] | ({ path: string; ok: true; result: ExtractResult } | { path: string; ok: false; error: string })[]> {
  const concurrency = Math.max(1, Math.min(16, opts.concurrency ?? 6));
  const results: ({ path: string; ok: true; result: ExtractResult } | { path: string; ok: false; error: string })[] = [];
  for (let i = 0; i < absPaths.length; i += concurrency) {
    const batch = absPaths.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(async (p): Promise<{ path: string; ok: true; result: ExtractResult } | { path: string; ok: false; error: string }> => {
      try {
        const result = await extractDocText(p);
        return { path: p, ok: true, result };
      } catch (e: any) {
        return { path: p, ok: false, error: String(e?.message ?? e) };
      }
    }));
    results.push(...batchResults);
  }
  return results;
}

export function clearDocExtractorCache(): { entries: number } {
  const n = cache.size;
  cache.clear();
  return { entries: n };
}

export function docExtractorStats() {
  return {
    entries: cache.size,
    capacity: CACHE_MAX,
  };
}
