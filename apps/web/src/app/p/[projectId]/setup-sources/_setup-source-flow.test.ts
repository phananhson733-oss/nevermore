import { describe, expect, it } from "vitest";
import {
  parseSetupSourceReturnParams,
  productProfilePath,
  setupSourcesPath,
} from "./_setup-source-flow";

describe("optional source setup return", () => {
  const intentId = "00000000-0000-8000-8000-000000000001";

  it("accepts a paired provider and UUIDv8 intent", () => {
    expect(
      parseSetupSourceReturnParams({
        provider: "gsc",
        oauthIntentId: intentId,
      }),
    ).toEqual({ provider: "gsc", oauthIntentId: intentId, error: null });
  });

  it("drops incomplete or malformed OAuth pointers", () => {
    expect(
      parseSetupSourceReturnParams({
        provider: "crawl",
        oauthIntentId: intentId,
      }),
    ).toEqual({ provider: null, oauthIntentId: null, error: null });
    expect(
      parseSetupSourceReturnParams({
        provider: "ga4",
        oauthIntentId: "not-a-uuid",
      }),
    ).toEqual({ provider: null, oauthIntentId: null, error: null });
  });

  it("keeps only stable error codes and builds same-project paths", () => {
    expect(parseSetupSourceReturnParams({ error: "OAUTH_CONSENT_DENIED" }).error)
      .toBe("OAUTH_CONSENT_DENIED");
    expect(parseSetupSourceReturnParams({ error: "raw provider message" }).error)
      .toBeNull();
    expect(setupSourcesPath("project/id")).toBe(
      "/p/project%2Fid/setup-sources",
    );
    expect(productProfilePath("project/id")).toBe("/p/project%2Fid/context");
  });
});
