import { Router } from "express";
import { config } from "../config.js";
import { pollPeers, localInflightCount } from "../lib/peers.js";

export const peersRouter = Router();

// Self-introspection: who am I, what model, how busy. Other clawbots poll this
// to make delegation decisions, and the UI uses it for the topbar peer roll-call.
peersRouter.get("/self", (_req, res) => {
  res.json({
    name: config.name,
    model: config.ollamaModel,
    port: config.port,
    ready: config.ready,
    inflightJobs: localInflightCount(),
    peers: config.peers,
  });
});

// Roll-call across all configured peers. Returns one entry per peer with health
// + busy state so the UI can render "primary (busy) · secondary (idle)".
peersRouter.get("/", async (_req, res) => {
  const self = {
    url: `http://127.0.0.1:${config.port}`,
    name: config.name,
    model: config.ollamaModel,
    ok: true,
    ready: config.ready,
    inflightJobs: localInflightCount(),
    rttMs: 0,
  };
  const peers = await pollPeers();
  res.json({ self, peers });
});
