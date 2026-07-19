import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const query = vi.fn();
const checkWorkerReadiness = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({ pool: { query, connect: vi.fn() } }),
}));

vi.mock("@sf/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sf/db")>();
  return { ...actual, checkWorkerReadiness };
});

const { GET } = await import("./route.ts");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/mvp/health/ready", () => {
  beforeEach(() => {
    query.mockReset();
    checkWorkerReadiness.mockReset();
    query
      .mockResolvedValueOnce({ rows: [{ one: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ one: 1 }], rowCount: 1 });
  });

  it("includes a live worker lease in the readiness contract", async () => {
    checkWorkerReadiness.mockResolvedValueOnce(true);

    const response = await GET(
      new NextRequest("http://localhost/api/mvp/health/ready"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        status: "ready",
        checks: { database: true, pgbossSchema: true, worker: true },
      },
    });
    expect(checkWorkerReadiness).toHaveBeenCalledTimes(1);
  });

  it("returns dependency unavailable when the queue exists but no worker is live", async () => {
    checkWorkerReadiness.mockResolvedValueOnce(false);

    const response = await GET(
      new NextRequest("http://localhost/api/mvp/health/ready"),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
  });

  it("logs only stable dependency metadata when a readiness probe throws", async () => {
    query.mockReset().mockRejectedValueOnce(
      new Error("database rejected customer-content-secret"),
    );
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const response = await GET(
      new NextRequest("http://localhost/api/mvp/health/ready"),
    );

    expect(response.status).toBe(503);
    const logged = stderr.mock.calls.map(([line]) => String(line)).join("");
    expect(logged).not.toContain("customer-content-secret");
    expect(logged).toContain('"event":"readiness_check_failed"');
    expect(logged).toContain('"code":"DEPENDENCY_UNAVAILABLE"');
    expect(logged).toContain('"type":"dependency"');
  });
});
