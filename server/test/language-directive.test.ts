// Per-agent language override (2026-07-09 ticket: department agents should
// be able to generate in Shona/Ndebele independent of the org-wide
// onboarding default). personaSystemSuffix() is what every agent.ts call
// site actually receives as opts.personaSystemSuffix — these tests pin its
// contract: no language set = unchanged legacy behavior (30+ existing
// built-in personas depend on this), a language set = a directive appended
// LAST so it outranks the org default already baked earlier in the prompt.

import { describe, expect, it } from "vitest";
import { personaLanguageDirective } from "../src/lib/language-prompts.js";
import { personaSystemSuffix, type Persona } from "../src/lib/personas.js";

function persona(over: Partial<Persona> = {}): Persona {
  return {
    id: "test-agent",
    name: "Test Agent",
    role: "Operations",
    description: "A test persona",
    jobDescription: "Does test things.",
    tone: "concise",
    responsibilities: ["Do the thing"],
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe("personaLanguageDirective", () => {
  it("returns a Shona instruction block for sn", () => {
    const d = personaLanguageDirective("sn");
    expect(d.toLowerCase()).toContain("shona");
    expect(d).toContain("overrides any other language instruction above");
  });

  it("returns a Ndebele instruction block for nd", () => {
    const d = personaLanguageDirective("nd");
    expect(d.toLowerCase()).toContain("ndebele");
    expect(d).toContain("overrides any other language instruction above");
  });

  it("returns an explicit override for en (LANGUAGE_PROMPTS.en's phase strings are empty, so this can't just delegate)", () => {
    const d = personaLanguageDirective("en");
    expect(d.toLowerCase()).toContain("english");
    expect(d).toContain("overrides any other language instruction above");
  });

  it("returns empty string for an unrecognised language code", () => {
    expect(personaLanguageDirective("fr")).toBe("");
    expect(personaLanguageDirective("")).toBe("");
  });
});

describe("personaSystemSuffix — language composition", () => {
  it("adds no language block when the persona has no language set (default/legacy behavior)", () => {
    const suffix = personaSystemSuffix(persona());
    expect(suffix).not.toContain("This agent's language");
  });

  it("appends the language directive when the persona has a language set", () => {
    const suffix = personaSystemSuffix(persona({ language: "sn" }));
    expect(suffix).toContain("This agent's language");
    expect(suffix.toLowerCase()).toContain("shona");
  });

  it("puts the language directive AFTER the persona body — last-instruction precedence over the org-wide default injected earlier in the prompt by injectLanguagePrompt", () => {
    const suffix = personaSystemSuffix(persona({ language: "nd", jobDescription: "UNIQUE_BODY_MARKER_TASK" }));
    const bodyIdx = suffix.indexOf("Test Agent");
    const langIdx = suffix.indexOf("This agent's language");
    expect(bodyIdx).toBeGreaterThanOrEqual(0);
    expect(langIdx).toBeGreaterThan(bodyIdx);
  });

  it("still applies the lane-discipline preamble for a non-clawbot persona with a language set", () => {
    const suffix = personaSystemSuffix(persona({ language: "en" }));
    expect(suffix).toContain("Lane rule");
  });

  it("clawbot (catch-all) gets the language block too but skips the lane-discipline preamble", () => {
    const suffix = personaSystemSuffix(persona({ id: "clawbot", language: "sn" }));
    expect(suffix).not.toContain("Lane rule");
    expect(suffix).toContain("This agent's language");
  });

  it("returns empty string for a null persona (no active hire)", () => {
    expect(personaSystemSuffix(null)).toBe("");
  });
});
