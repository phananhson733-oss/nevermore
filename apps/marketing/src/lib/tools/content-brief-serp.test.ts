import { SERP_DEPTH } from "@sf/public-tools/content-brief/constants";
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
});
