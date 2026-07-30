import { describe, expect, it } from "vitest";
import type { components, operations } from "../generated/openapi.ts";
import {
  CollectionOperationInput,
  CollectionProvider,
  CreateCollectionRunRequest,
} from "./sources.ts";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Expect<Value extends true> = Value;
type GeneratedRequest =
  operations["createCollectionRun"]["requestBody"]["content"]["application/json"];
type RuntimeRequest = typeof CreateCollectionRunRequest._output;
type _GeneratedRequestMatchesRuntime = Expect<
  Equal<GeneratedRequest, RuntimeRequest>
>;
type _CustomerCollectionProviders = Expect<
  Equal<GeneratedRequest["provider"], "crawl" | "gsc" | "ga4">
>;
type _CustomerCollectionOperations = Expect<
  Equal<
    NonNullable<GeneratedRequest["operation"]>,
    "site_graph" | "search_analytics" | "organic_landing"
  >
>;
type _ReadModelRetainsInternalEvidenceProvider = Expect<
  Equal<
    components["schemas"]["Provider"],
    "crawl" | "gsc" | "ga4" | "csv" | "dataforseo"
  >
>;

describe("collection run source contract", () => {
  it.each([
    ["crawl", "site_graph"],
    ["gsc", "search_analytics"],
    ["ga4", "organic_landing"],
  ] as const)(
    "accepts customer-triggerable %s collection",
    (provider, operation) => {
      expect(CollectionProvider.parse(provider)).toBe(provider);
      expect(CollectionOperationInput.parse(operation)).toBe(operation);
      expect(
        CreateCollectionRunRequest.parse({ provider, operation }),
      ).toEqual({ provider, operation });
    },
  );

  it("keeps operation optional so the service can derive the provider default", () => {
    expect(CreateCollectionRunRequest.parse({ provider: "crawl" })).toEqual({
      provider: "crawl",
    });
  });

  it.each(["csv", "dataforseo", "semrush", "ahrefs"])(
    "rejects unsupported collection-run provider %s",
    (provider) => {
      expect(CreateCollectionRunRequest.safeParse({ provider }).success).toBe(
        false,
      );
    },
  );

  it("does not expose internal DataForSEO operation or credential input", () => {
    expect(
      CreateCollectionRunRequest.safeParse({
        provider: "crawl",
        operation: "keyword_gap_import",
      }).success,
    ).toBe(false);
    expect(
      CreateCollectionRunRequest.safeParse({
        provider: "crawl",
        apiKey: "must-never-cross-the-customer-boundary",
      }).success,
    ).toBe(false);
  });
});
