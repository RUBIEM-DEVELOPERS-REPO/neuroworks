import { Router } from "express";
import { listKnowledgePacks, installKnowledgePack, getPackContent } from "../lib/knowledge-packs.js";

export const knowledgePacksRouter = Router();

knowledgePacksRouter.get("/", (_req, res) => {
  res.json({ packs: listKnowledgePacks() });
});

knowledgePacksRouter.post("/:sectorId/install", (req, res) => {
  const result = installKnowledgePack(req.params.sectorId);
  if (!result.ok) return res.status(404).json({ error: "Sector not found" });
  res.json(result);
});

knowledgePacksRouter.get("/:sectorId/:filename", (req, res) => {
  const content = getPackContent(req.params.sectorId, req.params.filename);
  if (!content) return res.status(404).json({ error: "File not found" });
  res.type("text/markdown").send(content);
});
