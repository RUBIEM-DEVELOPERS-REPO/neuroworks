import { Router } from "express";
import { existsSync, renameSync, readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, basename, join, extname, relative, sep } from "node:path";
import { listVault, readVaultFile, searchVault, writeVaultFile, getVaultHealth } from "../lib/vault.js";
import { buildIndex, indexStats, isBuildInProgress } from "../lib/vault-index.js";
import { enqueueVaultCommit } from "../lib/commit-queue.js";
import { extractDocText } from "../lib/doc-extractor.js";
import { newJob, runJob } from "../lib/jobs.js";
import { config } from "../config.js";

export const brainRouter = Router();

// Pre-flight health check used by every read endpoint below. When the vault
// path is unreachable (drive unmounted, path renamed, env misconfigured),
// return 503 with a structured `vaultMissing` payload so the UI can show
// a clear banner instead of pretending the vault is empty.
function requireVault(res: any): boolean {
  const h = getVaultHealth();
  if (h.exists) return true;
  res.status(503).json({
    error: h.reason ?? "vault unreachable",
    vaultMissing: true,
    vaultPath: h.vaultPath,
    health: h,
  });
  return false;
}

// Lightweight health probe — UI uses this to render the banner on the
// Knowledge page and the Admin dashboard.
brainRouter.get("/health", (_req, res) => {
  res.json(getVaultHealth());
});

brainRouter.get("/tree", (req, res) => {
  if (!requireVault(res)) return;
  const path = String(req.query.path ?? "");
  try { res.json({ path, entries: listVault(path) }); }
  catch (e: any) { res.status(400).json({ error: e.message }); }
});

brainRouter.get("/file", (req, res) => {
  if (!requireVault(res)) return;
  const path = String(req.query.path ?? "");
  if (!path) return res.status(400).json({ error: "path required" });
  try { res.json({ path, content: readVaultFile(path) }); }
  catch (e: any) { res.status(400).json({ error: e.message }); }
});

