import { SERP_DEPTH } from "@sf/public-tools/content-brief/constants";
import type { DataForSeoSerpPeopleAlsoAsk } from "@sf/sources/dataforseo/keyword-metrics";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ContentBriefSerpInputError,
  readContentBriefSerp,
} from "./content-brief-serp.ts";
import { SERP_LOCATIONS } from "./serp-markets.ts";

const COST_USD = 0.002;

function providerRow(rank: number) {
  return {
    rankGroup: rank,
    domain: `site${rank}.test`,
    sitelinkCount: 0,
    title: rank % 2 === 0 ? `Title ${rank}` : null,
    url: rank === 3 ? null : `https://site${rank}.test/page-${rank}`,
  };
}

function providerRows(count: number) {
  return Array.from({ length: count }, (_, index) => providerRow(index + 1));
}

function clientReturning(
  rows: readonly unknown[],
  itemTypes: unknown = null,
  unresolvedItemCount = 0,
  peopleAlsoAsk?: DataForSeoSerpPeopleAlsoAsk,
) {
  const serpOrganic = vi.fn(async () => ({
    keyword: "birth chart",
    rows,
    itemTypes,
    aiOverview: null,
    communityItems: null,
    unresolvedItemCount,
    costUsd: COST_USD,
    providerStatusCode: 20_000,
    taskStatusCode: 20_000,
    ...(peopleAlsoAsk === undefined ? {} : { peopleAlsoAsk }),
  }));
  return { serpOrganic, client: { serpOrganic } as never };
}

function clientThrowing(error: unknown) {
  const serpOrganic = vi.fn(async () => {
    throw error;
  });
  return { serpOrganic, client: { serpOrganic } as never };
}

