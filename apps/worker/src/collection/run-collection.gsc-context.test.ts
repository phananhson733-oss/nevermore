import { describe, expect, it } from "vitest";
import { collectionRunParametersHash } from "@sf/db";
import { resolveFrozenGscKeywordLibraryContext } from "./run-collection.ts";

const context = {
  basis: "project_context",
  marketCode: "US",
  languageTag: "en-US",
} as const;

function run(keywordLibraryContext: typeof context | null = context) {
  const identity = {
    provider: "gsc",
    operation: "search_analytics",
    siteId: "00000000-0000-4000-8000-000000000001",
    sourceConnectionId: "00000000-0000-4000-8000-000000000002",
  } as const;
  return {
    provider: identity.provider,
    operation: identity.operation,
    site_id: identity.siteId,
    source_connection_id: identity.sourceConnectionId,
    parameters_hash: collectionRunParametersHash({
      provider: identity.provider,
      operation: identity.operation,
      siteId: identity.siteId,
      crawlSeedSitePageId: null,
      crawlSeedUrl: null,
      keywordLibraryContext,
    }),
  };
}

function payload(keywordLibraryContext: unknown = context) {
  return {
    provider: "gsc",
    operation: "search_analytics",
    sourceConnectionId: "00000000-0000-4000-8000-000000000002",
    keywordLibraryContext,
  };
}

describe("resolveFrozenGscKeywordLibraryContext", () => {
  it("returns the exact command-time context bound into the accepted parameters hash", () => {
    expect(
      resolveFrozenGscKeywordLibraryContext(run(), payload()),
    ).toEqual(context);
  });

  it("keeps legacy context-free GSC runs collectable but ineligible for projection", () => {
    expect(
      resolveFrozenGscKeywordLibraryContext(run(null), {}),
    ).toBeNull();
  });

  it("rejects context drift, crossed command identity and non-canonical tags", () => {
    expect(() =>
      resolveFrozenGscKeywordLibraryContext(
        run(),
        payload({ ...context, marketCode: "GB" }),
      ),
    ).toThrow(/does not match/i);
    expect(() =>
      resolveFrozenGscKeywordLibraryContext(run(), {
        ...payload(),
        sourceConnectionId: "00000000-0000-4000-8000-000000000099",
      }),
    ).toThrow(/incomplete or inconsistent/i);
    expect(() =>
      resolveFrozenGscKeywordLibraryContext(
        run(),
        payload({ ...context, languageTag: "en-us" }),
      ),
    ).toThrow(/context is invalid/i);
  });
});
