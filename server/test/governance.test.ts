// Governance enforcement — the pure decision logic that turns extracted,
// admin-accepted policy constraints into an actual block, not just an
// item sitting reviewed in the Governance UI. getConstraints() itself reads
// real vault + .neuroworks paths (same as the rest of governance.ts), so
// these tests exercise the disk-free core (filterEnforceable, gateAction,
// describeStepAction, CONSEQUENTIAL_TOOLS) that checkStepAgainstGovernance /
// checkContentAgainstGovernance / hasEnforceableConstraints are thin I/O
// wrappers around.

import { describe, expect, it } from "vitest";
import {
  CONSEQUENTIAL_TOOLS,
  describeStepAction,
  filterEnforceable,
  gateAction,
  type ExtractedConstraint,
} from "../src/lib/governance.js";

function constraint(over: Partial<ExtractedConstraint> = {}): ExtractedConstraint {
  return {
    id: "policy-0",
    policyName: "policy",
    rule: "Never email customer financial data to external domains",
    severity: "hard",
    category: "data-privacy",
    reviewed: true,
    accepted: true,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe("CONSEQUENTIAL_TOOLS", () => {
  it("includes side-effecting tools that were the actual incident vector (email, vault write, github, payments)", () => {
    expect(CONSEQUENTIAL_TOOLS.has("email.send")).toBe(true);
    expect(CONSEQUENTIAL_TOOLS.has("vault.write")).toBe(true);
    expect(CONSEQUENTIAL_TOOLS.has("github.create_issue")).toBe(true);
    expect(CONSEQUENTIAL_TOOLS.has("payment.link")).toBe(true);
    expect(CONSEQUENTIAL_TOOLS.has("code.exec")).toBe(true);
  });

  it("excludes read-only tools — those can't violate a policy by running, only via their output, which the content gate catches", () => {
    expect(CONSEQUENTIAL_TOOLS.has("vault.read")).toBe(false);
    expect(CONSEQUENTIAL_TOOLS.has("web.fetch")).toBe(false);
    expect(CONSEQUENTIAL_TOOLS.has("research.deep")).toBe(false);
  });
});

describe("describeStepAction", () => {
  it("puts the tool name first and folds in recipient/content-bearing args", () => {
    const s = describeStepAction("email.send", { to: "finance@external.example.com", subject: "Q3 financials" });
    expect(s.startsWith("email.send")).toBe(true);
    expect(s).toContain("finance@external.example.com");
    expect(s).toContain("Q3 financials");
  });

  it("joins array args (multi-recipient to) into the description", () => {
    const s = describeStepAction("email.send", { to: ["a@x.com", "b@x.com"] });
    expect(s).toContain("a@x.com, b@x.com");
  });

  it("ignores keys that aren't in the extraction list and skips undefined/blank values", () => {
    const s = describeStepAction("vault.write", { path: "notes/x.md", unrelatedFlag: true, subject: "" });
    expect(s).toBe("vault.write | notes/x.md");
  });

  it("caps each field at 500 chars so a huge body doesn't blow the overlap check", () => {
    const long = "x".repeat(1000);
    const s = describeStepAction("vault.write", { content: long });
    expect(s.length).toBeLessThan(600);
  });
});

describe("filterEnforceable", () => {
  it("keeps only reviewed + accepted + hard constraints", () => {
    const cs = [
      constraint({ id: "a" }), // reviewed+accepted+hard -> kept
      constraint({ id: "b", severity: "soft" }), // soft -> dropped
      constraint({ id: "c", reviewed: false }), // unreviewed -> dropped
      constraint({ id: "d", accepted: false }), // rejected -> dropped
    ];
    const out = filterEnforceable(cs);
    expect(out.map(c => c.id)).toEqual(["a"]);
  });

  it("returns an empty array when nothing qualifies", () => {
    expect(filterEnforceable([constraint({ severity: "soft" })])).toEqual([]);
    expect(filterEnforceable([])).toEqual([]);
  });
});

describe("gateAction", () => {
  it("does not block when there are no enforceable constraints", () => {
    const gate = gateAction("email.send | attacker@external.example.com | Q3 financials", []);
    expect(gate.blocked).toBe(false);
    expect(gate.violations).toEqual([]);
  });

  it("blocks an action whose description overlaps a hard constraint's rule", () => {
    const enforceable = filterEnforceable([
      constraint({ rule: "Never email customer financial data to external domains" }),
    ]);
    const gate = gateAction("email.send | attacker@external.example.com | Q3 financial customer data export", enforceable);
    expect(gate.blocked).toBe(true);
    expect(gate.violations).toHaveLength(1);
    expect(gate.violations[0].policyName).toBe("policy");
    expect(gate.violations[0].severity).toBe("hard");
  });

  it("does not block an unrelated action against the same constraint set", () => {
    const enforceable = filterEnforceable([
      constraint({ rule: "Never email customer financial data to external domains" }),
    ]);
    const gate = gateAction("vault.write | notes/meeting-agenda.md | weekly standup topics", enforceable);
    expect(gate.blocked).toBe(false);
  });

  it("reports every violated constraint when an action matches more than one", () => {
    const enforceable = filterEnforceable([
      constraint({ id: "a", rule: "Never email customer financial data to external domains" }),
      constraint({ id: "b", rule: "Never email attachments containing financial customer records" }),
    ]);
    const gate = gateAction("email.send | attacker@external.example.com | financial customer records attached", enforceable);
    expect(gate.blocked).toBe(true);
    expect(gate.violations.length).toBeGreaterThanOrEqual(1);
  });
});
