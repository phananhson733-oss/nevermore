import { describe, expect, it, vi } from "vitest";
import {
  GEO_EVIDENCE_OBSERVATION_TTL_MS,
  geoEvidenceGscKey,
  geoEvidenceTtlMs,
  isObservationFresh,
  parseGeoEvidenceObservation,
  readLatestObservation,
  recordObservation,
  type GeoEvidenceObservation,
} from "./kb-evidence-observations.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WEBSITE_ID = "22222222-2222-4222-8222-222222222222";
const OBSERVATION_ID = "33333333-3333-4333-8333-333333333333";
const BODY_HASH = "a".repeat(64);
const DAY_MS = 24 * 60 * 60 * 1000;

function storedRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: "marketing-website-evidence-observation.v1",
    observationId: OBSERVATION_ID,
    websiteId: WEBSITE_ID,
    kind: "own_page",
    url: "https://acme.test/pricing",
    observedAt: "2026-09-07T00:00:00.000Z",
    status: "ok",
    statusReason: null,
    bodyHash: BODY_HASH,
    excerpts: ["Pricing starts at 19 USD."],
    structured: { jsonLdTypes: ["Product"] },
    independence: null,
    ...overrides,
  };
}

function observation(observedAt: string): GeoEvidenceObservation {
  return parseGeoEvidenceObservation(storedRow({ observedAt }));
}

describe("observation freshness", () => {
  const now = new Date("2026-09-07T12:00:00.000Z");

  it("reuses an observation inside the TTL", () => {
    expect(
      isObservationFresh(observation("2026-09-07T00:00:00.000Z"), now, DAY_MS),
    ).toBe(true);
  });

  it("re-observes once the TTL has elapsed", () => {
    expect(
      isObservationFresh(observation("2026-09-06T11:00:00.000Z"), now, DAY_MS),
    ).toBe(false);
  });

  it("treats the exact TTL boundary as expired so a daily cadence does not drift", () => {
    expect(
      isObservationFresh(observation("2026-09-06T12:00:00.000Z"), now, DAY_MS),
    ).toBe(false);
  });

  it("does not let a future observation suppress a fetch", () => {
    expect(
      isObservationFresh(observation("2026-09-08T00:00:00.000Z"), now, DAY_MS),
    ).toBe(false);
  });

  it("refuses to answer from an undatable observation or a nonsense TTL", () => {
    expect(isObservationFresh({ observedAt: "not a date" }, now, DAY_MS)).toBe(
      false,
    );
    expect(
      isObservationFresh(observation("2026-09-07T00:00:00.000Z"), now, 0),
    ).toBe(false);
    expect(
      isObservationFresh(
        observation("2026-09-07T00:00:00.000Z"),
        now,
        Number.NaN,
      ),
    ).toBe(false);
  });

  it("puts own site, competitors and off-site evidence on the same 24h TTL", () => {
    expect(geoEvidenceTtlMs("own_page")).toBe(DAY_MS);
    expect(geoEvidenceTtlMs("competitor_page")).toBe(DAY_MS);
    expect(geoEvidenceTtlMs("third_party")).toBe(DAY_MS);
    expect(
      Object.values(GEO_EVIDENCE_OBSERVATION_TTL_MS).every(
        (ttl) => ttl === DAY_MS,
      ),
    ).toBe(true);
  });
});

describe("GSC observation identity", () => {
  it("keys on the property and the exact window", () => {
    expect(
      geoEvidenceGscKey({
        property: "sc-domain:acme.test",
        windowStart: "2026-06-09",
        windowEnd: "2026-09-06",
      }),
    ).toBe("sc-domain:acme.test#2026-06-09..2026-09-06");
  });

  it("refuses input that would make two windows look like one observation", () => {
    const window = { windowStart: "2026-06-09", windowEnd: "2026-09-06" };
    expect(geoEvidenceGscKey({ property: "acme#test", ...window })).toBeNull();
    expect(geoEvidenceGscKey({ property: "  ", ...window })).toBeNull();
    expect(
      geoEvidenceGscKey({
        property: "acme.test",
        windowStart: "2026-6-9",
        windowEnd: "2026-09-06",
      }),
    ).toBeNull();
    expect(
      geoEvidenceGscKey({
        property: "acme.test",
        windowStart: "2026-09-06",
        windowEnd: "2026-06-09",
      }),
    ).toBeNull();
  });
});

