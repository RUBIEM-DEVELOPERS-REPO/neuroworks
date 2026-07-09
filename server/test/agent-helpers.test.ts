// Locks in the cascade contract that the agent loop depends on.
//
// These helpers (parseUserRequestFromTask, looksLikeDirectAnswer,
// isTriviallyDirectAnswer, extractTopic, heuristicPlan) are pure
// functions but downstream behaviour pivots on every nuance: change a
// regex and a chat input that used to find a PDF in Downloads suddenly
// turns into a 3-minute web research run. Refactor by feel is risky;
// these tests are the safety net.

import { describe, expect, it } from "vitest";
import {
  parseUserRequestFromTask,
  looksLikeDirectAnswer,
  isTriviallyDirectAnswer,
  extractTopic,
  heuristicPlan,
  compactStepSummary,
  defaultVaultPlan,
  deepGet,
} from "../src/lib/agent.js";

describe("parseUserRequestFromTask", () => {
  it("strips a templated 'Topic: …' suffix and returns just the topic", () => {
    const enriched = `Write a polished memo.\n\nTopic: Q3 hiring freeze\n\nInterpretation: …`;
    expect(parseUserRequestFromTask(enriched)).toBe("Q3 hiring freeze");
  });

  it("passes plain user text through", () => {
    expect(parseUserRequestFromTask("hi")).toBe("hi");
  });

  // The chat route appends planner directives AFTER the user's text. These
  // must never leak into customer-facing task echoes (a rescue-summary email
  // once opened with "…email to X **Alignment check — required before…**").
  it("strips the trailing Alignment-check directive", () => {
    const enriched =
      `Look for Summit Recon in my downloads and summarize it in an email to arthur@example.com\n\n` +
      `**Alignment check — required before responding.** Before producing the final answer, scan the user's request for CONCRETE elements…`;
    expect(parseUserRequestFromTask(enriched)).toBe(
      "Look for Summit Recon in my downloads and summarize it in an email to arthur@example.com",
    );
  });

  it("strips the trailing Source-of-truth notice", () => {
    const enriched = `Summarize the attached BRS.\n\n**Source-of-truth notice.** Attached documents follow this block…`;
    expect(parseUserRequestFromTask(enriched)).toBe("Summarize the attached BRS.");
  });

  it("stops a Topic: capture at the Alignment-check block", () => {
    const enriched = `Write a memo.\n\nTopic: Q3 hiring freeze\n\n**Alignment check — required before responding.** …`;
    expect(parseUserRequestFromTask(enriched)).toBe("Q3 hiring freeze");
  });
});

// Rescue summaries get shown (and sometimes emailed) to customers — the step
// digests must render READABLE text, never internal JSON with absolute paths.
describe("compactStepSummary", () => {
  const run = (result: any) =>
    compactStepSummary({ step: { tool: "x", args: {} }, ok: true, result, durationMs: 1 });

  it("renders fs search matches[] as a file list, not raw JSON", () => {
    const out = run({ folder: "downloads", count: 2, matches: [
      { path: "C:\\Users\\A\\Downloads\\Summit Recon.xlsx", name: "Summit Recon.xlsx", ext: ".xlsx", size: 17822 },
      { path: "C:\\Users\\A\\Downloads\\Report.docx", name: "Report.docx", ext: ".docx", size: 900 },
    ] });
    expect(out).toContain("1. Summit Recon.xlsx");
    expect(out).toContain("2. Report.docx");
    expect(out).not.toContain("{");
  });

  it("renders a doc read's content field, not the raw result object", () => {
    const out = run({ content: "## Sheet: Sheet1\nsummit Costs, 1200", kind: "xlsx", size: 17822 });
    expect(out).toContain("summit Costs");
    expect(out).not.toContain("\"kind\"");
  });
});

describe("isTriviallyDirectAnswer", () => {
  it.each([
    "hi",
    "Hello",
    "thanks",
    "thank you",
    "good morning",
    "yes",
    "nope",
    "maybe",
    "ok",
    "what is 2+2",
    "(3+4)*2",
    "2+2",
  ])("recognises %j as trivial (with default prior-context = true)", (input) => {
    expect(isTriviallyDirectAnswer(input)).toBe(true);
  });

  it.each([
    "what's the hanta virus",
    "summarise the AIIA Reference Letter",
    "tell me about neuroworks",
    "draft a memo about the Q3 freeze",
    "",
  ])("does NOT mark %j as trivial", (input) => {
    expect(isTriviallyDirectAnswer(input)).toBe(false);
  });

  it("treats 'yes' as NOT trivial when there's no prior-turn context", () => {
    expect(isTriviallyDirectAnswer("yes", false)).toBe(false);
    expect(isTriviallyDirectAnswer("no", false)).toBe(false);
    expect(isTriviallyDirectAnswer("maybe", false)).toBe(false);
  });

  it("still treats greetings/arithmetic as trivial without prior context", () => {
    expect(isTriviallyDirectAnswer("hi", false)).toBe(true);
    expect(isTriviallyDirectAnswer("2+2", false)).toBe(true);
  });
});