function input(overrides: Partial<Parameters<typeof readContentBriefSerp>[0]> = {}) {
  return {
    keyword: "birth chart",
    market: "US",
    language: "en",
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe("readContentBriefSerp", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks for exactly SERP_DEPTH rows and maps rank / url / domain / title verbatim", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { client, serpOrganic } = clientReturning(providerRows(SERP_DEPTH), [
      "organic",
      "people_also_ask",
    ]);
    const signal = new AbortController().signal;

    const result = await readContentBriefSerp(
      input({ market: "us", language: "en-US", signal }),
      { client },
    );

    expect(serpOrganic).toHaveBeenCalledTimes(1);
    expect(serpOrganic).toHaveBeenCalledWith(
      {
        keyword: "birth chart",
        locationCode: SERP_LOCATIONS["US"],
        languageCode: "en",
        depth: SERP_DEPTH,
      },
      signal,
    );
    expect(result.reads).toEqual({
      status: "complete",
      requested: SERP_DEPTH,
      returned: SERP_DEPTH,
      unresolved: 0,
    });
    expect(result.rows).toHaveLength(SERP_DEPTH);
    expect(result.rows[0]).toEqual({
      rank: 1,
      url: "https://site1.test/page-1",
      domain: "site1.test",
      title: null,
    });
    // A provider row without a URL stays null: it is skipped downstream, not guessed.
    expect(result.rows[2]).toMatchObject({ rank: 3, url: null });
    expect(result.rows[1]).toMatchObject({ title: "Title 2" });
    expect(result.itemTypes).toEqual(["organic", "people_also_ask"]);
    expect(result.costUsd).toBe(COST_USD);
  });

  it("reports fewer rows than requested as partial, with both numbers", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const returned = SERP_DEPTH - 3;
    const { client } = clientReturning(providerRows(returned));

    const result = await readContentBriefSerp(input(), { client });

    expect(result.reads).toEqual({
      status: "partial",
      requested: SERP_DEPTH,
      returned,
      unresolved: 0,
    });
    expect(result.rows).toHaveLength(returned);
    expect(result.itemTypes).toBeNull();
  });

  it("reports a full page with unresolved provider items as partial, counting them apart from rows", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const unresolved = 2;
    const { client } = clientReturning(providerRows(SERP_DEPTH), null, unresolved);

    const result = await readContentBriefSerp(input(), { client });

    expect(result.reads).toEqual({
      status: "partial",
      requested: SERP_DEPTH,
      returned: SERP_DEPTH,
      unresolved,
    });
    // Unresolved items never become rows: there is no rank or domain to give them.
    expect(result.rows).toHaveLength(SERP_DEPTH);
  });

  it("reports an empty page as insufficient_evidence, never as an empty complete read", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { client } = clientReturning([]);

    const result = await readContentBriefSerp(input(), { client });

    expect(result.reads).toEqual({
      status: "unavailable",
      reason: "insufficient_evidence",
      attempted: SERP_DEPTH,
    });
    expect(result.rows).toEqual([]);
    // The provider answered, so the charge is known even though nothing came back.
    expect(result.costUsd).toBe(COST_USD);
  });

  it("reports an empty page whose rows were all unresolved as provider_error, not as no results", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const unresolved = 3;
    const { client } = clientReturning([], null, unresolved);

    const result = await readContentBriefSerp(input(), { client });

    expect(result.reads).toEqual({
      status: "unavailable",
      reason: "provider_error",
      attempted: SERP_DEPTH,
    });
    expect(result.rows).toEqual([]);
    expect(result.costUsd).toBe(COST_USD);
    // The Unavailable branch has no slot for the count, so the log carries it.
    expect(info.mock.calls[0]?.[0]).toContain(`unresolved=${unresolved}`);
  });

  it("reports an aborted request as timeout", async () => {
    const controller = new AbortController();
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const { client } = clientThrowing(abortError);
    controller.abort();

    const result = await readContentBriefSerp(
      input({ signal: controller.signal }),
      { client },
    );

    expect(result.reads).toEqual({
      status: "unavailable",
      reason: "timeout",
      attempted: SERP_DEPTH,
    });
    expect(result.costUsd).toBeNull();
    expect(result.itemTypes).toBeNull();
  });

  it("reads the client's own TIMEOUT code as timeout even when the signal is still live", async () => {
    const timeout = Object.assign(new Error("DataForSEO serp-organic request was aborted or timed out."), {
      code: "TIMEOUT",
    });
    const { client } = clientThrowing(timeout);

    const result = await readContentBriefSerp(input(), { client });

    expect(result.reads).toMatchObject({ status: "unavailable", reason: "timeout" });
  });

  it("reports any other failure as provider_error without throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client } = clientThrowing(new Error("HTTP 503"));

    const result = await readContentBriefSerp(input(), { client });

    expect(result.reads).toEqual({
      status: "unavailable",
      reason: "provider_error",
      attempted: SERP_DEPTH,
    });
    expect(result.rows).toEqual([]);
    expect(result.costUsd).toBeNull();
  });

  it("refuses an unsupported market before any request is made", async () => {
    const { client, serpOrganic } = clientReturning(providerRows(SERP_DEPTH));

    await expect(
      readContentBriefSerp(input({ market: "XX" }), { client }),
    ).rejects.toMatchObject({
      name: "ContentBriefSerpInputError",
      code: "unsupported_market",
    });
    expect(serpOrganic).not.toHaveBeenCalled();
  });

  it("refuses an unsupported language before any request is made", async () => {
    const { client, serpOrganic } = clientReturning(providerRows(SERP_DEPTH));

    const attempt = readContentBriefSerp(input({ language: "zz" }), { client });

    await expect(attempt).rejects.toBeInstanceOf(ContentBriefSerpInputError);
    await expect(attempt).rejects.toMatchObject({ code: "unsupported_language" });
    expect(serpOrganic).not.toHaveBeenCalled();
  });

  it("reports the provider's charge through onCost and one paid_call log line", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const onCost = vi.fn();
    const { client } = clientReturning(providerRows(SERP_DEPTH));

    await readContentBriefSerp(input(), { client, onCost });

    expect(onCost).toHaveBeenCalledTimes(1);
    expect(onCost).toHaveBeenCalledWith(COST_USD);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]?.[0]).toContain(
      `[content-brief] paid_call provider=dataforseo cost_usd=${COST_USD}`,
    );
    expect(info.mock.calls[0]?.[0]).toContain("unresolved=0");
  });

  describe("People Also Ask opt-in", () => {
    const retainedPaa: DataForSeoSerpPeopleAlsoAsk = {
      status: "partial",
      items: [
        { question: "How do I read a birth chart?", seedQuestion: "What is a birth chart?" },
        { question: "如何读懂星盘？", seedQuestion: null },
        { question: "How do I read a birth chart?", seedQuestion: "What is a birth chart?" },
      ],
      unreadableItems: 2,
      unreadableBlocks: 3,
      truncatedItems: 4,
    };

    it("retains provider text, order, duplicates and counts from the one existing call", async () => {
      const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
      const onCost = vi.fn();
      const { client, serpOrganic } = clientReturning(
        providerRows(SERP_DEPTH), ["organic", "people_also_ask"], 1, retainedPaa,
      );
      const signal = new AbortController().signal;

      const result = await readContentBriefSerp(
        input({ includePeopleAlsoAsk: true, signal }), { client, onCost },
      );

      expect(serpOrganic).toHaveBeenCalledTimes(1);
      expect(serpOrganic).toHaveBeenCalledWith({
        keyword: "birth chart",
        locationCode: SERP_LOCATIONS["US"],
        languageCode: "en",
        depth: SERP_DEPTH,
        includePeopleAlsoAsk: true,
      }, signal);
      expect(result.peopleAlsoAsk).toBe(retainedPaa);
      expect(result.reads).toEqual({
        status: "partial", requested: SERP_DEPTH, returned: SERP_DEPTH, unresolved: 1,
      });
      expect(result.costUsd).toBe(COST_USD);
      expect(onCost).toHaveBeenCalledExactlyOnceWith(COST_USD);
      expect(info).toHaveBeenCalledTimes(1);
    });

    it.each([undefined, false] as const)("keeps the exact legacy request and output when opt-in is %s", async (includePeopleAlsoAsk) => {
      vi.spyOn(console, "info").mockImplementation(() => undefined);
      const { client, serpOrganic } = clientReturning(
        providerRows(1), ["organic", "people_also_ask"], 0, retainedPaa,
      );
      const request = input(includePeopleAlsoAsk === undefined ? {} : { includePeopleAlsoAsk });

      const result = await readContentBriefSerp(request, { client });

      expect(serpOrganic).toHaveBeenCalledExactlyOnceWith({
        keyword: "birth chart",
        locationCode: SERP_LOCATIONS["US"],
        languageCode: "en",
        depth: SERP_DEPTH,
      }, request.signal);
      expect(result).toEqual({
        rows: [{ rank: 1, url: "https://site1.test/page-1", domain: "site1.test", title: null }],
        reads: { status: "partial", requested: SERP_DEPTH, returned: 1, unresolved: 0 },
        costUsd: COST_USD,
        itemTypes: ["organic", "people_also_ask"],
      });
      expect(Object.hasOwn(result, "peopleAlsoAsk")).toBe(false);
    });

    it.each([0, 3])("retains PAA when there are no organic rows and %s unresolved organic items", async (unresolved) => {
      vi.spyOn(console, "info").mockImplementation(() => undefined);
      const { client, serpOrganic } = clientReturning([], ["people_also_ask"], unresolved, retainedPaa);

      const result = await readContentBriefSerp(input({ includePeopleAlsoAsk: true }), { client });

      expect(result.peopleAlsoAsk).toBe(retainedPaa);
      expect(result.rows).toEqual([]);
      expect(result.reads).toEqual({
        status: "unavailable",
        reason: unresolved > 0 ? "provider_error" : "insufficient_evidence",
        attempted: SERP_DEPTH,
      });
      expect(result.costUsd).toBe(COST_USD);
      expect(serpOrganic).toHaveBeenCalledTimes(1);
    });

    it("keeps an explicitly empty PAA sample distinct from unavailable", async () => {
      vi.spyOn(console, "info").mockImplementation(() => undefined);
      const peopleAlsoAsk: DataForSeoSerpPeopleAlsoAsk = {
        status: "complete", items: [], unreadableItems: 0, unreadableBlocks: 0, truncatedItems: 0,
      };
      const { client } = clientReturning(providerRows(1), [], 0, peopleAlsoAsk);

      const result = await readContentBriefSerp(input({ includePeopleAlsoAsk: true }), { client });

      expect(result.peopleAlsoAsk).toBe(peopleAlsoAsk);
    });

    it.each(["not_reported", "missing_block"] as const)("preserves the provider's %s PAA availability", async (reason) => {
      vi.spyOn(console, "info").mockImplementation(() => undefined);
      const peopleAlsoAsk: DataForSeoSerpPeopleAlsoAsk = { status: "unavailable", reason };
      const { client } = clientReturning(providerRows(1), null, 0, peopleAlsoAsk);

      const result = await readContentBriefSerp(input({ includePeopleAlsoAsk: true }), { client });

      expect(result.peopleAlsoAsk).toBe(peopleAlsoAsk);
    });

    it("reports not_reported when an opted-in legacy client omits PAA", async () => {
      vi.spyOn(console, "info").mockImplementation(() => undefined);
      const { client } = clientReturning(providerRows(1), ["people_also_ask"]);

      const result = await readContentBriefSerp(input({ includePeopleAlsoAsk: true }), { client });

      expect(result.peopleAlsoAsk).toEqual({ status: "unavailable", reason: "not_reported" });
    });

    it.each([
      { error: Object.assign(new Error("aborted"), { name: "AbortError" }), reason: "timeout" },
      { error: Object.assign(new Error("deadline"), { code: "TIMEOUT" }), reason: "timeout" },
      { error: new Error("HTTP 503"), reason: "provider_error" },
    ] as const)("reports unavailable PAA on $reason without inventing empty items", async ({ error, reason }) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { client, serpOrganic } = clientThrowing(error);

      const result = await readContentBriefSerp(input({ includePeopleAlsoAsk: true }), { client });

      expect(result).toEqual({
        rows: [],
        reads: { status: "unavailable", reason, attempted: SERP_DEPTH },
        costUsd: null,
        itemTypes: null,
        peopleAlsoAsk: { status: "unavailable", reason },
      });
      expect(serpOrganic).toHaveBeenCalledTimes(1);
    });

    it.each([undefined, false] as const)("keeps the legacy failure shape when opt-in is %s", async (includePeopleAlsoAsk) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      for (const reason of ["provider_error", "timeout"] as const) {
        const error = reason === "timeout"
          ? Object.assign(new Error("deadline"), { code: "TIMEOUT" })
          : new Error("HTTP 503");
        const { client } = clientThrowing(error);

        const result = await readContentBriefSerp(
          input(includePeopleAlsoAsk === undefined ? {} : { includePeopleAlsoAsk }), { client },
        );

        expect(result).toEqual({
          rows: [], reads: { status: "unavailable", reason, attempted: SERP_DEPTH },
          costUsd: null, itemTypes: null,
        });
        expect(Object.hasOwn(result, "peopleAlsoAsk")).toBe(false);
      }
    });

    it.each([
      { market: "XX", language: "en", code: "unsupported_market" },
      { market: "US", language: "zz", code: "unsupported_language" },
    ])("rejects $code before any PAA-enabled call", async ({ market, language, code }) => {
      const { client, serpOrganic } = clientReturning(providerRows(1), null, 0, retainedPaa);

      await expect(readContentBriefSerp(
        input({ market, language, includePeopleAlsoAsk: true }), { client },
      )).rejects.toMatchObject({ name: "ContentBriefSerpInputError", code });
      expect(serpOrganic).not.toHaveBeenCalled();
    });
  });
});
