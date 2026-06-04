import { Router } from "express";
import {
  listSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  nextFireAt,
  type Cadence,
} from "../lib/schedules.js";

export const schedulesRouter = Router();

function validateCadence(c: any): { ok: true; cadence: Cadence } | { ok: false; error: string } {
  if (!c || typeof c !== "object") return { ok: false, error: "cadence is required" };
  const hour = Number(c.hour);
  const minute = Number(c.minute);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { ok: false, error: "cadence.hour must be 0..23" };
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return { ok: false, error: "cadence.minute must be 0..59" };
  const daysOfWeek = Array.isArray(c.daysOfWeek)
    ? c.daysOfWeek.filter((d: any) => Number.isInteger(d) && d >= 0 && d <= 6)
    : [];
  return { ok: true, cadence: { daysOfWeek, hour, minute } };
}

// List all schedules with next-fire times annotated.
schedulesRouter.get("/", (_req, res) => {
  const now = new Date();
  const enriched = listSchedules().map(s => ({
    ...s,
    nextFireAt: s.enabled ? nextFireAt(s.cadence, new Date(s.lastFiredAt ?? s.createdAt) > now ? new Date(s.lastFiredAt ?? s.createdAt) : now) : null,
  }));
  res.json({ schedules: enriched });
});

schedulesRouter.get("/:id", (req, res) => {
  const s = getSchedule(req.params.id);
  if (!s) return res.status(404).json({ error: "not found" });
  res.json({ schedule: { ...s, nextFireAt: s.enabled ? nextFireAt(s.cadence) : null } });
});

// Create a schedule. Body: { name, templateId, inputs?, cadence: {daysOfWeek, hour, minute}, enabled? }
schedulesRouter.post("/", (req, res) => {
  const { name, templateId, inputs, cadence: rawCadence, enabled } = req.body ?? {};
  if (!name || typeof name !== "string") return res.status(400).json({ error: "name is required" });
  if (!templateId || typeof templateId !== "string") return res.status(400).json({ error: "templateId is required" });
  const v = validateCadence(rawCadence);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const fresh = createSchedule({
    name: name.trim(),
    templateId,
    inputs: inputs && typeof inputs === "object" ? inputs : {},
    cadence: v.cadence,
    enabled: enabled === false ? false : true,
  });
  res.json({ schedule: fresh });
});

// Patch a schedule (rename, change cadence, toggle enabled, swap inputs).
schedulesRouter.patch("/:id", (req, res) => {
  const existing = getSchedule(req.params.id);
  if (!existing) return res.status(404).json({ error: "not found" });
  const patch: any = {};
  if (typeof req.body?.name === "string") patch.name = req.body.name.trim();
  if (typeof req.body?.templateId === "string") patch.templateId = req.body.templateId;
  if (req.body?.inputs && typeof req.body.inputs === "object") patch.inputs = req.body.inputs;
  if (req.body?.cadence) {
    const v = validateCadence(req.body.cadence);
    if (!v.ok) return res.status(400).json({ error: v.error });
    patch.cadence = v.cadence;
  }
  if (typeof req.body?.enabled === "boolean") patch.enabled = req.body.enabled;
  const updated = updateSchedule(req.params.id, patch);
  if (!updated) return res.status(404).json({ error: "not found" });
  res.json({ schedule: updated });
});

schedulesRouter.delete("/:id", (req, res) => {
  const ok = deleteSchedule(req.params.id);
  if (!ok) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
});
