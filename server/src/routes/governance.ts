import { Router } from "express";
import { existsSync, unlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { listGovernance, loadGovernancePrefix, invalidateGovernanceCache } from "../lib/governance.js";

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
