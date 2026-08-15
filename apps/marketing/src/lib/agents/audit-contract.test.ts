// @input  -- candidate Agent API success envelopes
// @output -- proof that the client guard accepts only the frozen evidence contract
// @pos    -- focused contract tests shared by Agent API and client rendering

import { describe, expect, it } from "vitest";
import {
  isAgentAuditSuccessEnvelope,
  type AgentAuditSuccessEnvelope,
} from "./audit-contract.ts";

const RECORD_SPECS = [
  ["robots_resource", "crawl"],
  ["sitemap_resource", "crawl"],
  ["non_2xx_final_status", "crawl"],
  ["redirect_chain", "crawl"],
  ["http_url", "crawl"],
  ["noindex_directive", "indexability"],
  ["canonical_missing", "indexability"],
  ["canonical_differs", "indexability"],
  ["title_missing", "metadata"],
  ["title_duplicate", "metadata"],
  ["meta_description_missing", "metadata"],
  ["meta_description_duplicate", "metadata"],
  ["h1_missing", "structure"],
  ["multiple_h1", "structure"],
  ["sitemap_page_without_observed_inlink", "links"],
  ["internal_target_http_error", "links"],
  ["json_ld_parse_error", "structured_data"],
  ["page_outbound_broken_link", "links"],
  ["page_not_in_sitemap", "crawl"],
  ["title_length_outside_range", "metadata"],
  ["meta_description_length_outside_range", "metadata"],
  ["page_without_outbound_internal_link", "links"],
  ["click_depth_beyond_reviewed_limit", "links"],
  ["json_ld_missing", "structured_data"],
] as const;

const success = {
  data: {
    run: {
      agent: "seo",
      mode: "authenticated_agent",
      persistence: "none",
      source: {
        tool: "seo_audit",
        schemaVersion: "seo_audit.sitewide.v4",
        completedAt: "2026-08-12T09:00:00.000Z",
        cache: { status: "miss", capturedAt: null },
      },
    },
    result: {
      targetUrl: "https://acme.test/",
      siteOrigin: "https://acme.test",
      scannedAt: "2026-08-12T09:00:00.000Z",
      targetInspected: true,
      inspectedTargetUrl: "https://acme.test/",
      coverage: {
        availability: "available",
        pagesInspected: 1,
        linksObserved: 2,
        sitemapUrlsObserved: 1,
        urlsSkipped: 0,
        urlsBlocked: 0,
        urlsDisallowed: 0,
        urlsErrored: 0,
        stopReason: null,
      },
      siteResources: {
        robotsFetched: true,
        robotsGroupsObserved: 1,
        sitemapReferencesObserved: 1,
        sitemapFetched: true,
      },
      records: RECORD_SPECS.map(([id, category], index) => ({
        id,
        category,
        state: index === 0 ? ("observed" as const) : ("not_observed" as const),
        unit: "pages" as const,
        population: "every_collected_page" as const,
        tested: 1,
        affected: index === 0 ? 1 : 0,
        observations:
          index === 0
            ? [
                {
                  url: "https://acme.test/",
                  values: [{ label: "sample", value: null }],
                },
              ]
            : [],
        limitation: null,
      })),
    },
  },
} satisfies AgentAuditSuccessEnvelope;

