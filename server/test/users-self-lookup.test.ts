// Regression guard for the 2026-07-11 email.send failure (job 6b8b5adf):
// the task said "…and email me", the planner called users.lookup("me"),
// nothing in the directory is literally named "me", the lookup returned
// null, and email.send received the unresolved "$step_2.user.email"
// placeholder as its recipient. Self-referential queries must now be
// recognised so lookupUser can resolve them to the operator.
import { describe, it, expect } from "vitest";
import { isSelfReferentialQuery } from "../src/lib/users.js";

describe("isSelfReferentialQuery", () => {
  it.each([
    "me",
    "Me",
    "myself",
    "self",
    "my email",
    "my email address",
    "the operator",
    "operator",
    "owner",
    "the owner",
    "account owner",
    "the requester",
    "requester",
    "current user",
    "the user",
    "  me  ", // planner padding
  ])("recognises %j as self-referential", (q) => {
    expect(isSelfReferentialQuery(q)).toBe(true);
  });

  it.each([
    "Jane",
    "arthur@rubiem.com",
    "Mr. Khumalo",
    "user", // bare "user" is too ambiguous — could be a partial email local part
    "operators", // plural = likely a department/topic, not the person
    "my manager", // a real other person, must go through directory scoring
    "owner of the Q3 report",
    "",
  ])("does not treat %j as self-referential", (q) => {
    expect(isSelfReferentialQuery(q)).toBe(false);
  });
});
