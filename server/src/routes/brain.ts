import { Router } from "express";
import { listVault, readVaultFile, searchVault } from "../lib/vault.js";

export const brainRouter = Router();

brainRouter.get("/tree", (req, res) => {
  const path = String(req.query.path ?? "");
  try { res.json({ path, entries: listVault(path) }); }
  catch (e: any) { res.status(400).json({ error: e.message }); }
});

brainRouter.get("/file", (req, res) => {
  const path = String(req.query.path ?? "");
  if (!path) return res.status(400).json({ error: "path required" });
  try { res.json({ path, content: readVaultFile(path) }); }
  catch (e: any) { res.status(400).json({ error: e.message }); }
});

brainRouter.get("/search", (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) return res.json({ q, results: [] });
  res.json({ q, results: searchVault(q) });
});

brainRouter.get("/digest/latest", (req, res) => {
  try { res.json({ content: readVaultFile("_clawbot/latest.md") }); }
  catch (e: any) { res.status(404).json({ error: e.message }); }
});
