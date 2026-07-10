import { Router } from "express";
import { readFileSync, existsSync } from "node:fs";

export const skillForgeRouter = Router();

skillForgeRouter.post("/draft", async (req, res) => {
  const { intent, taskSample, failureReason } = req.body ?? {};
  if (!intent || !taskSample) return res.status(400).json({ error: "intent and taskSample are required" });
  try {
    const { draftSkillForIntent } = await import("../lib/skills.js");
    const skill = await draftSkillForIntent({ intent: String(intent), taskSample: String(taskSample), failureReason: failureReason ? String(failureReason) : undefined });
    if (!skill) return res.status(500).json({ error: "LLM produced an unusable draft" });
    const raw = readFileSync(skill.path, "utf8");
    res.json({ skill: { name: skill.name, description: skill.description, applies_to: skill.applies_to, body: skill.body }, raw });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e).slice(0, 300) });
  }
});

skillForgeRouter.post("/save", async (req, res) => {
  const { intent, raw } = req.body ?? {};
  if (!intent || !raw) return res.status(400).json({ error: "intent and raw markdown are required" });
  try {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join, dirname, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const SKILLS_USER = resolve(__dirname, "../skills/_user");
    mkdirSync(SKILLS_USER, { recursive: true });
    const filename = `${String(intent).toLowerCase().replace(/[^a-z0-9-]+/g, "-")}.md`;
    const dest = join(SKILLS_USER, filename);
    writeFileSync(dest, String(raw), "utf8");
    const { loadSkill } = await import("../lib/skills.js");
    const skill = loadSkill(String(intent));
    res.json({ ok: true, path: dest, skill: skill ? { name: skill.name, description: skill.description, applies_to: skill.applies_to } : undefined });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e).slice(0, 300) });
  }
});
