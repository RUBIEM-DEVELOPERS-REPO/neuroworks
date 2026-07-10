// Document ingest — "scan a doc, populate a page".
//
// Takes any uploaded document (PDF, DOCX, XLSX, PPTX, TXT, MD, image → OCR),
// extracts its text, and asks the model to pull STRUCTURED entries out of it for
// one of two targets:
//   • "contacts"   → people for the Workforce contact book / Users directory
//   • "department" → department-specific company-data entries
//
// The caller (route) decides what to do with the parsed entries (insert into the
// users registry / department-data store). This module only does extract → LLM →
// parse, so it stays free of those dependencies and is easy to test.

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractDocText } from "./doc-extractor.js";
import { llmGenerate } from "./llm.js";

export type ContactEntry = { name: string; email?: string; title?: string; department?: string };
export type DepartmentEntry = { department: string; title: string; content: string };

const MAX_TEXT = 24_000; // cap text fed to the model so a huge doc doesn't blow the context

// Decode a base64 upload to a temp file, extract its text, then clean up.
async function extractText(input: { filename: string; contentBase64: string }): Promise<string> {
  let buf: Buffer;
  try { buf = Buffer.from(input.contentBase64, "base64"); }
  catch (e: any) { throw new Error(`base64 decode failed: ${e?.message ?? e}`); }
  if (buf.length === 0) throw new Error("decoded document is empty");
  if (buf.length > 20 * 1024 * 1024) throw new Error("document too large (max 20 MB)");

  const dir = mkdtempSync(join(tmpdir(), "nw-ingest-"));
  const safeName = input.filename.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "upload";
  const filePath = join(dir, safeName);
  try {
    writeFileSync(filePath, buf);
    const ext = await extractDocText(filePath);
    const text = (ext?.text ?? "").trim();
    if (!text) throw new Error("couldn't read any text from this document (unsupported or image-only with no OCR text)");
    return text.slice(0, MAX_TEXT);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* tolerate */ }
  }
}

// Pull the first JSON array out of an LLM response, tolerating code fences and
// surrounding prose.
function parseJsonArray(raw: string): any[] {
  let s = String(raw ?? "").trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  // Find the outermost [...] if there's leading/trailing prose.
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function ingestContacts(input: { filename: string; contentBase64: string }): Promise<ContactEntry[]> {
  const text = await extractText(input);
  const system = "You extract a clean contact directory from documents. Output ONLY a JSON array, no prose.";
  const prompt = [
    "From the document below, extract every PERSON mentioned as a contact / team member / employee.",
    "Return a JSON array where each element is:",
    `{"name": string, "email": string|null, "title": string|null, "department": string|null}`,
    "Rules:",
    "- name is required; skip entries with no clear person name.",
    "- email only if one is actually present in the text (don't invent).",
    "- title = their job title/role as written. department = their team/division if stated.",
    "- De-duplicate. Output ONLY the JSON array.",
    "",
    "DOCUMENT:",
    text,
  ].join("\n");

  const out = await llmGenerate(prompt, system, { temperature: 0, maxTokens: 2000 });
  const arr = parseJsonArray(out);
  const seen = new Set<string>();
  const contacts: ContactEntry[] = [];
  for (const r of arr) {
    const name = String(r?.name ?? "").trim();
    if (!name) continue;
    const email = r?.email && EMAIL_RE.test(String(r.email).trim()) ? String(r.email).trim().toLowerCase() : undefined;
    const key = (email || name.toLowerCase());
    if (seen.has(key)) continue;
    seen.add(key);
    contacts.push({
      name: name.slice(0, 120),
      email,
      title: r?.title ? String(r.title).trim().slice(0, 120) : undefined,
      department: r?.department ? String(r.department).trim().slice(0, 80) : undefined,
    });
  }
  return contacts;
}

export async function ingestDepartmentData(input: { filename: string; contentBase64: string; departmentHint?: string }): Promise<DepartmentEntry[]> {
  const text = await extractText(input);
  const hint = input.departmentHint?.trim();
  const system = "You extract structured, department-scoped reference facts from company documents. Output ONLY a JSON array, no prose.";
  const prompt = [
    "From the document below, extract the key reference facts an agent working a department task would need.",
    "Return a JSON array where each element is:",
    `{"department": string, "title": string, "content": string}`,
    "Rules:",
    hint
      ? `- The operator says this document is about the "${hint}" department — use that as the department unless the text clearly indicates another.`
      : "- Infer the department (e.g. Finance, HR, Sales, Operations) from the content.",
    "- title = a short label for the fact/section. content = the actual data/fact/policy text (concise, self-contained).",
    "- Produce one element per distinct fact or section (aim for 1-12 entries). Output ONLY the JSON array.",
    "",
    "DOCUMENT:",
    text,
  ].join("\n");

  const out = await llmGenerate(prompt, system, { temperature: 0, maxTokens: 2500 });
  const arr = parseJsonArray(out);
  const entries: DepartmentEntry[] = [];
  for (const r of arr) {
    const department = String(r?.department ?? hint ?? "").trim();
    const title = String(r?.title ?? "").trim();
    const content = String(r?.content ?? "").trim();
    if (!department || !title || !content) continue;
    entries.push({ department: department.slice(0, 80), title: title.slice(0, 120), content: content.slice(0, 20_000) });
  }
  return entries;
}
