import { describe, expect, it } from "vitest";

import type { KeywordOpportunityResult } from "@sf/public-tools/keyword-opportunity";
import {
  clearKeywordWorkflowPointer,
  keywordWorkflowPointerForContext,
  keywordWorkflowPollDelayMs,
  normalizeKeywordWorkflowStartResponse,
  normalizeKeywordWorkflowStatusResponse,
  readKeywordWorkflowPointer,
  writeKeywordWorkflowPointer,
  type KeywordWorkflowPointerV1,
  type KeywordWorkflowStorage,
} from "./keyword-workflow-client.ts";

const NOW = Date.parse("2026-08-28T00:00:00.000Z");
const REQUEST_ID = "2f7b5985-75b9-44c0-9b53-2b54b7901f2f";

function pointer(
  overrides: Partial<KeywordWorkflowPointerV1> = {},
): KeywordWorkflowPointerV1 {
  return {
    version: "keyword_workflow_pointer.v1",
    requestId: REQUEST_ID,
    property: "sc-domain:example.com",
    siteUrl: "https://example.com/",
    marketCode: "US",
    languageCode: "en",
    seedInput: "clinic software",
    context: {
      token: "sealed-context",
      propositions: [
        {
          statement: "Automate clinic appointments",
          sourceUrl: "https://example.com/product",
        },
      ],
      pagesFetched: 5,
      productPagesFetched: 1,
      contextSufficient: true,
    },
    createdAt: NOW,
    runToken: null,
    ...overrides,
  };
}

function storage(initial: string | null = null): KeywordWorkflowStorage & {
  value: string | null;
} {
  return {
    value: initial,
    getItem() {
      return this.value;
    },
    setItem(_key, value) {
      this.value = value;
    },
    removeItem() {
      this.value = null;
    },
  };
}

describe("keyword Workflow tab pointer", () => {
  it("round-trips a current pointer only for the same property and shipped market", () => {
    const target = storage();
    expect(writeKeywordWorkflowPointer(target, pointer())).toBe(true);

    expect(
      readKeywordWorkflowPointer(
        target,
        {
          properties: ["sc-domain:example.com"],
          markets: ["US", "GB"],
        },
        () => NOW + 1_000,
      ),
    ).toEqual(pointer());
    expect(
      readKeywordWorkflowPointer(
        target,
        { properties: ["sc-domain:other.com"], markets: ["US"] },
        () => NOW + 1_000,
      ),
    ).toBeNull();
  });

  it("fails closed on malformed, expired, wrong-version, and inaccessible storage", () => {
    const malformed = storage("not json");
    expect(
      readKeywordWorkflowPointer(
        malformed,
        { properties: ["sc-domain:example.com"], markets: ["US"] },
        () => NOW,
      ),
    ).toBeNull();
    expect(malformed.value).toBeNull();

    const expired = storage(
      JSON.stringify(pointer({ createdAt: NOW - 24 * 60 * 60 * 1_000 - 1 })),
    );
    expect(
      readKeywordWorkflowPointer(
        expired,
        { properties: ["sc-domain:example.com"], markets: ["US"] },
        () => NOW,
      ),
    ).toBeNull();

    const inaccessible: KeywordWorkflowStorage = {
      getItem: () => {
        throw new Error("storage denied");
      },
      setItem: () => {
        throw new Error("storage denied");
      },
      removeItem: () => {
        throw new Error("storage denied");
      },
    };
    expect(writeKeywordWorkflowPointer(inaccessible, pointer())).toBe(false);
    expect(clearKeywordWorkflowPointer(inaccessible)).toBe(false);
  });

  it("reuses one request id after a lost start response but rotates it for new context", () => {
    const current = pointer();
    expect(
      keywordWorkflowPointerForContext(
        current,
        {
          property: current.property,
          siteUrl: current.siteUrl,
          marketCode: current.marketCode,
          languageCode: current.languageCode,
          seedInput: current.seedInput,
          context: current.context,
        },
        () => NOW + 1_000,
        () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ).requestId,
    ).toBe(REQUEST_ID);
    expect(
      keywordWorkflowPointerForContext(
        current,
        {
          property: current.property,
          siteUrl: current.siteUrl,
          marketCode: "GB",
          languageCode: current.languageCode,
          seedInput: current.seedInput,
          context: current.context,
        },
        () => NOW + 1_000,
        () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ).requestId,
    ).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });
});

describe("keyword Workflow response normalization", () => {
  const result = { availability: "available" } as unknown as KeywordOpportunityResult;

  it("keeps legacy 200 completion and versioned 202 acceptance distinct", () => {
    expect(
      normalizeKeywordWorkflowStartResponse(200, {
        data: { result },
      }),
    ).toEqual({ kind: "completed", result });
    expect(
      normalizeKeywordWorkflowStartResponse(202, {
        data: { status: "running", runToken: "sealed-run" },
      }),
    ).toEqual({ kind: "accepted", runToken: "sealed-run" });
    expect(
      normalizeKeywordWorkflowStartResponse(200, {
        data: { status: "running", runToken: "sealed-run" },
      }),
    ).toEqual({ kind: "invalid" });
  });

  it("normalizes queued, running, redirect, completed, and stable errors", () => {
    expect(
      normalizeKeywordWorkflowStatusResponse(200, {
        data: { status: "queued", runToken: "sealed-run" },
      }),
    ).toEqual({ kind: "tracking", status: "queued", runToken: "sealed-run" });
    expect(
      normalizeKeywordWorkflowStatusResponse(200, {
        data: { status: "running", runToken: "sealed-run" },
      }),
    ).toEqual({ kind: "tracking", status: "running", runToken: "sealed-run" });
    expect(
      normalizeKeywordWorkflowStatusResponse(200, {
        data: { status: "redirect", runToken: "owner-token" },
      }),
    ).toEqual({ kind: "redirect", runToken: "owner-token" });
    expect(
      normalizeKeywordWorkflowStatusResponse(200, {
        data: { status: "completed", result },
      }),
    ).toEqual({ kind: "completed", result });
    expect(
      normalizeKeywordWorkflowStatusResponse(409, {
        error: { code: "keyword_run_cancelled" },
      }),
    ).toEqual({ kind: "error", code: "keyword_run_cancelled" });
  });

  it("honours a bounded Retry-After and falls back to two seconds", () => {
    expect(keywordWorkflowPollDelayMs(null)).toBe(2_000);
    expect(keywordWorkflowPollDelayMs("1")).toBe(1_000);
    expect(keywordWorkflowPollDelayMs("9999")).toBe(5_000);
    expect(keywordWorkflowPollDelayMs("not-a-number")).toBe(2_000);
  });
});
