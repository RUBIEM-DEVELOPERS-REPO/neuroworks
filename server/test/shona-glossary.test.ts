// Guards the Shona/Ndebele detector against both false negatives (a real
// Shona message not triggering the language directive — the user gets an
// English-only response to a Shona request) and false positives (ordinary
// English misfiring into an irrelevant glossary injection on every turn).

import { describe, expect, it } from "vitest";
import { detectsShonaOrNdebele, shonaLanguageDirective } from "../src/lib/shona-glossary.js";

describe("detectsShonaOrNdebele", () => {
  it("detects a Shona greeting + request", () => {
    expect(detectsShonaOrNdebele("Mhoro, ndinoda kutumira mari kuna Tatenda, $50")).toBe(true);
  });

  it("detects a Ndebele greeting", () => {
    expect(detectsShonaOrNdebele("Salibonani, ndifuna ukuthumela imali")).toBe(true);
  });

  it("detects Shona/English code-switching (the Zimbabwean norm)", () => {
    expect(detectsShonaOrNdebele("Hi, ndoda kutenga magetsi for my house, e20")).toBe(true);
  });

  it("does not misfire on plain English", () => {
    expect(detectsShonaOrNdebele("Please summarize the Q3 report and email it to the team")).toBe(false);
  });

  it("does not misfire on a single ambiguous token", () => {
    // "sei" alone (e.g. as part of a name) shouldn't be enough on its own.
    expect(detectsShonaOrNdebele("Sei is the name of the new intern")).toBe(false);
  });

  it("handles empty input", () => {
    expect(detectsShonaOrNdebele("")).toBe(false);
  });
});

describe("shonaLanguageDirective", () => {
  it("includes financial-jargon grounding for Zimbabwe mobile money", () => {
    const block = shonaLanguageDirective();
    expect(block).toContain("tumira mari");
    expect(block).toContain("magetsi");
    expect(block).toContain("Zimbabwean");
  });
});
