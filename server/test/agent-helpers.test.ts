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
} from "../src/lib/agent.js";

describe("parseUserRequestFromTask", () => {
  it("strips a templated 'Topic: …' suffix and returns just the topic", () => {
    const enriched = `Write a polished memo.\n\nTopic: Q3 hiring freeze\n\nInterpretation: …`;
    expect(parseUserRequestFromTask(enriched)).toBe("Q3 hiring freeze");
  });

  it("passes plain user text through", () => {
    expect(parseUserRequestFromTask("hi")).toBe("hi");
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
