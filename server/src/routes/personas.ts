import { Router } from "express";
import { addPersona, deletePersona, extractPersonaMetadata, getActivePersona, loadPersonas, setActivePersona, slugifyId, updatePersona, type Persona } from "../lib/personas.js";
import { journal } from "../lib/journal.js";
import { buildStarterTemplates, refreshPersonaTemplates, purgePersonaTemplates, listPersonaTemplates } from "../lib/persona-templates.js";
import { saveCustomTemplate } from "../lib/custom-templates.js";

export const personasRouter = Router();

personasRouter.get("/", (_req, res) => {
  const s = loadPersonas();
  res.json({ personas: s.personas, activeId: s.activeId, active: getActivePersona() });
});

personasRouter.post("/", async (req, res) => {
  const { name, jobDescription, tone, role, description, responsibilities, systemPromptOverride, workMode } = (req.body ?? {}) as Partial<Persona>;
  if (!name || !String(name).trim()) return res.status(400).json({ error: "name required" });
  if (!jobDescription || !String(jobDescription).trim()) return res.status(400).json({ error: "jobDescription required" });
  let meta = { role: role ?? "Specialist", description: description ?? "", tone: tone ?? "professional", responsibilities: responsibilities ?? [] };
  if (!role || !description || !responsibilities || responsibilities.length === 0) {
    try { meta = { ...meta, ...(await extractPersonaMetadata(String(jobDescription))) }; }
    catch (e: any) { /* keep heuristic defaults */ void e; }
  }
  const persona: Persona = {
    id: slugifyId(String(name)),
    name: String(name).trim(),
    role: meta.role,
    description: meta.description,
    jobDescription: String(jobDescription),
    tone: meta.tone,
    responsibilities: meta.responsibilities,
    systemPromptOverride: systemPromptOverride ? String(systemPromptOverride) : undefined,
    workMode: (["agent", "hybrid", "human"] as const).includes(workMode as any) ? workMode : undefined,
    createdAt: new Date().toISOString(),
  };
  addPersona(persona);
  // Generate starter templates so the dashboard immediately reflects the
  // role's day-to-day work. Built-in personas (researcher, etc.) get
  // curated templates with pre-baked plans; everyone else gets one
  // template per responsibility, re-planned on each run.
  const generated = buildStarterTemplates(persona);
  for (const t of generated) saveCustomTemplate(t);
  void journal({
    kind: "persona",
    slug: persona.id,
    title: `${persona.name} — ${persona.role}`,
    frontmatter: { personaId: persona.id, role: persona.role, tone: persona.tone, generatedTemplates: generated.length },
    body: [
      `**Role:** ${persona.role}`,
      persona.description ? `\n${persona.description}\n` : "",
      `**Tone:** ${persona.tone}`,
      persona.responsibilities.length ? `\n## Responsibilities\n${persona.responsibilities.map(r => `- ${r}`).join("\n")}\n` : "",
      generated.length ? `\n## Starter templates generated\n${generated.map(g => `- \`${g.id}\` — ${g.title}`).join("\n")}\n` : "",
      `## Job description (raw)\n\n${persona.jobDescription}`,
    ].join("\n"),
  });
  res.json({ persona, generatedTemplateIds: generated.map(g => g.id) });
});

// Patch an existing hire — primarily the work mode (agent / hybrid / human),
// plus tone/description tweaks from the Workforce page.
personasRouter.patch("/:id", (req, res) => {
  const p = updatePersona(String(req.params.id), req.body ?? {});
  if (!p) return res.status(404).json({ error: "persona not found" });
  res.json({ persona: p });
});

// generateStarterTemplates → moved to lib/persona-templates.ts so the same
// builder can be invoked from the built-in seed path AND the refresh endpoint.

// Refresh persona-derived templates from current responsibilities. Useful
// after editing a persona's JD outside the create flow, or for built-ins to
// pick up newly-curated templates after a code change. Keeps runCount on
// templates whose id is unchanged.
personasRouter.post("/:id/refresh-templates", (req, res) => {
  const s = loadPersonas();
  const persona = s.personas.find(p => p.id === req.params.id);
  if (!persona) return res.status(404).json({ error: "persona not found" });
  const result = refreshPersonaTemplates(persona);
  res.json({ persona: persona.id, ...result });
});

// Inspect which custom templates belong to this persona. Used by the UI to
// show a count badge on each persona card.
personasRouter.get("/:id/templates", (req, res) => {
  const s = loadPersonas();
  const persona = s.personas.find(p => p.id === req.params.id);
  if (!persona) return res.status(404).json({ error: "persona not found" });
  res.json({ templates: listPersonaTemplates(persona.id) });
});

personasRouter.post("/:id/activate", (req, res) => {
  try {
    const active = setActivePersona(req.params.id === "default" ? null : req.params.id);
    res.json({ active });
  } catch (e: any) {
    res.status(404).json({ error: e.message });
  }
});

personasRouter.post("/deactivate", (_req, res) => {
  setActivePersona(null);
  res.json({ active: null });
});

personasRouter.delete("/:id", (req, res) => {
  // Persona-derived templates are owned by the persona — when the persona
  // goes, the templates go with it. The user can always create new ones.
  const removed = purgePersonaTemplates(req.params.id);
  const ok = deletePersona(req.params.id);
  if (!ok) return res.status(404).json({ error: "not found" });
  res.json({ deleted: true, removedTemplates: removed });
});

personasRouter.post("/preview", async (req, res) => {
  const jd = String(req.body?.jobDescription ?? "");
  if (!jd.trim()) return res.status(400).json({ error: "jobDescription required" });
  try {
    const meta = await extractPersonaMetadata(jd);
    res.json(meta);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
