import { describe, expect, it } from "vitest";
import {
  backlinkAuthorityPresentation,
  backlinkMetricPresentation,
  backlinkPageHref,
} from "./_backlink-growth-path-view-model";

describe("Backlink Growth Path view model", () => {
  it("never formats unavailable evidence as numeric zero", () => {
    expect(
      backlinkMetricPresentation({
        semantics: "unavailable",
        value: null,
      }),
    ).toEqual({ kind: "unavailable", value: null });
  });

  it("keeps observed zero distinct from a provider-wide zero", () => {
    expect(
      backlinkMetricPresentation({
        semantics: "observed_fact_count",
        value: 0,
      }),
    ).toEqual({ kind: "observed_count", value: 0 });
    expect(
      backlinkMetricPresentation({
        semantics: "provider_index_total",
        value: 0,
      }),
    ).toEqual({ kind: "provider_total", value: 0 });
  });

  it("suppresses authority scores outside a real provider import", () => {
    expect(
      backlinkAuthorityPresentation({
        sourceKind: "search_derived",
        authorityMetric: {
          kind: "domain_rating",
          value: 80,
        },
      } as never),
    ).toBeNull();
  });

  it("deep-links a page back into the existing Growth Map URL pane", () => {
    expect(
      backlinkPageHref(
        "c3000000-0000-4000-8000-000000000001",
        "c3000000-0000-4000-8000-000000000002",
      ),
    ).toBe(
      "/p/c3000000-0000-4000-8000-000000000001/growth-map?object=pages&selectedSitePageId=c3000000-0000-4000-8000-000000000002",
    );
  });
});
