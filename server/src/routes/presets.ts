import { Router } from "express";
import { listPresets, getPreset, applyPreset } from "../lib/presets.js";

// Role Presets API — list the curated one-click worker bundles and apply one.
// Applying activates the persona, ensures its templates, optionally stands up
// schedules (with email delivery), and reports which integrations to connect.

export const presetsRouter = Router();

presetsRouter.get("/", (_req, res) => res.json({ presets: listPresets() }));

presetsRouter.get("/:id", (req, res) => {
  const p = getPreset(req.params.id);
  if (!p) return res.status(404).json({ error: "preset not found" });
  res.json({ preset: p });
});

// Apply a preset. Body: { deliverEmail?: string, createSchedules?: boolean }
presetsRouter.post("/:id/apply", async (req, res) => {
  try {
    const deliverEmail = typeof req.body?.deliverEmail === "string" ? req.body.deliverEmail.trim() : undefined;
    const createSchedules = req.body?.createSchedules === false ? false : true;
    const result = await applyPreset(req.params.id, { deliverEmail: deliverEmail || undefined, createSchedules });
    res.json(result);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    res.status(/unknown preset|missing persona/.test(msg) ? 404 : 500).json({ error: msg });
  }
});
