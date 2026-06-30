import { Router } from "express";
import { listDepartmentTemplates, getDepartmentTemplate, applyDepartmentTemplate } from "../lib/department-templates.js";
import { addPersona, slugifyId } from "../lib/personas.js";

export const departmentsRouter = Router();

// GET /api/departments — list all available department templates.
departmentsRouter.get("/", (_req, res) => {
  const templates = listDepartmentTemplates();
  res.json({
    departments: templates.map(d => ({
      id: d.id, name: d.name, tagline: d.tagline,
      description: d.description, icon: d.icon, color: d.color,
      agentCount: d.agents.length,
      integrationCount: d.recommendedIntegrations.length,
      hasSchedule: !!d.schedule,
      workflowSteps: d.workflow.length,
    })),
  });
});

// GET /api/departments/:id — detailed view of one department template.
departmentsRouter.get("/:id", (req, res) => {
  const tpl = getDepartmentTemplate(req.params.id);
  if (!tpl) return res.status(404).json({ error: "department template not found" });
  res.json({ department: tpl });
});

// POST /api/departments/:id/apply — deploy a department template.
// Creates the persona(s) listed in the template so the operator can
// immediately start hiring workers for this department.
departmentsRouter.post("/:id/apply", async (req, res) => {
  try {
    const tpl = getDepartmentTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ error: "department template not found" });

    const created: { name: string; role: string; id: string }[] = [];
    for (const agent of tpl.agents) {
      const persona: import("../lib/personas.js").Persona = {
        id: slugifyId(agent.name),
        name: agent.name,
        role: agent.role,
        description: `Part of the ${tpl.name} department`,
        jobDescription: agent.jobDescription,
        tone: agent.tone ?? "professional",
        responsibilities: tpl.workflow.filter(w => w.persona === agent.name).map(w => w.task),
        createdAt: new Date().toISOString(),
      };
      addPersona(persona);
      created.push({ name: persona.name, role: persona.role, id: persona.id });
    }

    res.json({
      department: tpl.id,
      departmentName: tpl.name,
      personas: created,
      recommendedIntegrations: tpl.recommendedIntegrations,
      recommendedTemplates: tpl.recommendedTemplates,
      workflow: tpl.workflow,
      schedule: tpl.schedule ?? null,
      message: `Deployed "${tpl.name}" — ${created.length} agent${created.length === 1 ? "" : "s"} created. Head to the Team page to activate and assign them.`,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});
