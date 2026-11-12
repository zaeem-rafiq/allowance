// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));

describe("/api/health", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("ALLOWANCE_TEST_MODE", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("holds only true and false values", async () => {
    const { GET } = await import("./route");
    const body = (await (await GET()).json()) as Record<string, unknown>;
    expect(Object.keys(body).length).toBeGreaterThan(0);
    for (const value of Object.values(body)) expect(typeof value).toBe("boolean");
    expect(body.database).toBe(true);
  });

  it("reports the database as false when it cannot be reached", async () => {
    vi.doMock("@/lib/db", () => ({
      getDb: async () => {
        throw new Error("unreachable");
      },
    }));
    const { healthReport } = await import("@/lib/health");
    const report = await healthReport();
    expect(report.database).toBe(false);
    expect(report.paypalSaved).toBe(false);
    vi.doUnmock("@/lib/db");
  });
});
