import { Router } from "express";
import { addPersona, deletePersona, extractPersonaMetadata, getActivePersona, loadPersonas, setActivePersona, slugifyId, type Persona } from "../lib/personas.js";
import { journal } from "../lib/journal.js";
import { saveCustomTemplate, slugify, type CustomTemplate } from "../lib/custom-templates.js";

export const personasRouter = Router();

personasRouter.get("/", (_req, res) => {
  const s = loadPersonas();
  res.json({ personas: s.personas, activeId: s.activeId, active: getActivePersona() });
});

personasRouter.post("/", async (req, res) => {
  const { name, jobDescription, tone, role, description, responsibilities, systemPromptOverride } = (req.body ?? {}) as Partial<Persona>;
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
    createdAt: new Date().toISOString(),
  };
  addPersona(persona);
  // Generate starter templates from the persona's responsibilities so the dashboard
  // immediately reflects the role's day-to-day work. Each responsibility becomes a
  // one-step `general-task` template the user can re-run with a click.
  const generated = generateStarterTemplates(persona);
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

function generateStarterTemplates(persona: Persona): CustomTemplate[] {
  const out: CustomTemplate[] = [];
  for (const resp of persona.responsibilities.slice(0, 5)) {
    const task = `As a ${persona.role}, ${resp.toLowerCase().replace(/\.$/, "")}.`;
    const id = `custom-${persona.id}-${slugify(resp).slice(0, 40)}`;
    out.push({
      id,
      role: "Custom",
      title: resp.length > 80 ? resp.slice(0, 77) + "…" : resp,
      description: `Persona-derived starter task for "${persona.name}".`,
      origin: { task, createdAt: new Date().toISOString() },
      // Empty plan — running this template re-plans against the persona system suffix
      // each time, so the LLM stays in the persona role for execution.
      plan: { steps: [], summary: undefined, waves: [] },
      runCount: 0,
    });
  }
  return out;
}

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
  const ok = deletePersona(req.params.id);
  if (!ok) return res.status(404).json({ error: "not found" });
  res.json({ deleted: true });
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
