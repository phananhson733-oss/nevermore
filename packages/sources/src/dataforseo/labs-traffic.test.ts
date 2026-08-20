import { describe, expect, it } from "vitest";
import {
  bulkTrafficEstimation,
  DATAFORSEO_BULK_TRAFFIC_ESTIMATION_LIVE_URL,
  MAX_DATAFORSEO_BULK_TRAFFIC_TARGETS_PER_TASK,
  normalizeTrafficDomain,
} from "./labs-traffic.ts";

const CREDENTIALS = {
  login: "fixture-login",
  password: "fixture-password",
} as const;

interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
  readonly body: readonly {
    readonly targets: readonly string[];
    readonly location_code: number;
    readonly language_code: string;
  }[];
}

function trafficEnvelope(
  targets: readonly string[],
  cost: number,
  etv: (target: string, index: number) => unknown = (_target, index) => index,
): unknown {
  return {
    status_code: 20_000,
    cost,
    tasks: [
      {
        status_code: 20_000,
        result: [
          {
            items: targets.map((target, index) => ({
              target,
              metrics: { organic: { etv: etv(target, index) } },
            })),
          },
        ],
      },
    ],
  };
}

describe("bulkTrafficEstimation", () => {
  it("chunks 1001 normalized targets deterministically and sums every task cost", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const body = JSON.parse(String(init?.body)) as RecordedCall["body"];
      calls.push({ url: String(input), init, body });
      const targets = body[0]?.targets ?? [];
      return new Response(
        JSON.stringify(
          trafficEnvelope(
            targets,
            calls.length === 1 ? 0.12 : 0.03,
            (_target, index) => (index === 0 ? 0 : index),
          ),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const targets = Array.from(
      { length: 1_001 },
      (_, index) => `site-${index}.com`,
    );

    const result = await bulkTrafficEstimation({
      ...CREDENTIALS,
      targets,
      marketCode: "US",
      locationCode: 2840,
      languageCode: "en",
      fetchImpl,
    });

    expect(MAX_DATAFORSEO_BULK_TRAFFIC_TARGETS_PER_TASK).toBe(1_000);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe(
      DATAFORSEO_BULK_TRAFFIC_ESTIMATION_LIVE_URL,
    );
    expect(calls.map((call) => call.body[0]?.targets.length)).toEqual([
      1_000, 1,
    ]);
    expect(calls[0]?.body[0]).toMatchObject({
      location_code: 2840,
      language_code: "en",
    });
    expect(calls[0]?.body[0]?.targets[0]).toBe("site-0.com");
    expect(calls[1]?.body[0]?.targets[0]).toBe("site-1000.com");
    expect(result?.rows).toHaveLength(1_001);
    expect(result?.rows[0]?.organicEtv).toBe(0);
    expect(result?.rows[1]?.organicEtv).toBe(1);
    expect(result?.costUsd).toBeCloseTo(0.15);
    expect(result?.batchCount).toBe(2);
    expect(result?.unresolvedTargets).toEqual([]);
  });

  it("deduplicates registrable domains but preserves first input identity and unresolved inputs", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const body = JSON.parse(String(init?.body)) as RecordedCall["body"];
      calls.push({ url: String(input), init, body });
      return new Response(
        JSON.stringify(trafficEnvelope(["example.com"], 0.01, () => null)),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await bulkTrafficEstimation({
      ...CREDENTIALS,
      targets: ["WWW.Example.COM.", "news.example.com", "Missing.COM"],
      marketCode: "US",
      locationCode: 2840,
      languageCode: "en",
      fetchImpl,
    });

    expect(calls[0]?.body[0]?.targets).toEqual(["example.com", "missing.com"]);
    expect(result?.rows).toEqual([
      {
        target: "WWW.Example.COM.",
        normalizedTarget: "example.com",
        organicEtv: null,
      },
    ]);
    expect(result?.unresolvedTargets).toEqual(["Missing.COM"]);
  });

  it("keeps a provider zero distinct from a missing or malformed ETV", async () => {
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as RecordedCall["body"];
      const targets = body[0]?.targets ?? [];
      return new Response(
        JSON.stringify(
          trafficEnvelope(targets, 0.01, (_target, index) => {
            if (index === 0) return 0;
            if (index === 1) return null;
            return "0";
          }),
        ),
      );
    };

    const result = await bulkTrafficEstimation({
      ...CREDENTIALS,
      targets: ["zero.com", "missing-value.com", "malformed-value.com"],
      marketCode: "US",
      locationCode: 2840,
      languageCode: "en",
      fetchImpl,
    });

    expect(result?.rows.map((row) => row.organicEtv)).toEqual([0, null, null]);
  });

  it("returns null for the whole lookup when any chunk fails", async () => {
    let calls = 0;
    const bookedCosts: number[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls += 1;
      if (calls === 2) throw new TypeError("offline fixture transport failure");
      const body = JSON.parse(String(init?.body)) as RecordedCall["body"];
      return new Response(
        JSON.stringify(trafficEnvelope(body[0]?.targets ?? [], 0.2)),
      );
    };

    const result = await bulkTrafficEstimation({
      ...CREDENTIALS,
      targets: Array.from(
        { length: 1_001 },
        (_, index) => `failure-${index}.com`,
      ),
      marketCode: "US",
      locationCode: 2840,
      languageCode: "en",
      fetchImpl,
      onCost: (costUsd) => bookedCosts.push(costUsd),
    });

    expect(calls).toBe(2);
    expect(result).toBeNull();
    expect(bookedCosts).toEqual([0.2]);
  });

  it("fails closed before transport when market and Labs language disagree", async () => {
    let called = false;
    const result = await bulkTrafficEstimation({
      ...CREDENTIALS,
      targets: ["example.com"],
      marketCode: "DE",
      locationCode: 2276,
      languageCode: "en",
      fetchImpl: async () => {
        called = true;
        throw new Error("must not run");
      },
    });

    expect(result).toBeNull();
    expect(called).toBe(false);
  });

  it("rejects an underscore hostname before provider transport", async () => {
    let called = false;

    const result = await bulkTrafficEstimation({
      ...CREDENTIALS,
      targets: ["foo_bar.com"],
      marketCode: "US",
      locationCode: 2840,
      languageCode: "en",
      fetchImpl: async () => {
        called = true;
        throw new Error("must not run");
      },
    });

    expect(normalizeTrafficDomain("foo_bar.com")).toBeNull();
    expect(result).toBeNull();
    expect(called).toBe(false);
  });

  it("keeps a private-suffix tenant as the traffic target", () => {
    expect(normalizeTrafficDomain("Foo.GitHub.io")).toBe("foo.github.io");
  });
});
