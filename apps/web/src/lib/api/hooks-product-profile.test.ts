import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addProductProfileCompetitor,
  confirmProductProfile,
  createProductProfileSynthesisRun,
  invalidateProductProfileQueries,
  productProfileQueryKey,
  reviewProductProfileCompetitor,
  updateProductProfileDraft,
} from "./hooks-product-profile";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const CANDIDATE_ID = "00000000-0000-4000-8000-000000000002";

function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Product Profile API boundary", () => {
  it("sends only the strict editable patch body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ id: "profile-row" }));
    vi.stubGlobal("fetch", fetchMock);

    await updateProductProfileDraft(PROJECT_ID, {
      baseVersion: 4,
      patch: {
        productName: "RelayOps",
        targetMarkets: [{ marketCode: "US", priority: "primary" }],
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      baseVersion: 4,
      patch: {
        productName: "RelayOps",
        targetMarkets: [{ marketCode: "US", priority: "primary" }],
      },
    });
    expect(init.headers).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
    });
  });

  it("rejects server-owned or unknown editable fields before sending", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      updateProductProfileDraft(PROJECT_ID, {
        baseVersion: 4,
        patch: {
          productName: "RelayOps",
          sourceSnapshotId: "00000000-0000-4000-8000-000000000009",
        },
      } as never),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mints and forwards a single idempotency key for synthesis", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ok(
        {
          run: { id: "run-1", status: "queued" },
          statusUrl: `/api/mvp/projects/${PROJECT_ID}/runs/run-1`,
          resourceRef: { type: "product_profile_run", id: "run-1" },
        },
        202,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createProductProfileSynthesisRun(
      PROJECT_ID,
      { baseVersion: 4 },
      "profile-idempotency-1",
    );

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(
      `/api/mvp/projects/${PROJECT_ID}/product-profile/synthesis-runs`,
    );
    expect(init.headers).toMatchObject({
      "Idempotency-Key": "profile-idempotency-1",
    });
    expect(JSON.parse(String(init.body))).toEqual({ baseVersion: 4 });
  });

  it("uses exact competitor review, add, and confirm request paths and bodies", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ id: "reviewed" }))
      .mockResolvedValueOnce(ok({ id: "added" }))
      .mockResolvedValueOnce(ok({ id: "confirmed" }));
    vi.stubGlobal("fetch", fetchMock);

    await reviewProductProfileCompetitor(PROJECT_ID, CANDIDATE_ID, {
      baseVersion: 4,
      reviewStatus: "approved",
      relationship: "direct",
      analysisScope: ["positioning", "keyword_gap"],
    });
    await addProductProfileCompetitor(PROJECT_ID, {
      baseVersion: 5,
      name: "GuideCX",
      domain: "guidecx.com",
      relationship: "direct",
      analysisScope: ["positioning"],
    });
    await confirmProductProfile(PROJECT_ID, { baseVersion: 6 });

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      `/api/mvp/projects/${PROJECT_ID}/product-profile/competitors/${CANDIDATE_ID}`,
      `/api/mvp/projects/${PROJECT_ID}/product-profile/competitors`,
      `/api/mvp/projects/${PROJECT_ID}/product-profile/confirm`,
    ]);
    expect(
      fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body))),
    ).toEqual([
      {
        baseVersion: 4,
        reviewStatus: "approved",
        relationship: "direct",
        analysisScope: ["positioning", "keyword_gap"],
      },
      {
        baseVersion: 5,
        name: "GuideCX",
        domain: "guidecx.com",
        relationship: "direct",
        analysisScope: ["positioning"],
      },
      { baseVersion: 6 },
    ]);
  });

  it("invalidates Product Profile, project shell, source truth, and Growth Map after writes", async () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");

    await invalidateProductProfileQueries(client, PROJECT_ID);

    expect(spy.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      productProfileQueryKey(PROJECT_ID),
      ["project", PROJECT_ID],
      ["workspace", PROJECT_ID],
      ["sources", PROJECT_ID],
      ["growth-map", PROJECT_ID],
    ]);
  });
});
