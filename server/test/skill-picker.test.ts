// Skill picker tests — guard against the keyword/intent scoring drifting.
//
// Real .md files in server/src/skills/ are loaded for these tests so a
// rename or applies_to typo in a playbook surfaces here, not in
// production. We assert SPECIFIC skill names because that's the contract
// the agent loop depends on (e.g. "summarise this contract" must route
// to contract-summary, not the generic summarization skill).

import { describe, expect, it } from "vitest";
import {
  suggestSkillsForTask,
  topSkillScoreForTask,
  listSkills,
} from "../src/lib/skills.js";

describe("skill picker", () => {
  it("loads every built-in skill on disk", () => {
    const all = listSkills();
    expect(all.length).toBeGreaterThan(30);
    // Spot-check a few critical ones exist.
    const names = new Set(all.map(s => s.name));
    expect(names.has("memo-writing")).toBe(true);
    expect(names.has("pc-doc-handling")).toBe(true);
    expect(names.has("contract-summary")).toBe(true);
    expect(names.has("direct-answer")).toBe(true);
  });

  it("routes 'save X to my vault' to pc-doc-handling", () => {
    const picks = suggestSkillsForTask(
      "save the AIIA reference letter to my vault",
      undefined,
      1,
    );
    expect(picks.length).toBe(1);
    expect(picks[0].name).toBe("pc-doc-handling");
  });

  it("routes 'summarize this contract' to contract-summary, not generic summarization", () => {
    const picks = suggestSkillsForTask(
      "summarise this contract for our office lease",
      "summarize",
      2,
    );
    expect(picks[0].name).toBe("contract-summary");
  });

  it("intent alone (no task text) still picks a skill", () => {
    const picks = suggestSkillsForTask("", "draft-email", 1);
    expect(picks.length).toBe(1);
    expect(picks[0].name).toBe("email-writing");
  });

  it("topSkillScoreForTask returns null when nothing matches", () => {
    const top = topSkillScoreForTask("xyz random gibberish", "unknown-intent");
    expect(top).toBeNull();
  });

  it("topSkillScoreForTask returns a score ≥ 20 when intent matches", () => {
    const top = topSkillScoreForTask("write me an email about the launch", "draft-email");
    expect(top).not.toBeNull();
    expect(top!.score).toBeGreaterThanOrEqual(20);
  });

  it("'what's in this pdf X' routes to local-doc-summary or pc-doc-handling", () => {
    const picks = suggestSkillsForTask("what's in this pdf Q3-forecast", undefined, 2);
    const names = picks.map(p => p.name);
    expect(
      names.includes("local-doc-summary") || names.includes("pc-doc-handling"),
    ).toBe(true);
  });
});
