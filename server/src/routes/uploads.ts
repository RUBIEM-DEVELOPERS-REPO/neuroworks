// Document upload endpoint.
//
// Two destinations for an uploaded document:
//   1. target: "vault" — import the file into the user's knowledge base
//      (Obsidian vault). Calls importBinaryIntoVault — same path
//      fs.import_to_vault uses — so PDF/DOCX/XLSX extraction + sidecar
//      writing all just work. Returns the vault-relative path.
//
//   2. target: "context" — stash the file in a temporary context dir
//      keyed by contextId. A subsequent chat message can reference the
//      contextId via attachments:[{contextId}]; chat.ts loads the text
//      (extracted from the binary if needed) and folds it into the
//      enriched task so the persona can reason over it.
//
// Inputs come as JSON to keep the route dependency-free (no multer /
// busboy). Filename, base64 content, optional MIME type, target. A 25 MB
// JSON body cap on index.ts means PDFs up to ~18 MB raw work.
//
// Security: filename is sanitized against path traversal; vault target
// goes through the same writeVaultFile + importBinaryIntoVault gates
// that prevent escaping the vault root. Context dir lives outside the
// vault to keep ephemeral uploads from polluting the user's notes.

import { Router } from "express";
import { writeFileSync, mkdirSync, existsSync, statSync, readdirSync, unlinkSync, readFileSync } from "node:fs";
import { dirname, resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { importBinaryIntoVault } from "../lib/vault.js";
import { extractDocText } from "../lib/doc-extractor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Context uploads live outside the vault — they're scratch space, not
// permanent knowledge. Cleaned up on a TTL (default 1h) so old context
// files don't accumulate.
const CONTEXT_DIR = resolve(__dirname, "../../../.neuroworks/context-uploads");
// Default TTL — overridable per upload via body.ttlSeconds. Clamped to
// [60s, 7 days] so a runaway value can't park stale uploads indefinitely
// or evict an upload before it's used.
const CONTEXT_TTL_MS = Number(process.env.NEUROWORKS_CONTEXT_UPLOAD_TTL_MS ?? "3600000");
const MIN_TTL_MS = 60_000;
const MAX_TTL_MS = 7 * 24 * 3600_000;

// Reject anything that could escape the vault, hit a system-managed folder,
// or look like an absolute path. mkdirSync inside importBinaryIntoVault will
// auto-create any safe user folder, so callers can stash uploads under
// arbitrary categories ("meetings", "2024-Q3", etc.) — not just the four
// standard Zettel folders.
const SYSTEM_PREFIXES = ["_clawbot", "_archive", "_neuroworks", ".git", ".obsidian"];
function isSafeVaultFolder(p: string): boolean {
  if (!p || p.length > 200) return false;
  if (/^[A-Za-z]:|^[/\\]/.test(p)) return false;
  if (p.split("/").some(seg => seg === "" || seg === "." || seg === "..")) return false;
  if (!/^[A-Za-z0-9_./-]+$/.test(p)) return false;
  const top = p.split("/")[0];
  if (SYSTEM_PREFIXES.some(prefix => top === prefix)) return false;
  return true;
}

export const uploadsRouter = Router();

// Sanitize a user-supplied filename. Strips path components, weird chars,
// and limits length. Without this an attacker could traverse the filesystem
// via "../../etc/passwd"-style filenames.
function sanitizeFilename(raw: string): string {
  const name = basename(String(raw ?? "")).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 200);
  return name || `upload-${Date.now()}.bin`;
}

// Per-upload TTL is recorded in a sidecar `.ttl` file next to the upload
// (contents = the TTL in ms as a plain integer). gcContextDir reads it on
// each pass and falls back to the default CONTEXT_TTL_MS when missing.
// Sidecars themselves are unlinked alongside the data file so we don't
// leak orphan .ttl files after the parent expires.
function readEffectiveTtlMs(fullPath: string): number {
  try {
    const sidecar = `${fullPath}.ttl`;
    if (!existsSync(sidecar)) return CONTEXT_TTL_MS;
    const raw = readFileSync(sidecar, "utf8").trim();
    const n = Number(raw);
    if (Number.isFinite(n) && n >= MIN_TTL_MS && n <= MAX_TTL_MS) return n;
    return CONTEXT_TTL_MS;
  } catch { return CONTEXT_TTL_MS; }
}