describe("reading the latest observation", () => {
  it("returns the stored observation for one exact (kind, url)", async () => {
    const callRpc = vi.fn(async () => ({
      data: [{ outcome: "found", observation: storedRow() }],
      error: null,
    }));
    const result = await readLatestObservation(
      {
        userId: USER_ID,
        websiteId: WEBSITE_ID,
        kind: "own_page",
        url: "https://acme.test/pricing",
      },
      { callRpc },
    );
    expect(result).toMatchObject({ kind: "ok" });
    expect(callRpc).toHaveBeenCalledWith(
      "marketing_website_read_latest_evidence_observation",
      {
        p_user_id: USER_ID,
        p_website_id: WEBSITE_ID,
        p_kind: "own_page",
        p_url: "https://acme.test/pricing",
      },
    );
  });

  it("separates never observed from not owned", async () => {
    const none = vi.fn(async () => ({
      data: [{ outcome: "none", observation: null }],
      error: null,
    }));
    expect(
      await readLatestObservation(
        {
          userId: USER_ID,
          websiteId: WEBSITE_ID,
          kind: "robots",
          url: "https://acme.test/robots.txt",
        },
        { callRpc: none },
      ),
    ).toEqual({ kind: "ok", value: null });

    const notFound = vi.fn(async () => ({
      data: [{ outcome: "not_found", observation: null }],
      error: null,
    }));
    expect(
      await readLatestObservation(
        {
          userId: USER_ID,
          websiteId: WEBSITE_ID,
          kind: "robots",
          url: "https://acme.test/robots.txt",
        },
        { callRpc: notFound },
      ),
    ).toEqual({ kind: "missing" });
  });

  it("does not report a store outage as an absent observation", async () => {
    const callRpc = vi.fn(async () => ({
      data: null,
      error: { message: "boom" },
    }));
    expect(
      await readLatestObservation(
        {
          userId: USER_ID,
          websiteId: WEBSITE_ID,
          kind: "own_page",
          url: "https://acme.test/",
        },
        { callRpc },
      ),
    ).toEqual({ kind: "unavailable" });
  });

  it("refuses a row that answers a different question", async () => {
    const callRpc = vi.fn(async () => ({
      data: [
        {
          outcome: "found",
          observation: storedRow({ url: "https://other.test/" }),
        },
      ],
      error: null,
    }));
    expect(
      await readLatestObservation(
        {
          userId: USER_ID,
          websiteId: WEBSITE_ID,
          kind: "own_page",
          url: "https://acme.test/pricing",
        },
        { callRpc },
      ),
    ).toEqual({ kind: "unavailable" });
  });

  it("never reaches the store with an unusable selector", async () => {
    const callRpc = vi.fn();
    expect(
      await readLatestObservation(
        {
          userId: "not-a-uuid",
          websiteId: WEBSITE_ID,
          kind: "own_page",
          url: "https://acme.test/",
        },
        { callRpc },
      ),
    ).toEqual({ kind: "invalid", code: "invalid_input" });
    expect(callRpc).not.toHaveBeenCalled();
  });
});

describe("observation parsing", () => {
  it("refuses an unavailable observation that carries content", () => {
    expect(() =>
      parseGeoEvidenceObservation(
        storedRow({
          status: "unavailable",
          statusReason: "timeout",
          bodyHash: null,
          structured: {},
        }),
      ),
    ).toThrow();
  });

  it("refuses independence outside the third-party scope, in both directions", () => {
    expect(() =>
      parseGeoEvidenceObservation(storedRow({ independence: "independent" })),
    ).toThrow();
    expect(() =>
      parseGeoEvidenceObservation(
        storedRow({ kind: "third_party", independence: null }),
      ),
    ).toThrow();
  });

  it("keeps structured keys it does not know and checks the ones it does", () => {
    const parsed = parseGeoEvidenceObservation(
      storedRow({
        structured: { jsonLdTypes: ["FAQPage"], somethingNewer: { a: 1 } },
      }),
    );
    expect(
      parsed.status.kind === "ok" && parsed.status.structured.somethingNewer,
    ).toEqual({ a: 1 });
    expect(() =>
      parseGeoEvidenceObservation(
        storedRow({ structured: { jsonLdTypes: "FAQPage" } }),
      ),
    ).toThrow();
  });
});

