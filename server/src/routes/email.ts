import { Router } from "express";
import { getEmailStatus, sendTestEmail, sendEmail, emailConfigured } from "../lib/email.js";

export const emailRouter = Router();

// Bridge status — configured?, running?, inbound allow-list, last poll, counters.
emailRouter.get("/", (_req, res) => res.json(getEmailStatus()));
emailRouter.get("/status", (_req, res) => res.json(getEmailStatus()));

// Send a real email (markdown body → text + HTML) through the configured
// outbound transport (Mailjet > SMTP). body: { to, subject, body }.
emailRouter.post("/send", async (req, res) => {
  try {
    if (!emailConfigured()) return res.status(400).json({ error: "email not configured" });
    const to = String(req.body?.to ?? "").trim();
    const subject = String(req.body?.subject ?? "").trim();
    const body = String(req.body?.body ?? "");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ error: "valid 'to' address required" });
    if (!subject) return res.status(400).json({ error: "subject required" });
    if (!body.trim()) return res.status(400).json({ error: "body required" });
    const r = await sendEmail({ to, subject, body });
    res.json({ ok: true, to, transport: r.transport, sentAt: r.sentAt });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// Send a one-off test email to verify outbound SMTP works.
emailRouter.post("/test", async (req, res) => {
  try {
    if (!emailConfigured()) {
      return res.status(400).json({ error: "email not configured — set CLAWBOT_EMAIL_USER + CLAWBOT_EMAIL_APP_PASSWORD in .env" });
    }
    const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      return res.status(400).json({ error: "valid 'to' address required" });
    }
    await sendTestEmail(to);
    res.json({ ok: true, to });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});