describe("looksLikeDirectAnswer", () => {
  it("returns true for chit-chat with no tool cues", () => {
    expect(looksLikeDirectAnswer("explain async/await in javascript")).toBe(true);
  });

  it("returns false when the task names a local file path", () => {
    expect(looksLikeDirectAnswer("read 0-Inbox/note.md")).toBe(false);
  });

  it("returns false when the task mentions the vault", () => {
    expect(looksLikeDirectAnswer("what's in my vault about hiring")).toBe(false);
  });

  it("returns false when the task contains a URL", () => {
    expect(looksLikeDirectAnswer("scrape https://example.com/page")).toBe(false);
  });
});

describe("extractTopic", () => {
  it("strips drafting verbs so the captured topic is the subject", () => {
    // The fabrication fix that landed this session — without it, the
    // 'topic' captured was "a memo about Q3" and the vault search ran
    // against the verb instead of the subject.
    expect(extractTopic("draft a memo about the Q3 freeze")).toMatch(/q3 freeze|q3/i);
  });

  it("strips 'give me a summary on …'", () => {
    expect(extractTopic("give me a summary on neuroworks")).toBe("neuroworks");
  });

  it("strips 'tell me about …'", () => {
    expect(extractTopic("tell me about neuroworks")).toBe("neuroworks");
  });

  it("strips 'summarise what my vault says about X' (regression — F-grade outcome)", () => {
    // Previously left "what my vault says about neuroworks" as the
    // topic, which then routed to a literal web search that hit
    // Slovak-language sites matching "my" (Slovak word).
    expect(extractTopic("summarise what my vault says about neuroworks")).toBe("neuroworks");
  });

  it("strips 'summarise what my notes have on X'", () => {
    expect(extractTopic("summarise what my notes have on q3 hiring")).toBe("q3 hiring");
  });

  it("strips 'tell me what we know about X'", () => {
    expect(extractTopic("tell me what we know about neuroworks")).toBe("neuroworks");
  });
});

describe("heuristicPlan", () => {
  it("routes 'save X to my vault' to fs.find_in → fs.import_to_vault", () => {
    const p = heuristicPlan("save resume.pdf to my vault");
    expect(p).not.toBeNull();
    expect(p!.steps[0].tool).toBe("fs.find_in");
    expect(p!.steps[1].tool).toBe("fs.import_to_vault");
    // First step args must include folder='all' so the sweep covers all
    // user folders (the fix for fabrication-by-no-preflight).
    expect((p!.steps[0].args as any).folder).toBe("all");
  });

  it("routes 'what's in this pdf X' to fs.find_in folder='all' + fs.read_external", () => {
    const p = heuristicPlan("what's in this pdf Q3-forecast");
    expect(p).not.toBeNull();
    expect(p!.steps[0].tool).toBe("fs.find_in");
    expect((p!.steps[0].args as any).folder).toBe("all");
    expect(p!.steps[1].tool).toBe("fs.read_external");
  });

  it("routes a bare URL to web.scrape", () => {
    const p = heuristicPlan("https://example.com");
    expect(p).not.toBeNull();
    expect(p!.steps[0].tool).toBe("web.scrape");
  });

  it("routes a vault path read to vault.read", () => {
    const p = heuristicPlan("read 0-Inbox/note.md");
    expect(p).not.toBeNull();
    expect(p!.steps[0].tool).toBe("vault.read");
  });

  it("routes 'search the web for X' to research.deep", () => {
    const p = heuristicPlan("search the web for hanta virus symptoms");
    expect(p).not.toBeNull();
    expect(p!.steps[0].tool).toBe("research.deep");
  });

  it("routes 'summarise X' to research.deep (regression — used to fall through to LLM planner)", () => {
    const p = heuristicPlan("summarise neuroworks");
    expect(p).not.toBeNull();
    expect(p!.steps[0].tool).toBe("research.deep");
  });

  it("routes 'recap X' / 'tldr X' / 'brief me on X' to research.deep", () => {
    expect(heuristicPlan("recap the q3 freeze")?.steps[0].tool).toBe("research.deep");
    expect(heuristicPlan("tldr neuroworks")?.steps[0].tool).toBe("research.deep");
    expect(heuristicPlan("brief me on the auth migration")?.steps[0].tool).toBe("research.deep");
  });

  it("returns null for empty input", () => {
    expect(heuristicPlan("")).toBeNull();
    expect(heuristicPlan("   ")).toBeNull();
  });

  it("detects 'move … and delete' as removeOriginal=true on absolute paths", () => {
    // Absolute path skips the find step and goes straight to import.
    const p = heuristicPlan("move C:\\Users\\me\\report.pdf to my vault and delete the original");
    expect(p).not.toBeNull();
    const importStep = p!.steps[p!.steps.length - 1];
    expect(importStep.tool).toBe("fs.import_to_vault");
    expect((importStep.args as any).removeOriginal).toBe(true);
  });
});

