import { Router } from "express";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";
import { renderMarkdownToPdf } from "../lib/browser.js";
import { markdownToDocxBuffer } from "../lib/docx-export.js";

// Download endpoints — turn any markdown answer / report into a PDF or .docx
// the operator can email a customer or attach to a deal review. Two flavours
// per format: POST with raw markdown (for ad-hoc/UI downloads), GET with a
// vault path (for downloading existing vault files without copy-paste).

export const exportsRouter = Router();

function safeFilename(name: string, ext: string): string {
  let f = String(name ?? "document").replace(/[/\\:*?"<>|]+/g, "-").replace(/^\.+/, "");
  if (!new RegExp(`\\.${ext}$`, "i").test(f)) f += "." + ext;
  return f;
}

function readVaultMarkdown(path: string): string {
  // Limit to .md files inside the vault to defend against path traversal /
  // exfiltrating arbitrary files via the export route.
  const safe = String(path).replace(/^[/\\]+/, "");
  if (safe.includes("..")) throw new Error("invalid path");
  if (!/\.(md|markdown|txt)$/i.test(safe)) throw new Error("only .md / .txt files can be exported");
  const full = resolve(config.vaultPath, safe);
  if (!full.startsWith(resolve(config.vaultPath))) throw new Error("path escapes vault");
  return readFileSync(full, "utf8");
}

exportsRouter.post("/pdf", async (req, res) => {
  try {
    const markdown = String(req.body?.markdown ?? "");
    const title = req.body?.title ? String(req.body.title) : undefined;
    const filename = safeFilename(req.body?.filename ?? "document", "pdf");
    if (!markdown.trim()) return res.status(400).json({ error: "markdown is required" });
    // renderMarkdownToPdf writes to vault; for a downloadable file we want
    // the bytes back inline. Use a temp path under exports/, then re-read.
    const stamp = Date.now();
    const tmpRel = `_neuroworks/exports/.tmp-${stamp}.pdf`;
    await renderMarkdownToPdf({ markdown, title, vaultRelPath: tmpRel });
    const buf = readFileSync(resolve(config.vaultPath, tmpRel));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e).slice(0, 300) });
  }
});

exportsRouter.post("/docx", async (req, res) => {
  try {
    const markdown = String(req.body?.markdown ?? "");
    const title = req.body?.title ? String(req.body.title) : undefined;
    const filename = safeFilename(req.body?.filename ?? "document", "docx");
    if (!markdown.trim()) return res.status(400).json({ error: "markdown is required" });
    const buf = await markdownToDocxBuffer(markdown, { title });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e).slice(0, 300) });
  }
});

exportsRouter.post("/markdown", (req, res) => {
  const markdown = String(req.body?.markdown ?? "");
  const filename = safeFilename(req.body?.filename ?? "document", "md");
  if (!markdown.trim()) return res.status(400).json({ error: "markdown is required" });
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(markdown);
});

// GET variants — let the operator click a download link in an email or a
// share-sheet without the client needing to fetch the vault content first.
exportsRouter.get("/pdf", async (req, res) => {
  try {
    const path = String(req.query.path ?? "");
    if (!path) return res.status(400).send("path query param required");
    const markdown = readVaultMarkdown(path);
    const filename = safeFilename(path.split("/").pop() ?? "document", "pdf");
    const stamp = Date.now();
    const tmpRel = `_neuroworks/exports/.tmp-${stamp}.pdf`;
    await renderMarkdownToPdf({ markdown, vaultRelPath: tmpRel });
    const buf = readFileSync(resolve(config.vaultPath, tmpRel));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (e: any) {
    res.status(500).send(String(e?.message ?? e).slice(0, 300));
  }
});

exportsRouter.get("/docx", async (req, res) => {
  try {
    const path = String(req.query.path ?? "");
    if (!path) return res.status(400).send("path query param required");
    const markdown = readVaultMarkdown(path);
    const filename = safeFilename(path.split("/").pop() ?? "document", "docx");
    const buf = await markdownToDocxBuffer(markdown);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (e: any) {
    res.status(500).send(String(e?.message ?? e).slice(0, 300));
  }
});
