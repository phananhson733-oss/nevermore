// @input  -- stubbed Labs envelopes, whole and broken
// @output -- proof a provider error is never read as a measurement, and that
//            an uncredentialled call never leaves the process
// @pos    -- unit coverage for the paid producer behind 9.3

import { describe, expect, it, vi } from "vitest";

import {
  bulkTrafficEstimation,
  labsLanguageForMarket,
} from "./labs-traffic.ts";

const OK = 20_000;

function envelope(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

const sized = (cost: unknown, items: unknown) =>
  envelope({
    status_code: OK,
    cost,
    tasks: [{ status_code: OK, result: [{ items }] }],
  });

const item = (target: string, etv: unknown) => ({
  target,
  metrics: { organic: { etv } },
});

function call(
  response: Response | null,
  overrides: Partial<Parameters<typeof bulkTrafficEstimation>[0]> = {},
) {
  const fetchImpl = vi.fn(async () => {
    if (response === null) throw new Error("the test did not expect a request");
    return response;
  });
  return {
    fetchImpl,
    result: bulkTrafficEstimation({
      login: "user",
      password: "secret",
      targets: ["a.test", "b.test"],
      locationCode: 2840,
      languageCode: "en",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      ...overrides,
    }),
  };
}

describe("bulk traffic estimation", () => {
  it("reads the sizes the provider returned", async () => {
    const { result } = call(
      sized(0.0021, [item("a.test", 4_200), item("b.test", 0)]),
    );

    expect(await result).toEqual({
      rows: [
        { target: "a.test", organicEtv: 4_200 },
        { target: "b.test", organicEtv: 0 },
      ],
      unresolvedTargets: [],
      costUsd: 0.0021,
    });
  });

  it("keeps a domain the provider said nothing about apart from a zero", async () => {
    const { result } = call(sized(0.001, [item("a.test", null)]));
    const value = await result;

    // Null, not 0: reading an unsized domain as zero traffic manufactures the
    // very "low-traffic site on page one" that 9.3 exists to find.
    expect(value?.rows).toEqual([{ target: "a.test", organicEtv: null }]);
    expect(value?.unresolvedTargets).toEqual(["b.test"]);
  });

  describe("a provider error is not a measurement", () => {
    it("refuses an envelope error carried on HTTP 200", async () => {
      const { result } = call(
        envelope({
          status_code: 40_101,
          cost: 0,
          tasks: [{ status_code: 40_101 }],
        }),
      );

      // The defect this exists to prevent: an authorization or balance failure
      // answered with 200 reads as "the provider sized zero domains", and 9.3
      // then publishes a page one where nothing could be measured.
      expect(await result).toBeNull();
    });

    it("refuses an envelope error even when the task claims success", async () => {
      // The envelope and the task carry separate codes and either can fail
      // alone, so this case has to be its own test: with both set to the same
      // error the task check alone catches it and the envelope check is free
      // to be deleted. Mutation-checked — removing the envelope comparison
      // turns this red and nothing else.
      const { result } = call(
        envelope({
          status_code: 40_200,
          cost: 0.002,
          tasks: [
            { status_code: OK, result: [{ items: [item("a.test", 9)] }] },
          ],
        }),
      );

      expect(await result).toBeNull();
    });

    it("refuses a task error under a successful envelope", async () => {
      const { result } = call(
        envelope({
          status_code: OK,
          cost: 0,
          tasks: [{ status_code: 40_501, result: null }],
        }),
      );

      expect(await result).toBeNull();
    });

    it("refuses a response carrying no task at all", async () => {
      const { result } = call(
        envelope({ status_code: OK, cost: 0, tasks: [] }),
      );

      expect(await result).toBeNull();
    });
  });

  describe("cost", () => {
    it("reports an unreadable cost as unknown rather than free", async () => {
      const { result } = call(sized("0.002", [item("a.test", 10)]));

      // A paid call whose cost we cannot read is not a free call. Zero here
      // would balance an invoice that does not balance.
      expect((await result)?.costUsd).toBeNull();
    });

    it("refuses a negative or non-finite cost", async () => {
      expect(
        (await call(sized(-1, [item("a.test", 10)])).result)?.costUsd,
      ).toBeNull();
      expect(
        (await call(sized(Number.NaN, [item("a.test", 10)])).result)?.costUsd,
      ).toBeNull();
    });
  });

  describe("no credential, no request", () => {
    // Three test files reach this producer through `readSerpLandscape` without
    // injecting a fake, and the empty-string default every caller falls back to
    // still builds a well-formed Basic header. On a machine holding the real
    // credentials that is a live billed call from `pnpm test`.
    it("does not fetch when the login is empty", async () => {
      const { fetchImpl, result } = call(null, { login: "" });

      expect(await result).toBeNull();
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("does not fetch when the password is empty", async () => {
      const { fetchImpl, result } = call(null, { password: "   " });

      expect(await result).toBeNull();
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("does not fetch when there is nothing to size", async () => {
      const { fetchImpl, result } = call(null, { targets: [] });

      expect(await result).toBeNull();
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  it("sends the Labs language for the market, never the SERP subtag", () => {
    expect(labsLanguageForMarket("NO")).toBe("nb");
    expect(labsLanguageForMarket("TW")).toBe("zh-TW");
    expect(labsLanguageForMarket("CN")).toBeNull();
  });
});
