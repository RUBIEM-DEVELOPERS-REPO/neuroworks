import { Router } from "express";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";
import { runReflection, lastReflection } from "../lib/reflection.js";

export const reflectionRouter = Router();

const REFLECTION_DIR_REL = "_neuroworks/reflections";

// List past reflections found in the vault. Each entry has the date + path,
// and we pull the first 240 chars of the body as a preview so the UI can
// render a card list without fetching each file.
reflectionRouter.get("/", (_req, res) => {
  try {
    const root = resolve(config.vaultPath, REFLECTION_DIR_REL);
    if (!existsSync(root)) return res.json({ reflections: [] });
    const files = readdirSync(root).filter(f => f.endsWith(".md")).sort().reverse();
    const reflections = files.slice(0, 30).map(f => {
      const date = f.replace(/\.md$/, "");
      let preview = "";
      let stats: any = undefined;
      try {
        const body = readFileSync(resolve(root, f), "utf8");
        // Strip frontmatter for preview
        const stripped = body.replace(/^---[\s\S]*?---\n+/, "");
        // Pull the "## What went well" section if present, else first 240 chars
        const m = stripped.match(/##\s+What went well[\s\S]+?(?=\n##|\n---|$)/i);
        preview = (m ? m[0] : stripped).replace(/^#+\s+.*$/gm, "").replace(/\s+/g, " ").trim().slice(0, 240);
        const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
        if (fmMatch) {
          const fm: any = {};
          for (const line of fmMatch[1].split("\n")) {
            const colon = line.indexOf(":");
            if (colon > 0) fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
          }
          stats = fm;
        }
      } catch { /* tolerate */ }
      return { date, path: `${REFLECTION_DIR_REL}/${f}`, preview, stats };
    });
    res.json({ reflections, last: lastReflection() });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

// Trigger a reflection on demand. Accepts optional `windowHours` (default 24)
// for backfills / catch-up. Returns the full result so the UI can render
// without a refetch.
reflectionRouter.post("/run", async (req, res) => {
  try {
    const windowHours = Number(req.body?.windowHours ?? 24);
    const r = await runReflection({ windowHours });
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

// Get the full markdown body for a specific reflection date.
reflectionRouter.get("/:date", (req, res) => {
  try {
    const date = String(req.params.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "date must be YYYY-MM-DD" });
    }
    const path = resolve(config.vaultPath, REFLECTION_DIR_REL, `${date}.md`);
    if (!existsSync(path)) return res.status(404).json({ error: "not found" });
    res.json({ date, path: `${REFLECTION_DIR_REL}/${date}.md`, body: readFileSync(path, "utf8") });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});
