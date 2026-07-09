import { Router } from "express";
import { getEmailStatus, sendTestEmail, sendEmail, emailConfigured } from "../lib/email.js";
import { assertSafeExternalPath } from "../lib/security-gates.js";

export const emailRouter = Router();

// Bridge status — configured?, running?, inbound allow-list, last poll, counters.
emailRouter.get("/", (_req, res) => res.json(getEmailStatus()));
emailRouter.get("/status", (_req, res) => res.json(getEmailStatus()));

// Send a real email (markdown body → text + HTML) through the configured
// outbound transport (Mailjet > SMTP). body: { to, subject, body, attachPaths? }.
// to: a single address, a comma-separated list, or an array — sendEmail
// validates each address individually. attachPaths: absolute file path(s) —
// string, comma-separated string, or array — loaded from disk and attached.
// Same sensitive-path gate as the agent primitive.
emailRouter.post("/send", async (req, res) => {
  try {
    if (!emailConfigured()) return res.status(400).json({ error: "email not configured" });
    const rawTo = req.body?.to;
    const to: string[] = Array.isArray(rawTo)
      ? rawTo.map((a: any) => String(a ?? "").trim()).filter(Boolean)
      : typeof rawTo === "string"
        ? rawTo.split(",").map(a => a.trim()).filter(Boolean)
        : [];
    const subject = String(req.body?.subject ?? "").trim();
    const body = String(req.body?.body ?? "");
    if (to.length === 0) return res.status(400).json({ error: "valid 'to' address required" });
    if (!subject) return res.status(400).json({ error: "subject required" });
    if (!body.trim()) return res.status(400).json({ error: "body required" });
    const rawAttach = req.body?.attachPaths;
    const attachPaths: string[] = Array.isArray(rawAttach)
      ? rawAttach.map((p: any) => String(p ?? "").trim()).filter(Boolean)
      : typeof rawAttach === "string" && rawAttach.trim()
        ? rawAttach.split(",").map(p => p.trim()).filter(Boolean)
        : [];
    for (const p of attachPaths) assertSafeExternalPath(p);
    const r = await sendEmail({ to, subject, body, attachPaths: attachPaths.length ? attachPaths : undefined });
    res.json({ ok: true, to: r.to, recipients: r.recipients, transport: r.transport, sentAt: r.sentAt, attachments: r.attachments });
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
