import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined) }),
}));

const gate = await import("./access-gate");

describe("agent access gate", () => {
  beforeEach(() => {
    cookieJar.clear();
    vi.stubEnv("ASSISTANT_ACCESS_CODE", "K7P3XQ9M2A");
    vi.stubEnv("ASSISTANT_SERVICE_SECRET", "test-secret");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("stays locked without a configured code", async () => {
    vi.stubEnv("ASSISTANT_ACCESS_CODE", "");
    expect(gate.checkAccessCode("u0", "anything")).toEqual({ ok: false, reason: "not_configured" });
    cookieJar.set(gate.AGENT_ACCESS_COOKIE, gate.accessToken("u0"));
    expect(await gate.hasAgentAccess("u0")).toBe(false);
  });

  it("accepts the right code and rejects a wrong one", () => {
    expect(gate.checkAccessCode("u1", " K7P3XQ9M2A ")).toEqual({ ok: true });
    expect(gate.checkAccessCode("u1", "WRONG")).toEqual({ ok: false, reason: "wrong" });
  });

  it("blocks after five wrong codes, even with the right one", () => {
    for (let i = 0; i < 5; i += 1) expect(gate.checkAccessCode("u2", `bad${i}`).ok).toBe(false);
    expect(gate.checkAccessCode("u2", "K7P3XQ9M2A")).toEqual({ ok: false, reason: "too_many" });
  });

  it("binds the cookie to the user and to the current code", async () => {
    cookieJar.set(gate.AGENT_ACCESS_COOKIE, gate.accessToken("u3"));
    expect(await gate.hasAgentAccess("u3")).toBe(true);
    expect(await gate.hasAgentAccess("someone-else")).toBe(false);
    vi.stubEnv("ASSISTANT_ACCESS_CODE", "NEWCODE123");
    expect(await gate.hasAgentAccess("u3")).toBe(false);
  });
});
