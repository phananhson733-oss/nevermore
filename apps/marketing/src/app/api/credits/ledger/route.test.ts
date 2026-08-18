// @input  -- GET /api/credits/ledger with valid, absent and malformed cursors
// @output -- assertions pinning the page shape, the cursor and the error branches
// @pos    -- guards the history the account page reads

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerAuthenticatedUser: vi.fn(),
  readLedger: vi.fn(),
}));

vi.mock("../../../../lib/auth/server-auth-user.ts", () => ({
  getServerAuthenticatedUser: mocks.getServerAuthenticatedUser,
}));

vi.mock("../../../../lib/credits/credits-store.ts", async () => {
  // decodeLedgerCursor is the parser this route is supposed to reject on, so
  // the real one is used; only the database call is replaced.
  const actual = await vi.importActual<
    typeof import("../../../../lib/credits/credits-store.ts")
  >("../../../../lib/credits/credits-store.ts");
  return {
    decodeLedgerCursor: actual.decodeLedgerCursor,
    readLedger: mocks.readLedger,
  };
});

const { GET } = await import("./route.ts");

const ENTRY = {
  id: "12",
  type: "daily_grant",
  amount: 20,
  balanceAfter: 120,
  toolSlug: null,
  createdAt: "2026-08-17T00:12:03.114Z",
};

function request(query = ""): Request {
  return new Request(`https://gengrowth.ai/api/credits/ledger${query}`);
}

beforeEach(() => {
  vi.stubEnv("MARKETING_CREDITS_ENABLED", "true");
  mocks.getServerAuthenticatedUser.mockResolvedValue({
    status: "authenticated",
    userId: "user-1",
  });
  mocks.readLedger.mockResolvedValue({
    kind: "ok",
    value: { entries: [ENTRY], nextCursor: "2026-08-17T00:12:03.114Z|12" },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("GET /api/credits/ledger", () => {
  it("is not there at all while the feature is switched off", async () => {
    vi.stubEnv("MARKETING_CREDITS_ENABLED", "");

    const response = await GET(request());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "credits_disabled" },
    });
    expect(mocks.getServerAuthenticatedUser).not.toHaveBeenCalled();
  });

  it("answers 401 for a visitor who is not signed in", async () => {
    mocks.getServerAuthenticatedUser.mockResolvedValue({
      status: "unauthenticated",
    });

    const response = await GET(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "auth_required" },
    });
    expect(mocks.readLedger).not.toHaveBeenCalled();
  });

  it("answers 503 when auth itself cannot answer", async () => {
    mocks.getServerAuthenticatedUser.mockResolvedValue({
      status: "unavailable",
    });

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "auth_unavailable" },
    });
  });

  it("returns one page of history and the cursor that continues it", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        entries: [ENTRY],
        nextCursor: "2026-08-17T00:12:03.114Z|12",
      },
    });
  });

  it("reads only this user's history, a fixed page at a time", async () => {
    await GET(request());

    expect(mocks.readLedger).toHaveBeenCalledWith("user-1", {
      limit: 25,
      cursor: null,
    });
  });

  /**
   * The page size is ours, not the caller's. A `limit` in the query string
   * would let anyone turn one request into a full-table read.
   */
  it("ignores a limit the caller asked for", async () => {
    await GET(request("?limit=5000"));

    expect(mocks.readLedger).toHaveBeenCalledWith("user-1", {
      limit: 25,
      cursor: null,
    });
  });

  it("continues from a cursor the previous page handed out", async () => {
    await GET(request("?cursor=2026-08-17T00%3A12%3A03.114Z%7C12"));

    expect(mocks.readLedger).toHaveBeenCalledWith("user-1", {
      limit: 25,
      cursor: { createdAt: "2026-08-17T00:12:03.114Z", id: "12" },
    });
  });

  it("treats an empty cursor as the first page rather than an error", async () => {
    const response = await GET(request("?cursor="));

    expect(response.status).toBe(200);
    expect(mocks.readLedger).toHaveBeenCalledWith("user-1", {
      limit: 25,
      cursor: null,
    });
  });

  /**
   * Silently restarting from the top would look like the history had been
   * truncated. 400 says which half of the contract broke.
   */
  it("answers 400 for a cursor it cannot parse", async () => {
    for (const cursor of ["nonsense", "2026-08-17T00:12:03.114Z|abc", "|12"]) {
      const response = await GET(
        request(`?cursor=${encodeURIComponent(cursor)}`),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: { code: "invalid_cursor" },
      });
    }
    expect(mocks.readLedger).not.toHaveBeenCalled();
  });

  /**
   * Regression: ISSUE-001 — a cursor whose timestamp half Date.parse accepts but
   * PostgreSQL does not reached the database and came back 503.
   * Found by /qa on 2026-08-17 against production: `?cursor=1|1`, `2|9` and
   * `2001|1` each answered `credits_unavailable`, reporting a caller's typo as
   * our outage and spending a failed transaction to do it.
   * Report: .gstack/qa-reports/qa-report-gengrowth-ai-2026-08-17.md
   */
  it("answers 400, not 503, for a timestamp only Date.parse would accept", async () => {
    // Date.parse reads "1" as 2001-01-01 and "2026" as that whole year;
    // PostgreSQL reads neither as a timestamptz.
    for (const cursor of ["1|1", "2|9", "2001|1", "2026-08|3", "12:30|4"]) {
      const response = await GET(
        request(`?cursor=${encodeURIComponent(cursor)}`),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: { code: "invalid_cursor" },
      });
    }
    expect(mocks.readLedger).not.toHaveBeenCalled();
  });

  /** The shapes PostgreSQL actually prints have to keep working. */
  it("still accepts the cursor shapes the ledger itself hands out", async () => {
    for (const cursor of [
      "2026-08-17T12:52:41.179013+00:00|2",
      "2026-08-17T00:12:03.114Z|12",
      "2026-08-17T00:12:03Z|12",
    ]) {
      mocks.readLedger.mockClear();
      const response = await GET(
        request(`?cursor=${encodeURIComponent(cursor)}`),
      );

      expect(response.status).toBe(200);
      expect(mocks.readLedger).toHaveBeenCalledWith("user-1", {
        limit: 25,
        cursor: {
          createdAt: cursor.slice(0, cursor.lastIndexOf("|")),
          id: cursor.slice(cursor.lastIndexOf("|") + 1),
        },
      });
    }
  });

  it("answers 503 when the credits tables are not there yet", async () => {
    mocks.readLedger.mockResolvedValue({
      kind: "unavailable",
      reason: "store_missing",
    });

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "credits_unavailable" },
    });
  });

  it("answers 503 rather than an empty page when the store contradicts itself", async () => {
    mocks.readLedger.mockResolvedValue({ kind: "missing" });

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "credits_unavailable" },
    });
  });

  it("keeps every answer, including the failures, off every cache", async () => {
    const responses = [
      await GET(request()),
      await GET(request("?cursor=nonsense")),
    ];

    mocks.getServerAuthenticatedUser.mockResolvedValue({
      status: "unauthenticated",
    });
    responses.push(await GET(request()));

    vi.stubEnv("MARKETING_CREDITS_ENABLED", "");
    responses.push(await GET(request()));

    for (const response of responses) {
      expect(response.headers.get("cache-control")).toBe("no-store, private");
    }
  });
});
