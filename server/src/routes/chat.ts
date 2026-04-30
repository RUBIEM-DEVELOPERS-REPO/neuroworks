import { Router } from "express";
import { ollamaGenerate } from "../lib/ollama.js";
import { templates } from "../lib/templates.js";
import { newJob, runJob } from "../lib/jobs.js";
import { config } from "../config.js";
import { searchVault } from "../lib/vault.js";

export const chatRouter = Router();

type ChatMessage = { role: "user" | "assistant" | "system"; content: string; jobId?: string; templateId?: string };

// Regex-based action routing. More forgiving than substring matching — handles
// articles ("add a note"), question-style ("can you summarize…"), and synonyms.
const ACTION_PATTERNS: { re: RegExp; templateId: string }[] = [
  { re: /\b(?:sync|mirror|copy|pull)\s+(?:my\s+)?downloads?\b/i, templateId: "sync-downloads" },
  { re: /\b(?:add|save|capture|create|drop|jot(?:\s+down)?|note)\s+(?:a\s+|an\s+|the\s+|new\s+)?note\b/i, templateId: "add-note" },
  { re: /^\s*note\s+that\b/i, templateId: "add-note" },
  { re: /\b(?:run|trigger|kick\s+off|start|do)\s+(?:the\s+)?(?:daily\s+)?digest\b/i, templateId: "run-digest" },
  { re: /\bdigest(?:\s+(?:scan|run))?\s+(?:my\s+)?(?:repos?|projects?|github)/i, templateId: "run-digest" },
  { re: /\b(?:summari[sz]e|summary\s+of|recap|tldr|brief\s+me\s+on)\s+/i, templateId: "summarize-repo" },
  { re: /\b(?:publish|push|upload|create\s+(?:a\s+)?repo\s+from)\s+(?:the\s+)?folder\b/i, templateId: "publish-folder" },
  { re: /\b(?:publish|upload)\s+["'`]?[a-zA-Z]:[\\/]/i, templateId: "publish-folder" },
  { re: /\b(?:search|find|look\s*up|look\s+for|hunt|grep)\s+(?:my\s+|the\s+)?(?:notes?|vault|brain|knowledge|second\s+brain)\b/i, templateId: "search-brain" },
  { re: /\b(?:what\s+do\s+I\s+know\s+about|do\s+I\s+have\s+(?:any\s+)?notes?\s+(?:about|on))\b/i, templateId: "search-brain" },
  { re: /\b(?:browse|open|show)\s+(?:my\s+)?vault\b/i, templateId: "browse-vault" },
];

chatRouter.post("/", async (req, res) => {
  const messages = (req.body?.messages ?? []) as ChatMessage[];
  if (messages.length === 0) return res.status(400).json({ error: "messages required" });
  const last = messages[messages.length - 1];
  if (last.role !== "user" || !last.content?.trim()) return res.status(400).json({ error: "last message must be a non-empty user turn" });
  const text = last.content.trim();

  // 1. Try regex-based action routing — fastest, deterministic
  let templateId: string | null = null;
  for (const p of ACTION_PATTERNS) {
    if (p.re.test(text)) { templateId = p.templateId; break; }
  }

  // 2. If keyword routing matched and inputs can be inferred, run the task
  if (templateId) {
    const tpl = templates.find(t => t.id === templateId);
    if (tpl) {
      const inputs = inferInputs(tpl.id, text);
      const missing = tpl.inputs.filter(i => i.required && !(i.name in inputs));
      if (missing.length === 0) {
        const job = newJob(`${tpl.role.toLowerCase()}:${tpl.id}`);
        job.template = tpl.id;
        job.title = tpl.title;
        job.inputs = inputs;
        job.requiresApproval = tpl.requiresApproval;
        if (tpl.requiresApproval) {
          job.status = "awaiting-approval";
          job.log.push(`[${new Date().toISOString()}] task created from chat · waiting on human approval`);
          return res.json({
            kind: "task",
            jobId: job.id,
            templateId: tpl.id,
            requiresApproval: true,
            text: `I've queued a **${tpl.title}** task — it needs your approval before running. Open the Approvals page.`,
          });
        }
        // Fire and reply with handle
        void runJob(job, async (push) => runTemplateInline(tpl.id, inputs, push));
        return res.json({
          kind: "task",
          jobId: job.id,
          templateId: tpl.id,
          requiresApproval: false,
          text: `On it — running **${tpl.title}**${friendlyInputs(tpl.id, inputs)}. I'll surface the result on the Tasks page when it's done.`,
        });
      }
      // Missing required inputs — ask back conversationally
      const ask = missing.map(m => `**${m.label}**`).join(", ");
      return res.json({
        kind: "message",
        text: `I can run **${tpl.title}**, but I need: ${ask}. Reply with the value(s), or use the Templates page to fill the form.`,
      });
    }
  }

  // 3. Plain chat via Ollama with brain-aware system prompt
  const sys = `You are clawbot, an AI workforce agent inside NeuroWorks. The user has a personal Obsidian vault (the "second brain") with notes, daily digests, and project summaries you write. You can run these tools when the user asks — DO NOT pretend to run them yourself; mention them by name and the user's chat will trigger them.

Available tools (templates):
${templates.map(t => `- ${t.id}: ${t.title} — ${t.description}`).join("\n")}

Style: warm, concise, plain language. Under 120 words. If the user is asking factual questions about their work or notes, suggest "search the knowledge base" or "summarize a project" as the right tool.`;

  // Compact recent context — last 6 turns
  const ctx = messages.slice(-6).map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");

  let reply = "";
  try {
    reply = await ollamaGenerate(ctx + "\nAssistant:", sys);
  } catch (e: any) {
    reply = `Sorry — I couldn't reach Ollama (${e.message}). The Engineering and Knowledge templates still work directly from the Templates page.`;
  }

  // If the user might have been asking for something searchable, also surface a quick brain search hit
  let hint: { results: any[] } | null = null;
  if (text.length > 4 && !templateId) {
    const r = searchVault(text.slice(0, 80), 3);
    if (r.length > 0) hint = { results: r };
  }

  res.json({ kind: "message", text: reply.trim(), brainHits: hint?.results ?? [] });
});

function inferInputs(templateId: string, text: string): Record<string, any> {
  const out: Record<string, any> = {};
  if (templateId === "summarize-repo") {
    // Extract repo name: look for "the X project" / "summarize X" / "summary of X"
    const m = text.match(/(?:summari[sz]e(?:\s+the)?|summary of|summarise)\s+([^\s,.!?]+)/i);
    if (m) out.repo = m[1];
  } else if (templateId === "search-brain") {
    // Strip the verb to get the query
    const m = text.match(/(?:search(?:\s+(?:for|my\s+notes\s+for|the\s+vault\s+for|knowledge\s+base\s+for|brain\s+for))?|find(?:\s+in)?|look\s+up)\s+(.+?)[.!?]?$/i);
    if (m) out.query = m[1].trim();
    else out.query = text;
  } else if (templateId === "run-digest") {
    const m = text.match(/(\d+)\s*days?/);
    out.lookbackDays = m ? Number(m[1]) : 7;
  } else if (templateId === "add-note") {
    // "add (a) note: <title> — <body>", "note that <body>", "save a note about <body>"
    let rest = "";
    let m = text.match(/(?:add|save|capture|create|drop|jot(?:\s+down)?)\s+(?:a\s+|an\s+|the\s+|new\s+)?note(?:\s+(?:that|saying|about|titled|on|for|re))?\s*[:\-—]?\s*(.+)/i);
    if (m) rest = m[1].trim();
    if (!rest) { m = text.match(/^\s*note\s+that\s+(.+)/i); if (m) rest = m[1].trim(); }
    if (rest) {
      // Split title/body on first " — " or " - " or ": "
      const split = rest.match(/^(.+?)\s+[—\-:]\s+(.+)$/);
      if (split) { out.title = split[1].trim(); out.body = split[2].trim(); }
      else { out.title = rest.slice(0, 80); out.body = rest; }
    }
  } else if (templateId === "publish-folder") {
    const m = text.match(/publish\s+(?:the\s+)?(?:folder\s+)?["']?([^"']+?)["']?(?:\s+to\s+github|$)/i);
    if (m) out.path = m[1].trim();
  }
  return out;
}

function friendlyInputs(templateId: string, inputs: Record<string, any>): string {
  if (templateId === "summarize-repo" && inputs.repo) return ` for **${inputs.repo}**`;
  if (templateId === "search-brain" && inputs.query) return ` — query: *${inputs.query}*`;
  if (templateId === "run-digest" && inputs.lookbackDays) return ` (lookback ${inputs.lookbackDays}d)`;
  if (templateId === "add-note" && inputs.title) return ` titled *${inputs.title}*`;
  return "";
}

// Lightweight runner to avoid circular import with templates router
async function runTemplateInline(templateId: string, inputs: Record<string, unknown>, push: (m: string) => void) {
  const { default: runViaTemplates } = await import("./templates.js")
    .then(m => ({ default: (m as any).runFromChat })).catch(() => ({ default: null }));
  if (runViaTemplates) return runViaTemplates(templateId, inputs, push);
  // Fallback: hit our own /api/templates/run via internal call
  const port = config.port;
  const r = await fetch(`http://127.0.0.1:${port}/api/templates/run/${templateId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(inputs),
  });
  const data = await r.json() as any;
  push(`delegated to /api/templates/run/${templateId} (jobId=${data.jobId})`);
  return data;
}
