// Verifies the Host + Origin allow-list logic. Express middleware is
// awkward to spawn in isolation, so we drive the guard with synthetic
// request/response objects shaped just enough to satisfy the middleware
// signature.

import { describe, expect, it } from "vitest";
import { originGuard } from "../src/lib/origin-guard.js";

type FakeReq = {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
};
type FakeRes = {
  statusCode?: number;
  body?: any;
  status(c: number): FakeRes;
  json(b: any): FakeRes;
};

function makeRes(): FakeRes {
  const res: FakeRes = {
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  return res;
}

function run(req: FakeReq) {
  const res = makeRes();
  let nextCalled = false;
  originGuard(req as any, res as any, () => { nextCalled = true; });
  return { res, nextCalled };
}

describe("originGuard", () => {
  it("allows browser request from web UI with correct Host + Origin", () => {
    const { nextCalled } = run({
      method: "POST",
      path: "/api/chat",
      headers: { host: "127.0.0.1:7471", origin: "http://127.0.0.1:7470" },
    });
    expect(nextCalled).toBe(true);
  });

  it("allows server-to-server peer call (no Origin)", () => {
    const { nextCalled } = run({
      method: "POST",
      path: "/api/peers/delegate",
      headers: { host: "127.0.0.1:7471" },
    });
    expect(nextCalled).toBe(true);
  });

  it("blocks request with rebound domain in Host header", () => {
    const { res, nextCalled } = run({
      method: "POST",
      path: "/api/chat",
      headers: { host: "evil.com:7471", origin: "http://evil.com" },
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body?.error).toBe("host_not_allowed");
  });

  it("blocks cross-origin POST even when Host matches", () => {
    const { res, nextCalled } = run({
      method: "POST",
      path: "/api/chat",
      headers: { host: "127.0.0.1:7471", origin: "https://evil.com" },
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body?.error).toBe("origin_not_allowed");
  });

  it("exempts /api/health unconditionally", () => {
    const { nextCalled } = run({
      method: "GET",
      path: "/api/health",
      headers: { host: "anything:1234" },
    });
    expect(nextCalled).toBe(true);
  });

  it("exempts /api/peers/self for peer handshake", () => {
    const { nextCalled } = run({
      method: "GET",
      path: "/api/peers/self",
      headers: { host: "127.0.0.1:7471" },
    });
    expect(nextCalled).toBe(true);
  });

  it("allows OPTIONS preflight through to CORS middleware", () => {
    const { nextCalled } = run({
      method: "OPTIONS",
      path: "/api/chat",
      headers: { host: "127.0.0.1:7471", origin: "https://evil.com" },
    });
    expect(nextCalled).toBe(true);
  });

  it("blocks request with empty Host header", () => {
    const { res, nextCalled } = run({
      method: "POST",
      path: "/api/chat",
      headers: {},
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });
});
