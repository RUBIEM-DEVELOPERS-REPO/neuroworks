import { Router } from "express";
import { addPersona, deletePersona, extractPersonaMetadata, getActivePersona, loadPersonas, setActivePersona, slugifyId, type Persona } from "../lib/personas.js";

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
  res.json({ persona });
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
