import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const query = vi.fn();
const checkWorkerReadiness = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    pool: {
      query,
      connect: vi.fn(),
      options: { max: 3 },
      totalCount: 2,
      idleCount: 1,
      waitingCount: 0,
    },
  }),
}));

vi.mock("@sf/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sf/db")>();
  return { ...actual, checkWorkerReadiness };
});

const { LATEST_APP_MIGRATION } = await import("@sf/db");
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
      .mockResolvedValueOnce({
        rows: [{ migration_version: LATEST_APP_MIGRATION }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ one: 1 }], rowCount: 1 });
  });

  it("includes a live worker lease in the readiness contract", async () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    checkWorkerReadiness.mockResolvedValueOnce(true);

    const response = await GET(
      new NextRequest("http://localhost/api/mvp/health/ready"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        status: "ready",
        checks: {
          database: true,
          migration: true,
          pgbossSchema: true,
          worker: true,
        },
      },
    });
    expect(checkWorkerReadiness).toHaveBeenCalledTimes(1);
    const logged = stdout.mock.calls.map(([line]) => String(line)).join("");
    expect(logged).toContain('"event":"db_pool_snapshot"');
    expect(logged).toContain('"event":"db_migration_version"');
    expect(logged).toContain(
      `"migrationVersion":"${LATEST_APP_MIGRATION}"`,
    );
    expect(logged).toContain('"max":3');
    expect(logged).toContain('"active":1');
    expect(logged).toContain('"waiting":0');
  });

  it("names the dependency that failed instead of only saying something did", async () => {
    // A redacted 503 costs an incident: on 2026-08-04 finding out *which* of the
    // four checks was down needed elimination plus a direct production query.
    // The 200 response already publishes these names, so naming the failed one
    // discloses nothing new.
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    query
      .mockReset()
      .mockResolvedValueOnce({ rows: [{ one: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ migration_version: "0005_stale" }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ one: 1 }], rowCount: 1 });
    checkWorkerReadiness.mockResolvedValueOnce(true);

    const response = await GET(
      new NextRequest("http://localhost/api/mvp/health/ready"),
    );
    const body = (await response.json()) as { readonly detail: string };

    expect(response.status).toBe(503);
    expect(body.detail).toContain("migration");
    // Only the failing check is named; the healthy ones stay out of it.
    expect(body.detail).not.toContain("worker");
    expect(body.detail).not.toContain("pgbossSchema");
    // The stale version itself is schema detail and must not leak.
    expect(body.detail).not.toContain("0005_stale");
  });

  it("names every failed dependency when more than one is down", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    query
      .mockReset()
      .mockResolvedValueOnce({ rows: [{ one: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ migration_version: "0005_stale" }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const response = await GET(
      new NextRequest("http://localhost/api/mvp/health/ready"),
    );
    const body = (await response.json()) as { readonly detail: string };

    expect(response.status).toBe(503);
    expect(body.detail).toContain("migration");
    expect(body.detail).toContain("pgbossSchema");
    // worker was never reached, so it is unknown rather than failed.
    expect(body.detail).not.toContain("worker");
    expect(checkWorkerReadiness).not.toHaveBeenCalled();
  });

  it("blames no dependency when the probe never reached one", async () => {
    // The first query throws, so nothing was actually contacted. Reporting
    // "database" as failed would be a guess; the honest answer is that the
    // probe did not complete.
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    query.mockReset().mockRejectedValueOnce(new Error("connection refused"));

    const response = await GET(
      new NextRequest("http://localhost/api/mvp/health/ready"),
    );
    const body = (await response.json()) as { readonly detail: string };

    expect(response.status).toBe(503);
    expect(body.detail).toContain("did not complete");
    expect(body.detail).not.toContain("database");
    expect(body.detail).not.toContain("connection refused");
  });

  it("returns dependency unavailable when the queue exists but no worker is live", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
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

  it("fails readiness when the database migration identity is stale", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    query.mockReset()
      .mockResolvedValueOnce({ rows: [{ one: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ migration_version: "0005_stale" }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ one: 1 }], rowCount: 1 });
    checkWorkerReadiness.mockResolvedValueOnce(true);

    const response = await GET(
      new NextRequest("http://localhost/api/mvp/health/ready"),
    );

    expect(response.status).toBe(503);
    expect(checkWorkerReadiness).toHaveBeenCalledTimes(1);
  });

  it("logs only stable dependency metadata when a readiness probe throws", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
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
