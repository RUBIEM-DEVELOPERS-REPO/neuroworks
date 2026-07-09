// Attachment loading is the part of the send-attachment feature that's pure
// enough to unit test without a live Mailjet/SMTP call: it reads real files
// off disk, base64-encodes them, and enforces the size cap + content-type
// mapping. A regression here would silently break every "send/attach the
// file" task (the Summit Recon incident this feature was built to prevent).

import { describe, expect, it, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAttachments, normalizeRecipients } from "../src/lib/email.js";

const dir = mkdtempSync(join(tmpdir(), "clawbot-attach-test-"));
afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } });

describe("loadAttachments", () => {
  it("loads a real file and base64-encodes it", () => {
    const p = join(dir, "notes.txt");
    writeFileSync(p, "hello world");
    const [a] = loadAttachments([p]);
    expect(a.filename).toBe("notes.txt");
    expect(a.contentType).toBe("text/plain");
    expect(Buffer.from(a.base64, "base64").toString("utf8")).toBe("hello world");
    expect(a.bytes).toBe(11);
  });

  it("maps known extensions to their content type", () => {
    const p = join(dir, "report.xlsx");
    writeFileSync(p, "fake-xlsx-bytes");
    const [a] = loadAttachments([p]);
    expect(a.contentType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });

  it("falls back to application/octet-stream for an unknown extension", () => {
    const p = join(dir, "mystery.xyz123");
    writeFileSync(p, "???");
    const [a] = loadAttachments([p]);
    expect(a.contentType).toBe("application/octet-stream");
  });

  it("throws with a clear message when the file doesn't exist", () => {
    expect(() => loadAttachments([join(dir, "does-not-exist.pdf")])).toThrow(/not found/i);
  });

  it("throws when a path is a directory, not a file", () => {
    expect(() => loadAttachments([dir])).toThrow(/directory/i);
  });

  it("throws when the total size exceeds the 10MB cap", () => {
    const big = join(dir, "big.bin");
    writeFileSync(big, Buffer.alloc(11 * 1024 * 1024, 1));
    expect(() => loadAttachments([big])).toThrow(/exceed/i);
  });

  it("loads multiple files and sums their sizes", () => {
    const p1 = join(dir, "a.csv");
    const p2 = join(dir, "b.csv");
    writeFileSync(p1, "a,b,c");
    writeFileSync(p2, "1,2,3");
    const out = loadAttachments([p1, p2]);
    expect(out.length).toBe(2);
    expect(out.map(a => a.filename)).toEqual(["a.csv", "b.csv"]);
  });

  it("skips blank entries without erroring", () => {
    const p = join(dir, "notes.txt");
    const out = loadAttachments(["", p, "  "]);
    expect(out.length).toBe(1);
  });
});

// normalizeRecipients backs the multi-recipient fix for the 2026-07-08
// broadcast-send bug (see agent-helpers.test.ts's deepGet wildcard tests for
// the other half — the resolver that produces the array this consumes).
describe("normalizeRecipients", () => {
  it("passes a single address through as a one-element array", () => {
    expect(normalizeRecipients("a@x.com")).toEqual(["a@x.com"]);
  });

  it("splits a comma-separated string", () => {
    expect(normalizeRecipients("a@x.com, b@y.com,c@z.com")).toEqual(["a@x.com", "b@y.com", "c@z.com"]);
  });

  it("accepts a real array (what a resolved wildcard reference produces)", () => {
    expect(normalizeRecipients(["a@x.com", "b@y.com"])).toEqual(["a@x.com", "b@y.com"]);
  });

  it("dedupes case-insensitively", () => {
    expect(normalizeRecipients(["a@x.com", "A@X.com", "b@y.com"])).toEqual(["a@x.com", "b@y.com"]);
  });

  it("drops blank entries", () => {
    expect(normalizeRecipients(["a@x.com", "", "  ", "b@y.com"])).toEqual(["a@x.com", "b@y.com"]);
  });

  it("returns an empty array for empty input", () => {
    expect(normalizeRecipients("")).toEqual([]);
    expect(normalizeRecipients([])).toEqual([]);
  });
});