// defaultVaultPlan is the LAST-resort deterministic fallback (used when both
// heuristicPlan and the LLM planner declined) — its local-fs branch is what
// actually ran for the 2026-07-08 Summit Recon incident: "find X in my
// downloads and attach it to an email to Y" produced a corrupted fs.find_in
// needle (the whole tail became the "filename") and never sent anything.
describe("defaultVaultPlan — attach-and-send", () => {
  it("finds the file and chains a real email.send with attach_paths, given a literal address", () => {
    const p = defaultVaultPlan(
      "Find Summit Recon in my downloads and attach it to an email to arthurmagaya2@gmail.com with a one-line note that it's the finance sheet",
    );
    expect(p.steps.length).toBe(2);
    expect(p.steps[0].tool).toBe("fs.find_in");
    // The needle must be the clean filename, NOT the whole trailing clause —
    // this is the exact corruption the tail-strip regex fix prevents.
    expect((p.steps[0].args as any).name).toBe("Summit Recon");
    expect(p.steps[1].tool).toBe("email.send");
    expect((p.steps[1].args as any).to).toBe("arthurmagaya2@gmail.com");
    expect((p.steps[1].args as any).attach_paths).toBe("$step_0.matches.0.path");
  });

  it("degrades to a plain find (no email.send) when the recipient is named, not a literal address", () => {
    const p = defaultVaultPlan("find Summit Recon in my downloads and attach it to an email for Godswill");
    expect(p.steps.some(s => s.tool === "email.send")).toBe(false);
    expect(p.steps[0].tool).toBe("fs.find_in");
  });

  it("does not misfire attach-and-send on a plain summarize-in-email ask (no 'attach')", () => {
    const p = defaultVaultPlan(
      "look for Summit Recon in my downloads and summarize it in an email to arthur@example.com",
    );
    expect(p.steps.some(s => s.tool === "email.send")).toBe(false);
    expect((p.steps[0].args as any).name).toBe("Summit Recon");
  });

  // 2026-07-08 regression: "the doc called X" phrasing didn't match ANY of
  // the three (duplicated) local-fs detector regexes — they only recognised
  // "file called/named X", not "doc"/"document" — so a task phrased this way
  // skipped local search entirely and fell through to a useless research.deep
  // web search on the literal sentence. Fixed by broadening the shared
  // LOCAL_FS_HINT_RE to the same (file|doc|document|pdf|docx?|xlsx?|pptx?)
  // synonym set the needle-stripper already used downstream.
  it("recognises 'the doc called X' as a local-file reference, not a web-research task", () => {
    const p = defaultVaultPlan("Send an attachment doc called Summit Recon CONSO to all the users emails on Neuroworks");
    expect(p.steps[0].tool).toBe("fs.find_in");
    expect(p.steps[0].tool).not.toBe("research.deep");
    // No downloads/desktop/documents mentioned — falls back to folder='all'.
    expect((p.steps[0].args as any).folder).toBe("all");
    // No literal email address in "all the users" — can't safely guess one,
    // so this degrades to plain find (better than nothing found at all).
    expect(p.steps.some(s => s.tool === "email.send")).toBe(false);
  });

  it("recognises 'the document called X' the same way", () => {
    const p = defaultVaultPlan("find the document called Q3 budget and read it");
    expect(p.steps[0].tool).toBe("fs.find_in");
    expect((p.steps[0].args as any).name).toBe("Q3 budget");
  });
});

// 2026-07-08 regression, part 2: even after the "doc called X" detection fix
// let the planner build a proper broadcast plan (fs.find_in -> users.list ->
// email.send), the LLM planner referenced "$step_1.users.*.email" — a
// wildcard array-extraction the resolver didn't support — so `to` resolved
// to the literal unresolved string, email.send failed (ok:false), and the
// synth narrated a fake "sent to all 5 users" success on top of the silent
// failure. deepGet's "*" path segment fixes the resolution; email.ts's
// normalizeRecipients (tested separately) fixes email.send to actually
// accept the resulting array.
describe("deepGet — wildcard array extraction", () => {
  const users = { users: [
    { name: "Arthur", email: "admin@rubiem.com" },
    { name: "Godswill", email: "godswill@aiinstituteafrica.com" },
  ] };

  it("maps a field across an array with '*'", () => {
    expect(deepGet(users, "users.*.email")).toEqual(["admin@rubiem.com", "godswill@aiinstituteafrica.com"]);
  });

  it("still resolves a plain non-wildcard path", () => {
    expect(deepGet(users, "users.0.email")).toBe("admin@rubiem.com");
  });

  it("returns undefined for '*' on a non-array", () => {
    expect(deepGet({ users: "not-an-array" }, "users.*.email")).toBeUndefined();
  });
});
