import { describe, expect, it, vi } from "vitest";
import {
  SitePagesRepository,
  type ObservationInsert,
} from "@sf/db";
import {
  exactCandidatesForCanonicalSubject,
  resolveObservationSitePageLineage,
} from "./observation-site-page-lineage.ts";

const scope = { workspaceId: "workspace-1", projectId: "project-1" };
const siteId = "site-1";
const siteOrigin = "https://example.com";
const capturedAt = "2026-07-22T06:07:08.901Z";

function observation(
  overrides: Partial<ObservationInsert> = {},
): ObservationInsert {
  return {
    metricKey: "gsc.page.v1",
    subjectType: "url",
    subjectRef: "https://example.com/pricing",
    observedAt: capturedAt,
    availability: "available",
    valueNumeric: null,
    valueText: null,
    valueJson: { current28d: { clicks: 12 } },
    unit: null,
    origin: "first_party",
    method: "observed",
    grade: "A",
    support: "supports",
    limitation: "Provider fixture.",
    ...overrides,
  };
}

describe("exactCandidatesForCanonicalSubject", () => {
  it("inserts a slash before the query instead of appending it after the query", () => {
    expect(
      exactCandidatesForCanonicalSubject(
        "https://example.com/pricing?a=1",
        siteOrigin,
      ),
    ).toEqual([
      "https://example.com/pricing?a=1",
      "https://example.com/pricing/?a=1",
    ]);
  });

  it("returns one exact candidate for a root URL, including a root query", () => {
    expect(
      exactCandidatesForCanonicalSubject("https://example.com/", siteOrigin),
    ).toEqual(["https://example.com/"]);
    expect(
      exactCandidatesForCanonicalSubject(
        "https://example.com/?a=1",
        siteOrigin,
      ),
    ).toEqual(["https://example.com/?a=1"]);
  });

  it("fails closed for a foreign or non-canonical subject", () => {
    expect(
      exactCandidatesForCanonicalSubject(
        "https://foreign.example/pricing",
        siteOrigin,
      ),
    ).toBeNull();
    expect(
      exactCandidatesForCanonicalSubject(
        "https://example.com/pricing/",
        siteOrigin,
      ),
    ).toBeNull();
  });
});

describe("resolveObservationSitePageLineage", () => {
  it("binds Crawl page observations by exact value_json.fetchUrl, even when subject refs collide", async () => {
    const canonical = "https://example.com/pricing";
    const noSlash = observation({
      metricKey: "crawl.page.v1",
      origin: "direct_public",
      grade: "B",
      subjectRef: canonical,
      valueJson: { fetchUrl: canonical },
    });
    const slash = observation({
      metricKey: "crawl.page.v1",
      origin: "direct_public",
      grade: "B",
      subjectRef: canonical,
      valueJson: { fetchUrl: `${canonical}/` },
    });

    await expect(
      resolveObservationSitePageLineage({
        tx: {} as never,
        scope,
        siteId,
        siteOrigin,
        provider: "crawl",
        observations: [noSlash, slash],
        crawlExactSitePageIds: new Map([
          [canonical, "page-no-slash"],
          [`${canonical}/`, "page-slash"],
        ]),
      }),
    ).resolves.toEqual([
      { ...noSlash, sitePageId: "page-no-slash" },
      { ...slash, sitePageId: "page-slash" },
    ]);
  });

  it("fails the transaction if a Crawl page observation cannot prove its exact page", async () => {
    await expect(
      resolveObservationSitePageLineage({
        tx: {} as never,
        scope,
        siteId,
        siteOrigin,
        provider: "crawl",
        observations: [
          observation({
            metricKey: "crawl.page.v1",
            origin: "direct_public",
            grade: "B",
            valueJson: { fetchUrl: "https://example.com/other" },
          }),
        ],
        crawlExactSitePageIds: new Map(),
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it.each([
    ["gsc", "gsc.page.v1"],
    ["ga4", "ga4.landing.v1"],
  ] as const)(
    "uses the same unambiguous canonical resolver for %s URL observations",
    async (provider, metricKey) => {
      const canonical = "https://example.com/pricing?a=1";
      const row = observation({ metricKey, subjectRef: canonical });
      const resolve = vi
        .spyOn(
          SitePagesRepository.prototype,
          "resolveUnambiguousCanonicalSubjects",
        )
        .mockResolvedValue(
          new Map([[canonical, { id: `${provider}-site-page` } as never]]),
        );

      const resolved = await resolveObservationSitePageLineage({
        tx: {} as never,
        scope,
        siteId,
        siteOrigin,
        provider,
        observations: [row],
        crawlExactSitePageIds: new Map(),
      });

      expect(resolve).toHaveBeenCalledWith(scope, siteId, [
        {
          subjectRef: canonical,
          exactCandidates: [canonical, "https://example.com/pricing/?a=1"],
        },
      ]);
      expect(resolved).toEqual([
        { ...row, sitePageId: `${provider}-site-page` },
      ]);
      resolve.mockRestore();
    },
  );

  it("keeps an ambiguous URL and every non-URL observation explicitly unlinked", async () => {
    const canonical = "https://example.com/pricing";
    const url = observation({ subjectRef: canonical });
    const site = observation({
      metricKey: "crawl.robots.v1",
      subjectType: "site",
      subjectRef: siteOrigin,
      origin: "direct_public",
      grade: "B",
    });
    vi.spyOn(
      SitePagesRepository.prototype,
      "resolveUnambiguousCanonicalSubjects",
    ).mockResolvedValueOnce(new Map([[canonical, null]]));

    await expect(
      resolveObservationSitePageLineage({
        tx: {} as never,
        scope,
        siteId,
        siteOrigin,
        provider: "gsc",
        observations: [url, site],
        crawlExactSitePageIds: new Map(),
      }),
    ).resolves.toEqual([
      { ...url, sitePageId: null },
      { ...site, sitePageId: null },
    ]);
  });
});