describe("isAgentAuditSuccessEnvelope", () => {
  it.each(["seo", "tech"] as const)(
    "accepts the same complete neutral ledger for the %s Agent",
    (agent) => {
      const envelope: AgentAuditSuccessEnvelope = {
        data: {
          ...success.data,
          run: { ...success.data.run, agent },
        },
      };

      expect(isAgentAuditSuccessEnvelope(envelope)).toBe(true);
      expect(envelope.data.result.records).toHaveLength(24);
      expect("pages" in envelope.data.result).toBe(false);
    },
  );

  it("rejects an unknown neutral record", () => {
    const malformed = structuredClone(success) as unknown as {
      data: { result: { records: Array<{ id: string }> } };
    };
    malformed.data.result.records[0]!.id = "future_unknown_record";

    expect(isAgentAuditSuccessEnvelope(malformed)).toBe(false);
  });

  it("rejects a known record with the wrong category", () => {
    const malformed = structuredClone(success) as unknown as {
      data: { result: { records: Array<{ category: string }> } };
    };
    malformed.data.result.records[0]!.category = "metadata";

    expect(isAgentAuditSuccessEnvelope(malformed)).toBe(false);
  });

  it.each(["missing", "duplicate"] as const)(
    "rejects a %s record in the neutral ledger",
    (fault) => {
      const malformed = structuredClone(success) as unknown as {
        data: { result: { records: Array<unknown> } };
      };
      if (fault === "missing") malformed.data.result.records.pop();
      else malformed.data.result.records[1] = malformed.data.result.records[0];

      expect(isAgentAuditSuccessEnvelope(malformed)).toBe(false);
    },
  );

  it.each([
    ["affected differs from observations", { tested: 2, affected: 2, state: "observed" }],
    ["affected exceeds tested", { tested: 0, affected: 1, state: "observed" }],
    ["observed has no affected observation", { tested: 1, affected: 0, state: "observed" }],
    ["not_observed has an affected observation", { tested: 1, affected: 1, state: "not_observed" }],
    ["unverified has an affected observation", { tested: 1, affected: 1, state: "unverified" }],
  ] as const)("rejects a projected record whose %s", (_description, contradiction) => {
    const malformed = structuredClone(success) as unknown as {
      data: {
        result: {
          records: Array<{
            tested: number;
            affected: number;
            state: string;
            observations: unknown[];
          }>;
        };
      };
    };
    const target = malformed.data.result.records[0]!;
    target.tested = contradiction.tested;
    target.affected = contradiction.affected;
    target.state = contradiction.state;
    target.observations = contradiction.affected === 0 ? [] : target.observations;

    expect(isAgentAuditSuccessEnvelope(malformed)).toBe(false);
  });

  it("rejects missing source provenance", () => {
    const malformed = structuredClone(success) as unknown as {
      data: { run: { source: { schemaVersion?: string } } };
    };
    delete malformed.data.run.source.schemaVersion;

    expect(isAgentAuditSuccessEnvelope(malformed)).toBe(false);
  });

  it("rejects empty source version and timestamp provenance", () => {
    for (const key of ["schemaVersion", "completedAt"] as const) {
      const malformed = structuredClone(success) as unknown as {
        data: { run: { source: Record<(typeof key), string> } };
      };
      malformed.data.run.source[key] = "";

      expect(isAgentAuditSuccessEnvelope(malformed)).toBe(false);
    }
  });

  it.each([
    ["completedAt", "not-a-timestamp"],
    ["completedAt", "2026-08-12T09:00:00Z"],
    ["scannedAt", "2026-02-30T09:00:00.000Z"],
    ["scannedAt", "2026-08-12T09:00:00.000+00:00"],
  ] as const)("rejects non-canonical %s provenance", (field, value) => {
    const malformed = structuredClone(success) as unknown as {
      data: {
        run: { source: { completedAt: string } };
        result: { scannedAt: string };
      };
    };
    if (field === "completedAt") malformed.data.run.source.completedAt = value;
    else malformed.data.result.scannedAt = value;

    expect(isAgentAuditSuccessEnvelope(malformed)).toBe(false);
  });

  it.each([
    ["hit", null],
    ["hit", "yesterday"],
    ["miss", "2026-08-12T08:30:00.000Z"],
  ] as const)(
    "rejects the invalid cache provenance combination %s/%s",
    (status, capturedAt) => {
      const malformed = structuredClone(success) as unknown as {
        data: {
          run: {
            source: {
              cache: { status: "hit" | "miss"; capturedAt: string | null };
            };
          };
        };
      };
      malformed.data.run.source.cache = { status, capturedAt };

      expect(isAgentAuditSuccessEnvelope(malformed)).toBe(false);
    },
  );

  it("accepts a cache hit with canonical capture provenance", () => {
    const cached = structuredClone(success) as AgentAuditSuccessEnvelope;
    const withCacheHit = {
      data: {
        ...cached.data,
        run: {
          ...cached.data.run,
          source: {
            ...cached.data.run.source,
            cache: {
              status: "hit" as const,
              capturedAt: "2026-08-12T08:30:00.000Z",
            },
          },
        },
      },
    };

    expect(isAgentAuditSuccessEnvelope(withCacheHit)).toBe(true);
  });

  it("rejects a response from a different crawl schema", () => {
    const malformed = structuredClone(success) as unknown as {
      data: { run: { source: { schemaVersion: string } } };
    };
    malformed.data.run.source.schemaVersion = "seo_audit.sitewide.v5";

    expect(isAgentAuditSuccessEnvelope(malformed)).toBe(false);
  });
});
