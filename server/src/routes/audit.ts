import { Router } from "express";
import { queryAudit } from "../lib/audit-log.js";

export const auditRouter = Router();

auditRouter.get("/", (req, res) => {
  const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 50;
  const offset = typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) : 0;
  const level = typeof req.query.level === "string" ? req.query.level : undefined;
  const actor = typeof req.query.actor === "string" ? req.query.actor : undefined;
  const action = typeof req.query.action === "string" ? req.query.action : undefined;
  const since = typeof req.query.since === "string" ? req.query.since : undefined;
  const jobId = typeof req.query.jobId === "string" ? req.query.jobId : undefined;
  res.json(queryAudit({ limit, offset, level, actor, action, since, jobId }));
});