describe("appending an observation", () => {
  const target = {
    userId: USER_ID,
    websiteId: WEBSITE_ID,
    kind: "own_page",
    url: "https://acme.test/pricing",
  } as const;
  const ok = {
    kind: "ok",
    bodyHash: BODY_HASH,
    excerpts: ["Pricing starts at 19 USD."],
    structured: {},
  } as const;

  it("appends a new row when the body has not changed at all", async () => {
    const callRpc = vi.fn(
      async (_name: string, params: Record<string, unknown>) => ({
        data: [
          {
            outcome: "recorded",
            observation: storedRow({
              observedAt: params.p_observed_at,
              excerpts: ["Pricing starts at 19 USD."],
              structured: {},
            }),
          },
        ],
        error: null,
      }),
    );
    const first = await recordObservation(
      { ...target, observedAt: "2026-09-05T00:00:00.000Z", status: ok },
      { callRpc },
    );
    const second = await recordObservation(
      { ...target, observedAt: "2026-09-07T00:00:00.000Z", status: ok },
      { callRpc },
    );

    expect(first).toMatchObject({ kind: "ok" });
    expect(second).toMatchObject({ kind: "ok" });
    // Two identical bodies, two rows, two distinct observation times. Nothing
    // in this module can update the first row's timestamp to today.
    expect(callRpc).toHaveBeenCalledTimes(2);
    expect(callRpc.mock.calls.map((call) => call[1].p_observed_at)).toEqual([
      "2026-09-05T00:00:00.000Z",
      "2026-09-07T00:00:00.000Z",
    ]);
    expect(
      callRpc.mock.calls.every(
        (call) => call[0] === "marketing_website_record_evidence_observation",
      ),
    ).toBe(true);
    expect(
      callRpc.mock.calls.every((call) => call[1].p_body_hash === BODY_HASH),
    ).toBe(true);
  });

  it("sends an unavailable observation with no body and no content", async () => {
    const callRpc = vi.fn(
      async (_name: string, _params: Record<string, unknown>) => ({
        data: [
          {
            outcome: "recorded",
            observation: storedRow({
              status: "unavailable",
              statusReason: "timeout",
              bodyHash: null,
              excerpts: [],
              structured: {},
            }),
          },
        ],
        error: null,
      }),
    );
    expect(
      await recordObservation(
        {
          ...target,
          observedAt: "2026-09-07T00:00:00.000Z",
          status: { kind: "unavailable", reason: "timeout" },
        },
        { callRpc },
      ),
    ).toMatchObject({ kind: "ok" });
    expect(callRpc.mock.calls[0]?.[1]).toMatchObject({
      p_status: "unavailable",
      p_status_reason: "timeout",
      p_body_hash: null,
      p_excerpts: [],
      p_structured: {},
    });
  });

  it("refuses to store a gate refusal as evidence about the site", async () => {
    const callRpc = vi.fn();
    expect(
      await recordObservation(
        {
          ...target,
          observedAt: "2026-09-07T00:00:00.000Z",
          status: { kind: "unavailable", reason: "rate_limited" as never },
        },
        { callRpc },
      ),
    ).toEqual({ kind: "invalid", code: "unrecordable_status" });
    expect(callRpc).not.toHaveBeenCalled();
  });

  it("keeps independence a third-party judgement", async () => {
    const callRpc = vi.fn();
    expect(
      await recordObservation(
        {
          ...target,
          observedAt: "2026-09-07T00:00:00.000Z",
          status: ok,
          independence: "independent",
        },
        { callRpc },
      ),
    ).toEqual({ kind: "invalid", code: "invalid_observation" });
    expect(
      await recordObservation(
        {
          ...target,
          kind: "third_party",
          observedAt: "2026-09-07T00:00:00.000Z",
          status: ok,
        },
        { callRpc },
      ),
    ).toEqual({ kind: "invalid", code: "invalid_observation" });
    expect(callRpc).not.toHaveBeenCalled();
  });

  it("treats a repeated append of the same observation as success", async () => {
    const callRpc = vi.fn(async () => ({
      data: [
        {
          outcome: "duplicate",
          observation: storedRow({
            excerpts: ["Pricing starts at 19 USD."],
            structured: {},
          }),
        },
      ],
      error: null,
    }));
    expect(
      await recordObservation(
        { ...target, observedAt: "2026-09-07T00:00:00.000Z", status: ok },
        { callRpc },
      ),
    ).toMatchObject({ kind: "ok" });
  });

  it("maps a refused write to invalid and an outage to unavailable", async () => {
    const refused = vi.fn(async () => ({
      data: [{ outcome: "invalid", observation: null }],
      error: null,
    }));
    expect(
      await recordObservation(
        { ...target, observedAt: "2026-09-07T00:00:00.000Z", status: ok },
        { callRpc: refused },
      ),
    ).toEqual({ kind: "invalid", code: "invalid_observation" });

    const down = vi.fn(async () => ({
      data: null,
      error: { message: "boom" },
    }));
    expect(
      await recordObservation(
        { ...target, observedAt: "2026-09-07T00:00:00.000Z", status: ok },
        { callRpc: down },
      ),
    ).toEqual({ kind: "unavailable" });
  });
});
