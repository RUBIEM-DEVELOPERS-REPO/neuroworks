import express from "express";
import { config } from "./config.js";
import { statusRouter } from "./routes/status.js";
import { reposRouter } from "./routes/repos.js";
import { brainRouter } from "./routes/brain.js";
import { tasksRouter } from "./routes/tasks.js";
import { templatesRouter } from "./routes/templates.js";
import { chatRouter } from "./routes/chat.js";
import { personasRouter } from "./routes/personas.js";
import { peersRouter } from "./routes/peers.js";
import { localInflightCount } from "./lib/peers.js";
import { modelsRouter } from "./routes/models.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:7470");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  next();
});
app.options("*", (_req, res) => res.sendStatus(204));

app.get("/api/health", (_req, res) => res.json({
  ok: true,
  name: config.name,
  version: "0.1.0",
  model: config.ollamaModel,
  port: config.port,
  ready: config.ready,
  missing: config.missing,
  inflightJobs: localInflightCount(),
  peers: config.peers,
}));
app.use("/api/status", statusRouter);
app.use("/api/repos", reposRouter);
app.use("/api/brain", brainRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/templates", templatesRouter);
app.use("/api/chat", chatRouter);
app.use("/api/personas", personasRouter);
app.use("/api/peers", peersRouter);
app.use("/api/models", modelsRouter);

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error(err);
  res.status(500).json({ error: err.message ?? String(err) });
});

app.listen(config.port, "127.0.0.1", () => {
  console.log(`\n  ▶ neuroworks server: http://127.0.0.1:${config.port}`);
  console.log(`    web ui will open at: http://127.0.0.1:7470`);
  console.log(`    vault:  ${config.vaultPath}`);
  console.log(`    ollama: ${config.ollamaHost} (${config.ollamaModel})\n`);
});