// Save a markdown / text file edit from the Doc Editor page. Goes through
// the same writeVaultFile + commit-queue as agent-side writes so the
// operator's edits get the same audit trail (committed, eventually pushed
// to the vault remote). Limited to text files — binary writes go through
// /api/uploads.
brainRouter.post("/file", (req, res) => {
  if (!requireVault(res)) return;
  const path = String(req.body?.path ?? "").replace(/^[/\\]+/, "");
  const content = typeof req.body?.content === "string" ? req.body.content : null;
  if (!path) return res.status(400).json({ error: "path required" });
  if (content === null) return res.status(400).json({ error: "content (string) required" });
  if (path.includes("..")) return res.status(400).json({ error: "path may not contain .." });
  if (!/\.(md|markdown|txt)$/i.test(path)) return res.status(400).json({ error: "only .md / .markdown / .txt files can be edited via this endpoint" });
  try {
    writeVaultFile(path, content);
    void enqueueVaultCommit(`doc-editor: save ${path}`);
    res.json({ ok: true, path, bytes: Buffer.byteLength(content, "utf8") });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Make sure a binary doc (PDF/DOCX/XLSX/...) has a sibling .md sidecar so
// the Doc editor can edit it. Two input shapes accepted:
//   1. binary path: `0-Inbox/offer.pdf` → writes `0-Inbox/offer.md` next to it
//   2. sidecar path: `0-Inbox/offer.md` → searches the same dir+stem for a
//      .pdf/.docx/.xlsx/... and generates the sidecar from that
// Used by the Doc editor upload flow (new uploads) AND by the editor's
// load-error recovery (a binary was imported via /api/uploads in a previous
// session without a sidecar — we generate it on demand).
//
// Idempotent: if the sidecar already exists and has non-trivial content,
// we leave it alone unless force=true is passed.
brainRouter.post("/ensure-sidecar", async (req, res) => {
  if (!requireVault(res)) return;
  const rawPath = String(req.body?.path ?? "").replace(/^[/\\]+/, "");
  const force = req.body?.force === true;
  if (!rawPath) return res.status(400).json({ error: "path required" });
  if (rawPath.includes("..")) return res.status(400).json({ error: "path may not contain .." });
  const binaryExts = [".pdf", ".docx", ".xlsx", ".pptx", ".ppt", ".doc", ".xls", ".rtf", ".odt", ".ods", ".odp"];
  const ext = extname(rawPath).toLowerCase();
  let binaryRel: string | null = null;
  let sidecarRel: string;
  if (binaryExts.includes(ext)) {
    binaryRel = rawPath;
    sidecarRel = rawPath.slice(0, -ext.length) + ".md";
  } else if (ext === ".md" || ext === ".markdown" || ext === "") {
    sidecarRel = rawPath.endsWith(".md") || rawPath.endsWith(".markdown") ? rawPath : `${rawPath}.md`;
    const stem = sidecarRel.replace(/\.(md|markdown)$/i, "");
    for (const candidate of binaryExts) {
      const candidateAbs = resolve(config.vaultPath, `${stem}${candidate}`);
      if (existsSync(candidateAbs)) {
        binaryRel = `${stem}${candidate}`;
        break;
      }
    }
    if (!binaryRel) {
      return res.status(404).json({
        error: `no source binary found next to ${sidecarRel} — tried ${binaryExts.join(", ")}`,
        triedExtensions: binaryExts,
      });
    }
  } else {
    return res.status(400).json({ error: `unsupported extension: ${ext}` });
  }

  const sidecarAbs = resolve(config.vaultPath, sidecarRel);
  const binaryAbs = resolve(config.vaultPath, binaryRel);
  // Defence-in-depth — confirm resolved paths stayed inside the vault root.
  const vaultRoot = resolve(config.vaultPath);
  if (!sidecarAbs.startsWith(vaultRoot + sep) || !binaryAbs.startsWith(vaultRoot + sep)) {
    return res.status(400).json({ error: "path escapes vault" });
  }

  // Idempotency — keep an existing sidecar with real content unless caller
  // explicitly asked for regeneration.
  if (!force && existsSync(sidecarAbs)) {
    try {
      const existing = readFileSync(sidecarAbs, "utf8");
      if (existing.trim().length > 200) {
        return res.json({ ok: true, sidecarPath: sidecarRel, sourcePath: binaryRel, regenerated: false, reason: "sidecar already exists" });
      }
    } catch { /* fall through and regenerate */ }
  }

  try {
    const ex = await extractDocText(binaryAbs);
    const excerpt = (ex.text ?? "").slice(0, 50_000).trim();
    const title = basename(binaryRel).replace(/\.[^.]+$/, "");
    const today = new Date().toISOString().slice(0, 10);
    const body = `---
title: ${title}
source: ${binaryRel}
extracted_from: ${ex.kind}${ex.pages ? `\nsource_pages: ${ex.pages}` : ""}
generated: ${today}
---

# ${title}

${excerpt || "_(no extractable text — this is likely a scanned image PDF. Edit by hand below.)_"}
${ex.truncated ? "\n_(extractor truncated the source text — full document remains at the source path.)_\n" : ""}`;
    writeVaultFile(sidecarRel, body);
    void enqueueVaultCommit(`doc-editor: ensure sidecar ${sidecarRel}`);
    res.json({ ok: true, sidecarPath: sidecarRel, sourcePath: binaryRel, regenerated: true, bytes: Buffer.byteLength(body, "utf8") });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

brainRouter.get("/search", (req, res) => {
  if (!requireVault(res)) return;
  const q = String(req.query.q ?? "").trim();
  if (!q) return res.json({ q, results: [] });
  res.json({ q, results: searchVault(q) });
});

brainRouter.get("/digest/latest", (req, res) => {
  if (!requireVault(res)) return;
  try { res.json({ content: readVaultFile("_clawbot/latest.md") }); }
  catch (e: any) { res.status(404).json({ error: e.message }); }
});

// POST /api/brain/discard
//   Body: { path: "_imports/downloads/foo/bar.md" }
//   Deletes a sidecar AND its companion binary (same dir, same stem). Guards:
//   path must be inside the vault AND inside _imports/ — we don't let this
//   endpoint wipe arbitrary vault files (that's a different operation with
//   different consequences). Returns the set of files deleted.
brainRouter.post("/discard", (req, res) => {
  if (!requireVault(res)) return;
  try {
    const rel = String(req.body?.path ?? "").trim().replace(/^\/+/, "");
    if (!rel) return res.status(400).json({ error: "path required" });
    // Whitelist — discard is only allowed under _imports/. Anything else
    // would let a caller delete the wrong file with a single POST. Promote /
    // archive cover the deliberate-move flows for other folders.
    if (!rel.startsWith("_imports/")) {
      return res.status(403).json({ error: "discard is restricted to files under _imports/" });
    }
    if (rel.split("/").some(seg => seg === "" || seg === "." || seg === "..")) {
      return res.status(400).json({ error: "invalid path" });
    }
    const full = resolve(config.vaultPath, rel);
    // Defence-in-depth — confirm the resolved path didn't escape the vault.
    const vaultRoot = resolve(config.vaultPath);
    if (!full.startsWith(vaultRoot + sep) && full !== vaultRoot) {
      return res.status(400).json({ error: "path escapes vault" });
    }
    const deleted: string[] = [];
    const { unlinkSync } = require("node:fs");
    // Delete the file itself.
    if (existsSync(full)) { unlinkSync(full); deleted.push(rel); }
    // If it's an .md sidecar, also delete the companion binary (same dir + stem).
    if (rel.endsWith(".md")) {
      const dir = join(full, "..");
      const stem = basename(full, ".md");
      const binaryExts = [".pdf", ".docx", ".xlsx", ".pptx", ".ppt", ".doc", ".xls", ".rtf", ".odt", ".ods", ".odp"];
      for (const ext of binaryExts) {
        const companion = join(dir, `${stem}${ext}`);
        if (existsSync(companion)) {
          unlinkSync(companion);
          deleted.push(relative(vaultRoot, companion).split(sep).join("/"));
        }
      }
    }
    res.json({ deleted, count: deleted.length });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? String(e) });
  }
});

// POST /api/brain/rebuild-index  — force a synchronous rebuild of the
// MiniSearch inverted index. Useful after bulk imports / external edits
// when you don't want to wait for the next search to trigger a lazy build.
brainRouter.post("/rebuild-index", async (_req, res) => {
  if (!requireVault(res)) return;
  try {
    const { existsSync: fsExistsSync, readdirSync: fsReaddirSync } = await import("node:fs");
    const exists = fsExistsSync(config.vaultPath);
    let entryCount = -1;
    try { entryCount = fsReaddirSync(config.vaultPath).length; } catch (e: any) { entryCount = -2; }
    const t0 = Date.now();
    await buildIndex(config.vaultPath);
    const stats = indexStats();
    res.json({
      ok: true,
      elapsedMs: Date.now() - t0,
      probe: { vaultPath: config.vaultPath, exists, entryCount },
      ...stats,
      buildInProgress: isBuildInProgress(),
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

// POST /api/brain/process-imports
//   Body: { folder?: "_imports" }  (default _imports, must be inside the vault)
//
// Walks the folder, finds every binary doc (.pdf/.docx/.xlsx/.pptx/etc.) that
// has a sibling .md sidecar, extracts its text via extractDocText, and APPENDS
// an `## Excerpt` block to the sidecar — but only if the sidecar doesn't
// already contain one. Idempotent: re-running skips files already processed.
//
// Background-runs as a Job so the caller doesn't block on what can be a
// minutes-long walk over hundreds of PDFs. Returns the jobId immediately;
// poll /api/templates/jobs/:id for progress.
brainRouter.post("/process-imports", (req, res) => {
  if (!requireVault(res)) return;
  const folderArg = String(req.body?.folder ?? "_imports").trim().replace(/^\/+|\/+$/g, "");
  // Path safety — the agent could pass "../etc/passwd" via this endpoint.
  if (folderArg.split("/").some(seg => seg === "" || seg === "." || seg === "..")) {
    return res.status(400).json({ error: "invalid folder" });
  }
  const root = resolve(config.vaultPath, folderArg);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return res.status(404).json({ error: `folder not found: ${folderArg}` });
  }

  const job = newJob("knowledge:process-imports");
  job.title = `Process imports in ${folderArg}`;
  job.inputs = { folder: folderArg };
  res.json({ jobId: job.id });

  void runJob(job, async (push, progress) => {
    const binaryExts = new Set([".pdf", ".docx", ".xlsx", ".pptx", ".ppt", ".doc", ".xls", ".rtf", ".odt", ".ods", ".odp"]);
    let scanned = 0, extracted = 0, skipped = 0, errors = 0;
    const errorDetail: string[] = [];

    // Recursive walk — no symlink traversal, no .git/.obsidian descent.
    function* walk(dir: string): Generator<string> {
      let entries: any[];
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith(".") || e.name === "node_modules") continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) yield* walk(full);
        else yield full;
      }
    }

    for (const full of walk(root)) {
      const ext = extname(full).toLowerCase();
      if (!binaryExts.has(ext)) continue;
      scanned += 1;
      // Sidecar = same dir, same stem, .md suffix.
      const stem = basename(full, ext);
      const sidecarPath = join(full, "..", `${stem}.md`);
      if (!existsSync(sidecarPath)) { skipped += 1; continue; }
      let sidecar: string;
      try { sidecar = readFileSync(sidecarPath, "utf8"); }
      catch (e: any) { errors += 1; errorDetail.push(`read sidecar ${sidecarPath}: ${e?.message ?? e}`); continue; }
      if (/^##\s+Excerpt\b/m.test(sidecar)) { skipped += 1; continue; }

      try {
        const ex = await extractDocText(full);
        const excerpt = (ex.text ?? "").slice(0, 6000).trim();
        if (!excerpt) { skipped += 1; continue; }
        const block = `\n\n## Excerpt (first ${excerpt.length.toLocaleString()} chars, ${ex.kind})${ex.pages ? ` — ${ex.pages} page${ex.pages === 1 ? "" : "s"}` : ""}\n\n${excerpt}\n${ex.truncated ? "\n_(text truncated by extractor)_\n" : ""}`;
        writeFileSync(sidecarPath, sidecar.trimEnd() + block, "utf8");
        extracted += 1;
        if (extracted % 25 === 0) {
          push(`extracted ${extracted}/${scanned}…`);
          progress({ scanned, extracted, skipped, errors });
        }
      } catch (e: any) {
        errors += 1;
        errorDetail.push(`${relative(root, full).split(sep).join("/")}: ${String(e?.message ?? e).slice(0, 120)}`);
      }
    }

    push(`done — scanned ${scanned}, extracted ${extracted}, skipped ${skipped}, errors ${errors}`);
    return {
      folder: folderArg,
      scanned, extracted, skipped, errors,
      errorDetail: errorDetail.slice(0, 20),
      answer: `Processed **${folderArg}** — extracted text into **${extracted}** sidecar${extracted === 1 ? "" : "s"} (${skipped} skipped, ${errors} error${errors === 1 ? "" : "s"}).`,
    };
  });
});

// Promote a fleeting note (typically in 0-Inbox/) to 2-Permanent/ as a proper
// Zettelkasten entry. Reads the original, rewrites frontmatter with a Zettel
// id + title, and writes it to 2-Permanent/. Optionally deletes the source.
//
// Body: { path: "0-Inbox/2026-05-curated-foo.md", title?: "...", tags?: "a,b",
//         keepOriginal?: false }
brainRouter.post("/promote", (req, res) => {
  try {
    const sourcePath = String(req.body?.path ?? "").trim();
    if (!sourcePath) return res.status(400).json({ error: "path required" });
    const overrideTitle = req.body?.title ? String(req.body.title) : undefined;
    const tags = String(req.body?.tags ?? "").split(",").map(t => t.trim()).filter(Boolean);
    const keepOriginal = req.body?.keepOriginal === true;

    const original = readVaultFile(sourcePath);
    // Strip leading frontmatter — we rewrite a fresh block on the promoted
    // note instead of layering on the curation/research frontmatter.
    const fmMatch = original.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const oldFm = fmMatch ? fmMatch[1] : "";
    const body = (fmMatch ? fmMatch[2] : original).trim();

    // Try to lift a title from old frontmatter; otherwise use the # heading
    // or fall back to the filename without timestamp.
    let title = overrideTitle;
    if (!title) {
      const fmTitle = oldFm.match(/^title:\s*"?([^"\n]+)"?$/m);
      if (fmTitle) title = fmTitle[1].replace(/^Curated:\s*|^Research:\s*/i, "").trim();
    }
    if (!title) {
      const headingMatch = body.match(/^#\s+(.+)$/m);
      if (headingMatch) title = headingMatch[1].trim();
    }
    if (!title) {
      title = basename(sourcePath, ".md").replace(/^\d+-?/, "").replace(/-/g, " ");
    }

    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "note";
    const targetPath = `2-Permanent/${stamp}-${slug}.md`;
    const today = new Date().toISOString().slice(0, 10);
    const tagsLine = tags.length > 0 ? `[${tags.join(", ")}]` : "[permanent]";
    const md = `---\nid: ${stamp}\ntitle: ${title}\ntags: ${tagsLine}\ncreated: ${today}\npromoted_from: ${sourcePath}\n---\n\n# ${title}\n\n${body.replace(/^#\s+.+$/m, "").trim()}\n`;

    writeVaultFile(targetPath, md);
    if (!keepOriginal) {
      const full = resolve(config.vaultPath, sourcePath);
      if (existsSync(full)) {
        const archived = resolve(config.vaultPath, sourcePath.replace(/^([^/]+)\//, "$1/_archived-"));
        try { renameSync(full, archived); } catch { /* tolerate */ }
      }
    }
    void enqueueVaultCommit(`neuroworks: promote — ${sourcePath} → ${targetPath}`);
    res.json({ promoted: true, from: sourcePath, to: targetPath, archived: !keepOriginal });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? String(e) });
  }
});
