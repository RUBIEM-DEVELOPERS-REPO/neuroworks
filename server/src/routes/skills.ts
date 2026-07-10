// Read-only catalog endpoints for the skill library.
//
// Why: the agent loads 40+ skill .md playbooks at runtime, but nothing
// in the UI today lets a customer browse them. They show up in synth
// system prompts, in the auto-draft trigger, in the reflection's
// per-skill correlations — but the customer can't see "here's what
// my AI workforce knows how to do" without grepping the repo. This
// endpoint exposes the catalog so the Templates page (and any future
// admin view) can render it.
//
// Two endpoints:
//   GET /api/skills         — slim catalog (name, description, source,
//                             applies_to). Body is omitted; that's
//                             4000+ characters per skill and the index
//                             view doesn't need it.
//   GET /api/skills/:name   — full skill, body included, for the
//                             expanded "click to read playbook" view.

import { Router } from "express";
import { listSkills, loadSkill } from "../lib/skills.js";

export const skillsRouter = Router();

skillsRouter.get("/", (_req, res) => {
  const all = listSkills();
  // Sort: built-ins first (alphabetical), user/custom skills second.
  // Within each group, alphabetical by name for predictable rendering.
  const sorted = [...all].sort((a, b) => {
    if (a.source !== b.source) {
      const order: Record<string, number> = { builtin: 0, user: 1, remote: 2 };
      return (order[a.source] ?? 9) - (order[b.source] ?? 9);
    }
    return a.name.localeCompare(b.name);
  });
  res.json({
    count: sorted.length,
    skills: sorted.map(s => ({
      name: s.name,
      description: s.description,
      source: s.source,
      applies_to: s.applies_to,
      bodyChars: s.body.length,
    })),
  });
});

skillsRouter.get("/:name", (req, res) => {
  const skill = loadSkill(req.params.name);
  if (!skill) {
    res.status(404).json({ error: "skill_not_found", name: req.params.name });
    return;
  }
  res.json({
    name: skill.name,
    description: skill.description,
    source: skill.source,
    applies_to: skill.applies_to,
    path: skill.path,
    body: skill.body,
  });
});
