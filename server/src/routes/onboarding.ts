import { Router } from "express";
import { SECTORS, getOnboardingState, setOnboardingState, getSectorContext } from "../lib/sector-packs.js";

export const onboardingRouter = Router();

// GET /api/onboarding — return current state + sectors catalog.
onboardingRouter.get("/", (_req, res) => {
  const state = getOnboardingState();
  res.json({
    state,
    sectors: SECTORS.map(s => ({
      id: s.id, name: s.name, nameShona: s.nameShona, nameNdebele: s.nameNdebele,
      description: s.description, icon: s.icon,
      suggestedDepartments: s.suggestedDepartments, suggestedIntegrations: s.suggestedIntegrations,
    })),
  });
});

// PUT /api/onboarding — update onboarding state. `completed` is always
// required (the wizard's own contract), everything else is a TRUE partial
// patch — a field only changes if the caller actually sent it. This matters
// now that Settings.tsx can PUT just {completed:true, language:"sn"} to
// change language alone: naively defaulting omitted fields to `undefined`
// and spreading them into the saved state would silently wipe the
// previously chosen sector/orgName on every such call.
onboardingRouter.put("/", (req, res) => {
  const body = req.body ?? {};
  if (typeof body.completed !== "boolean") {
    return res.status(400).json({ error: "completed (boolean) is required" });
  }
  if (body.language !== undefined && !["en", "sn", "nd"].includes(body.language)) {
    return res.status(400).json({ error: "language must be en, sn, or nd" });
  }
  const patch: Partial<import("../lib/sector-packs.js").OnboardingState> & { completed: boolean } = { completed: body.completed };
  if (body.sector !== undefined) patch.sector = String(body.sector);
  if (body.language !== undefined) patch.language = body.language;
  if (body.orgName !== undefined) patch.orgName = String(body.orgName);
  // customSectorName only makes sense alongside sector "custom" — sent with
  // a non-custom sector (or with sector omitted while a custom one is
  // already active) it's ignored rather than silently persisted as stale.
  if (body.customSectorName !== undefined && (body.sector === "custom" || (body.sector === undefined && getOnboardingState().sector === "custom"))) {
    patch.customSectorName = String(body.customSectorName).slice(0, 100);
  }
  const state = setOnboardingState(patch);
  res.json({ state });
});

// GET /api/onboarding/context — return sector-specific context note.
onboardingRouter.get("/context", (req, res) => {
  const sectorId = req.query.sector ? String(req.query.sector) : getOnboardingState().sector;
  if (!sectorId) return res.json({ context: "" });
  const context = getSectorContext(sectorId);
  res.json({ sector: sectorId, context });
});
