import { Router } from "express";
import { existsSync, unlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import {
  listGovernance, loadGovernancePrefix, invalidateGovernanceCache,
  getConstraints, updateConstraint, extractConstraints, checkActionAgainstConstraints,
} from "../lib/governance.js";

export const governanceRouter = Router();

// List active governance policies. Lightweight metadata only; the page
// fetches body content on demand.
governanceRouter.get("/", (_req, res) => {
  const policies = listGovernance();
  const prefix = loadGovernancePrefix();
  res.json({
    policies,
    prefixBytes: prefix.length,
    prefixActive: prefix.length > 0,
  });
});

// Get the full body of one policy for editing/preview.
governanceRouter.get("/:name", (req, res) => {
  const name = String(req.params.name);
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return res.status(400).json({ error: "invalid policy name" });
  const path = join(config.vaultPath, "_governance", `${name}.md`);
  if (!existsSync(path)) return res.status(404).json({ error: "not found" });
  try {
    res.json({ name, path: `_governance/${name}.md`, body: readFileSync(path, "utf8") });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

// Download a policy as a file (Content-Disposition: attachment). Distinct path
// segment from GET /:name so it isn't captured as a name.
governanceRouter.get("/:name/download", (req, res) => {
  const name = String(req.params.name);
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return res.status(400).json({ error: "invalid policy name" });
  const path = join(config.vaultPath, "_governance", `${name}.md`);
  if (!existsSync(path)) return res.status(404).json({ error: "not found" });
  try {
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${name}.md"`);
    res.send(readFileSync(path, "utf8"));
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

// Delete a policy. The upload flow uses the existing /api/uploads endpoint
// with target=vault and vaultFolder=_governance, so we only need delete here.
governanceRouter.delete("/:name", (req, res) => {
  const name = String(req.params.name);
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return res.status(400).json({ error: "invalid policy name" });
  const path = join(config.vaultPath, "_governance", `${name}.md`);
  if (!existsSync(path)) return res.status(404).json({ error: "not found" });
  try {
    unlinkSync(path);
    invalidateGovernanceCache();
    res.json({ ok: true, deleted: name });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

// Bust the cache after an upload. The /api/uploads route doesn't know
// about governance, so the page calls this explicitly post-upload to make
// sure the next general-task picks up the new policy.
governanceRouter.post("/invalidate", (_req, res) => {
  invalidateGovernanceCache();
  res.json({ ok: true });
});

// ─── Constraint extraction & review ───

// GET /api/governance/constraints — all constraints, optional ?policy= filter.
governanceRouter.get("/constraints", (req, res) => {
  const policyName = req.query.policy ? String(req.query.policy) : undefined;
  const data = getConstraints(policyName);
  res.json(data);
});

// POST /api/governance/:name/extract — run LLM extraction on a policy.
governanceRouter.post("/:name/extract", async (req, res) => {
  const name = String(req.params.name);
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return res.status(400).json({ error: "invalid policy name" });
  try {
    const constraints = await extractConstraints(name);
    res.json({ policyName: name, constraints, count: constraints.length });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

// PUT /api/governance/:name/constraints/:constraintId — review/accept/reject.
governanceRouter.put("/:name/constraints/:constraintId", (req, res) => {
  const name = String(req.params.name);
  const id = String(req.params.constraintId);
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return res.status(400).json({ error: "invalid policy name" });
  const { reviewed, accepted, severity, rule, details, category } = req.body ?? {};
  const updated = updateConstraint(name, id, { reviewed, accepted, severity, rule, details, category });
  if (!updated) return res.status(404).json({ error: "constraint not found" });
  res.json({ constraint: updated });
});

// POST /api/governance/check-action — HITL gate: check an action against constraints.
governanceRouter.post("/check-action", (req, res) => {
  const { action, policy } = req.body ?? {};
  if (!action) return res.status(400).json({ error: "action (string) is required" });
  const data = getConstraints(policy ? String(policy) : undefined);
  const allReviewed = data.constraints.filter(c => c.reviewed && c.accepted);
  const violations = checkActionAgainstConstraints(String(action), allReviewed);
  res.json({
    action: String(action),
    violations,
    constrained: violations.length > 0,
    summary: violations.length > 0
      ? `This action may violate ${violations.length} constraint${violations.length === 1 ? "" : "s"}: ${violations.map(v => v.violated[0].rule).join("; ")}`
      : "No constraint violations detected",
  });
});
