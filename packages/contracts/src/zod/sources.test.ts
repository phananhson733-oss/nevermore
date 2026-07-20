import { describe, expect, it } from "vitest";
import {
  CollectionOperationInput,
  CollectionProvider,
  CreateCollectionRunRequest,
} from "./sources.ts";

describe("collection run source contract", () => {
  it("accepts DataForSEO keyword-gap collection", () => {
    expect(CollectionProvider.parse("dataforseo")).toBe("dataforseo");
    expect(CollectionOperationInput.parse("keyword_gap_import")).toBe(
      "keyword_gap_import",
    );
    expect(
      CreateCollectionRunRequest.parse({
        provider: "dataforseo",
        operation: "keyword_gap_import",
      }),
    ).toEqual({
      provider: "dataforseo",
      operation: "keyword_gap_import",
    });
  });

  it("keeps operation optional so the service can derive the provider default", () => {
    expect(
      CreateCollectionRunRequest.parse({ provider: "dataforseo" }),
    ).toEqual({ provider: "dataforseo" });
  });

  it.each(["csv", "semrush", "ahrefs"])(
    "rejects unsupported collection-run provider %s",
    (provider) => {
      expect(CreateCollectionRunRequest.safeParse({ provider }).success).toBe(
        false,
      );
    },
  );
});
