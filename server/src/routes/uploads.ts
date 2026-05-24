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
const CONTEXT_TTL_MS = Number(process.env.CLAWBOT_CONTEXT_UPLOAD_TTL_MS ?? "3600000");

export const uploadsRouter = Router();

// Sanitize a user-supplied filename. Strips path components, weird chars,
// and limits length. Without this an attacker could traverse the filesystem
// via "../../etc/passwd"-style filenames.
function sanitizeFilename(raw: string): string {
  const name = basename(String(raw ?? "")).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 200);
  return name || `upload-${Date.now()}.bin`;
}

// Best-effort TTL cleanup of stale context uploads. Runs on each request;
// cheap (just stat + unlink). Avoids needing a separate cron.
function gcContextDir() {
  if (!existsSync(CONTEXT_DIR)) return;
  try {
    const now = Date.now();
    for (const entry of readdirSync(CONTEXT_DIR)) {
      const full = join(CONTEXT_DIR, entry);
      try {
        const st = statSync(full);
        if (now - st.mtimeMs > CONTEXT_TTL_MS) {
          if (st.isFile()) unlinkSync(full);
          else if (st.isDirectory()) {
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
    const vaultFolder = String(req.body?.vaultFolder ?? "0-Inbox");
    const mimeType = req.body?.mimeType ? String(req.body.mimeType) : undefined;

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
          message: `Imported to vault at ${binaryRel}`,
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
      ttlSeconds: Math.floor(CONTEXT_TTL_MS / 1000),
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
