import express from "express";
import { config } from "./config.js";
import { statusRouter } from "./routes/status.js";
import { reposRouter } from "./routes/repos.js";
import { brainRouter } from "./routes/brain.js";
import { tasksRouter } from "./routes/tasks.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:5173");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  next();
});
app.options("*", (_req, res) => res.sendStatus(204));

app.get("/api/health", (_req, res) => res.json({ ok: true, name: "neuroworks", version: "0.1.0" }));
app.use("/api/status", statusRouter);
app.use("/api/repos", reposRouter);
app.use("/api/brain", brainRouter);
app.use("/api/tasks", tasksRouter);

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error(err);
  res.status(500).json({ error: err.message ?? String(err) });
});

app.listen(config.port, "127.0.0.1", () => {
  console.log(`neuroworks server listening on http://127.0.0.1:${config.port}`);
  console.log(`  vault: ${config.vaultPath}`);
  console.log(`  ollama: ${config.ollamaHost} (${config.ollamaModel})`);
});
