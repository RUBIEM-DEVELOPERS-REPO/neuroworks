import { Router } from "express";
import { existsSync, renameSync } from "node:fs";
import { resolve, basename } from "node:path";
import { listVault, readVaultFile, searchVault, writeVaultFile, getVaultHealth } from "../lib/vault.js";
import { enqueueVaultCommit } from "../lib/commit-queue.js";
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
