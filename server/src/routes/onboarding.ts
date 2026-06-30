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
    })),
  });
});

// PUT /api/onboarding — update onboarding state.
onboardingRouter.put("/", (req, res) => {
  const { completed, sector, language, orgName } = req.body ?? {};
  if (typeof completed !== "boolean") {
    return res.status(400).json({ error: "completed (boolean) is required" });
  }
  if (language && !["en", "sn", "nd"].includes(language)) {
    return res.status(400).json({ error: "language must be en, sn, or nd" });
  }
  const state = setOnboardingState({
    completed,
    sector: sector ? String(sector) : undefined,
    language: language ?? undefined,
    orgName: orgName ? String(orgName) : undefined,
  });
  res.json({ state });
});

// GET /api/onboarding/context — return sector-specific context note.
onboardingRouter.get("/context", (req, res) => {
  const sectorId = req.query.sector ? String(req.query.sector) : getOnboardingState().sector;
  if (!sectorId) return res.json({ context: "" });
  const context = getSectorContext(sectorId);
  res.json({ sector: sectorId, context });
});
