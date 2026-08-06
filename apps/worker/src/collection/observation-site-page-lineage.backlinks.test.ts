import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SitePagesRepository,
  type ObservationInsert,
} from "@sf/db";
import { resolveObservationSitePageLineage } from "./observation-site-page-lineage.ts";

const scope = { workspaceId: "workspace-1", projectId: "project-1" };
const siteId = "site-1";
const siteOrigin = "https://example.com";
const capturedAt = "2026-08-06T01:00:00.000Z";

afterEach(() => {
  vi.restoreAllMocks();
});

function backlinkObservation(
  metricKey: string,
  subjectRef: string,
  subjectType: "site" | "url" = "url",
): ObservationInsert {
  return {
    metricKey,
    subjectType,
    subjectRef,
    observedAt: capturedAt,
    availability: "available",
    valueNumeric: null,
    valueText: null,
    valueJson: {},
    unit: null,
    origin: "vendor_observation",
    method: "observed",
    grade: "B",
    support: "supports",
    limitation: "DataForSEO live backlink index fixture.",
  };
}

describe("DataForSEO backlink SitePage lineage", () => {
  it("binds detailed backlink and backlink-page URL observations through the canonical resolver", async () => {
    const canonical = "https://example.com/guide?a=1";
    const detailed = backlinkObservation(
      "dataforseo.backlink.v1",
      canonical,
    );
    const page = backlinkObservation(
      "dataforseo.backlink_page.v1",
      canonical,
    );
    const summary = backlinkObservation(
      "dataforseo.backlink_summary.v1",
      "example.com",
      "site",
    );
    const referringDomain = backlinkObservation(
      "dataforseo.referring_domain.v1",
      "publisher.example",
      "site",
    );
    const resolve = vi
      .spyOn(
        SitePagesRepository.prototype,
        "resolveUnambiguousCanonicalSubjects",
      )
      .mockResolvedValue(
        new Map([[canonical, { id: "dataforseo-site-page" } as never]]),
      );

    const resolved = await resolveObservationSitePageLineage({
      tx: {} as never,
      scope,
      siteId,
      siteOrigin,
      provider: "dataforseo",
      observations: [detailed, page, summary, referringDomain],
      crawlExactSitePageIds: new Map(),
    });

    expect(resolve).toHaveBeenCalledWith(scope, siteId, [
      {
        subjectRef: canonical,
        exactCandidates: [
          canonical,
          "https://example.com/guide/?a=1",
        ],
      },
    ]);
    expect(resolved).toEqual([
      { ...detailed, sitePageId: "dataforseo-site-page" },
      { ...page, sitePageId: "dataforseo-site-page" },
      { ...summary, sitePageId: null },
      { ...referringDomain, sitePageId: null },
    ]);
  });

  it("does not attach a foreign backlink target URL to this Site", async () => {
    const resolve = vi.spyOn(
      SitePagesRepository.prototype,
      "resolveUnambiguousCanonicalSubjects",
    );
    const foreign = backlinkObservation(
      "dataforseo.backlink.v1",
      "https://foreign.example/guide",
    );

    await expect(
      resolveObservationSitePageLineage({
        tx: {} as never,
        scope,
        siteId,
        siteOrigin,
        provider: "dataforseo",
        observations: [foreign],
        crawlExactSitePageIds: new Map(),
      }),
    ).resolves.toEqual([{ ...foreign, sitePageId: null }]);
    expect(resolve).not.toHaveBeenCalled();
  });
});