// Best-effort TTL cleanup of stale context uploads. Runs on each request;
// cheap (just stat + unlink). Avoids needing a separate cron.
function gcContextDir() {
  if (!existsSync(CONTEXT_DIR)) return;
  try {
    const now = Date.now();
    for (const entry of readdirSync(CONTEXT_DIR)) {
      // Skip sidecar .ttl files — they're swept alongside their parent.
      if (entry.endsWith(".ttl")) continue;
      const full = join(CONTEXT_DIR, entry);
      try {
        const st = statSync(full);
        const effectiveTtl = readEffectiveTtlMs(full);
        if (now - st.mtimeMs > effectiveTtl) {
          if (st.isFile()) {
            unlinkSync(full);
            try { unlinkSync(`${full}.ttl`); } catch {}
          } else if (st.isDirectory()) {
            for (const inner of readdirSync(full)) {
              try { unlinkSync(join(full, inner)); } catch {}
            }
          }
        }
      } catch {}
    }
  } catch {}
}

// POST /api/uploads
// Body: { filename, contentBase64, target: "vault" | "context", vaultFolder?, mimeType? }
uploadsRouter.post("/", async (req, res) => {
  try {
    gcContextDir();
    const filename = sanitizeFilename(req.body?.filename ?? "");
    const contentBase64 = String(req.body?.contentBase64 ?? "");
    const target = String(req.body?.target ?? "context");
    const rawFolder = String(req.body?.vaultFolder ?? "0-Inbox").trim().replace(/^\/+|\/+$/g, "").replace(/\\/g, "/");
    const vaultFolder = isSafeVaultFolder(rawFolder) ? rawFolder : "0-Inbox";
    const folderRewritten = vaultFolder !== rawFolder;
    const mimeType = req.body?.mimeType ? String(req.body.mimeType) : undefined;
    // Per-upload TTL override (context target only). Clamped server-side so
    // a caller can't park a file forever or pre-expire it before pickup.
    const requestedTtlSec = Number(req.body?.ttlSeconds);
    const ttlMs = (Number.isFinite(requestedTtlSec) && requestedTtlSec > 0)
      ? Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, requestedTtlSec * 1000))
      : CONTEXT_TTL_MS;

    if (!contentBase64) return res.status(400).json({ error: "contentBase64 required" });
    if (!filename) return res.status(400).json({ error: "filename required" });
    if (target !== "vault" && target !== "context") {
      return res.status(400).json({ error: "target must be 'vault' or 'context'" });
    }

    // Decode the base64 once. The size cap on express.json handles the
    // request-body limit; we additionally cap the decoded buffer at 20 MB
    // to stop a payload from claiming compressed-then-decoded gigantism.
    let buf: Buffer;
    try { buf = Buffer.from(contentBase64, "base64"); }
    catch (e: any) { return res.status(400).json({ error: `base64 decode failed: ${e?.message ?? e}` }); }
    if (buf.length === 0) return res.status(400).json({ error: "decoded payload is empty" });
    if (buf.length > 20 * 1024 * 1024) return res.status(413).json({ error: `decoded payload too large: ${buf.length} bytes > 20 MB cap` });

    if (target === "vault") {
      // Stash to a temp path first so importBinaryIntoVault has a real
      // source file to copy from. The vault import handles PDF/DOCX
      // extraction and sidecar generation.
      mkdirSync(CONTEXT_DIR, { recursive: true });
      const tempPath = join(CONTEXT_DIR, `vault-staging-${Date.now()}-${filename}`);
      writeFileSync(tempPath, buf);
      const binaryRel = join(vaultFolder, filename).replace(/\\/g, "/");
      try {
        importBinaryIntoVault(binaryRel, tempPath);
        return res.json({
          ok: true,
          target: "vault",
          vaultPath: binaryRel,
          bytes: buf.length,
          folderRequested: rawFolder,
          folderUsed: vaultFolder,
          folderRewritten,
          message: folderRewritten
            ? `Requested folder "${rawFolder}" was unsafe — imported to ${binaryRel} instead.`
            : `Imported to vault at ${binaryRel}`,
        });
      } finally {
        try { unlinkSync(tempPath); } catch {}
      }
    }

    // Context destination — write to CONTEXT_DIR keyed by contextId.
    const contextId = randomUUID();
    mkdirSync(CONTEXT_DIR, { recursive: true });
    const filePath = join(CONTEXT_DIR, `${contextId}__${filename}`);
    writeFileSync(filePath, buf);
    // Persist the effective TTL as a sidecar — gcContextDir reads this on
    // every pass to decide eligibility. Stored as a plain integer (ms) so
    // it's grep-friendly during incident triage.
    if (ttlMs !== CONTEXT_TTL_MS) {
      try { writeFileSync(`${filePath}.ttl`, String(ttlMs), "utf8"); } catch {}
    }

    // Eagerly extract text so chat.ts can fold it into the enriched task
    // without per-request extraction latency. For unsupported binary types,
    // extractedText is undefined and chat will skip it.
    let extractedText: string | undefined;
    let extractError: string | undefined;
    try {
      const ext = await extractDocText(filePath);
      if (ext?.text && ext.text.trim().length > 0) extractedText = ext.text;
    } catch (e: any) { extractError = String(e?.message ?? e).slice(0, 200); }

    return res.json({
      ok: true,
      target: "context",
      contextId,
      filename,
      bytes: buf.length,
      mimeType,
      hasExtractedText: Boolean(extractedText),
      extractedChars: extractedText?.length ?? 0,
      extractError,
      ttlSeconds: Math.floor(ttlMs / 1000),
      ttlDefaultSeconds: Math.floor(CONTEXT_TTL_MS / 1000),
      ttlCustom: ttlMs !== CONTEXT_TTL_MS,
      // The contextId is the handle a subsequent /api/chat call uses via
      // body.attachments: [{ contextId: "<this>" }]. Surface it prominently.
      usage: `Reference this upload in chat via attachments:[{contextId:"${contextId}"}]`,
    });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// GET /api/uploads/context/:contextId
// Inspect a context upload (metadata + extracted text preview). Used by
// chat.ts at task-enrich time to fold attached document text into the
// planner's prompt. Caller passes contextId; we return the text.
uploadsRouter.get("/context/:contextId", async (req, res) => {
  try {
    if (!existsSync(CONTEXT_DIR)) return res.status(404).json({ error: "context dir empty" });
    const id = String(req.params.contextId);
    if (!/^[a-f0-9-]+$/i.test(id)) return res.status(400).json({ error: "invalid contextId" });
    const match = readdirSync(CONTEXT_DIR).find(e => e.startsWith(`${id}__`));
    if (!match) return res.status(404).json({ error: "context upload not found (may have expired)" });
    const filePath = join(CONTEXT_DIR, match);
    const st = statSync(filePath);
    const filename = match.replace(/^[^_]+__/, "");
    let extractedText: string | undefined;
    let extractError: string | undefined;
    try { const ext = await extractDocText(filePath); if (ext?.text) extractedText = ext.text; }
    catch (e: any) { extractError = String(e?.message ?? e).slice(0, 200); }
    res.json({
      contextId: id,
      filename,
      bytes: st.size,
      uploadedAt: st.mtime.toISOString(),
      text: extractedText,
      extractError,
    });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

export async function resolveContextAttachment(contextId: string): Promise<{ filename: string; text: string } | null> {
  // Internal helper used by chat.ts to fold attachment text into enriched
  // tasks. Returns null if the context upload has expired or wasn't found.
  try {
    if (!existsSync(CONTEXT_DIR)) return null;
    const match = readdirSync(CONTEXT_DIR).find(e => e.startsWith(`${contextId}__`));
    if (!match) return null;
    const filePath = join(CONTEXT_DIR, match);
    const filename = match.replace(/^[^_]+__/, "");
    const ext = await extractDocText(filePath);
    if (!ext?.text) {
      // Binary that we couldn't extract — fall back to raw UTF-8 read for
      // text-like files (.md, .txt, .csv) that the extractor doesn't handle.
      try {
        const raw = readFileSync(filePath, "utf8");
        if (raw && raw.length > 0) return { filename, text: raw };
      } catch {}
      return null;
    }
    return { filename, text: ext.text };
  } catch { return null; }
}
