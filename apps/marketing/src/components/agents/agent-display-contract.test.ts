// @input  -- minimal shape-valid Agent data and current display-vocabulary guard
// @output -- regression coverage for record, evidence, limitation, and Agent drift
// @pos    -- unit guard preventing dynamic next-intl missing-message failures

import { describe, expect, it } from "vitest";
import {
  SEARCH_PERFORMANCE_LIMITATION_CODES,
  SEO_AUDIT_EVIDENCE_LABELS,
  SEO_AUDIT_LIMITATION_CODES,
  SEO_AUDIT_RECORD_IDS,
} from "@sf/public-tools/seo-audit/record-ledger";
import {
  SEARCH_PERFORMANCE_EVIDENCE_LABELS,
  SEARCH_PERFORMANCE_RECORD_IDS,
} from "@sf/public-tools/seo-audit/search-performance";
import {
  KEYWORD_EVIDENCE_EVIDENCE_LABELS,
  KEYWORD_EVIDENCE_LIMITATION_CODES,
  KEYWORD_EVIDENCE_RECORD_IDS,
} from "@sf/public-tools/seo-audit/keyword-evidence/records";
import {
  PAGE_PERFORMANCE_EVIDENCE_LABELS,
  PAGE_PERFORMANCE_LIMITATION_CODES,
  PAGE_PERFORMANCE_RECORD_IDS,
} from "@sf/public-tools/seo-audit/page-performance";
import {
  SERP_SHAPE_EVIDENCE_LABELS,
  SERP_SHAPE_LIMITATION_CODES,
  SERP_SHAPE_RECORD_IDS,
} from "@sf/public-tools/seo-audit/serp-shape";
import type { AgentAuditSuccessData } from "../../lib/agents/audit-contract";
import enMessages from "../../i18n/messages/en.json";
import zhMessages from "../../i18n/messages/zh.json";

import {
  AGENT_EVIDENCE_LABELS,
  AGENT_LIMITATION_CODES,
  supportsAgentDisplayVocabulary,
} from "./agent-display-contract";

function data(): AgentAuditSuccessData {
  return {
    run: {
      agent: "seo",
      mode: "authenticated_agent",
      persistence: "none",
      source: {
        tool: "seo_audit",
        schemaVersion: "seo_audit.sitewide.v10",
        completedAt: "2026-08-12T00:00:00.000Z",
        cache: { status: "miss", capturedAt: null },
      },
    },
    result: {
      targetUrl: "https://example.com",
      siteOrigin: "https://example.com",
      scannedAt: "2026-08-12T00:00:00.000Z",
      targetInspected: true,
      inspectedTargetUrl: "https://acme.test/",
      targetPageExtract: null,
      coverage: {
        availability: "available",
        pagesInspected: 1,
        linksObserved: 0,
        sitemapUrlsObserved: 0,
        urlsSkipped: 0,
        urlsBlocked: 0,
        urlsDisallowed: 0,
        urlsErrored: 0,
        stopReason: null,
      },
      siteResources: {
        robotsFetched: true,
        robotsGroupsObserved: 1,
        sitemapReferencesObserved: 0,
        sitemapFetched: false,
      },
      records: [
        {
          id: "title_duplicate",
          category: "metadata",
          state: "observed",
          unit: "pages",
          population: "every_collected_page" as const,
          targetTested: null,
          tested: 1,
          affected: 1,
          observations: [
            {
              url: "https://example.com/",
              values: [{ label: "title", value: "Example" }],
            },
          ],
          limitation: "normalised_text_match_within_inspected_pages",
        },
      ],
    },
  };
}

describe("record vocabulary", () => {
  /**
   * The seam above fails closed on an unrecognised record, so a detector that
   * lands without copy does not render a broken panel — it renders no panel at
   * all. That is safe and completely silent, which is how five detectors
   * reached the UI and took the results view down with every unit test green.
   * Reading the catalogues directly is the point: next-intl renders a missing
   * key as its own dotted path rather than throwing, so asserting that a
   * translated string "appears" would pass on the path itself.
   */
  it("gives every ledger record a title and description in both locales", () => {
    const missing: string[] = [];
    for (const locale of ["en", "zh"] as const) {
      const catalogue = locale === "en" ? enMessages : zhMessages;
      const records = catalogue.tools.seoAudit.records as Readonly<
        Record<string, { title?: string; description?: string }>
      >;
      for (const id of [
        ...SEO_AUDIT_RECORD_IDS,
        ...SEARCH_PERFORMANCE_RECORD_IDS,
        ...KEYWORD_EVIDENCE_RECORD_IDS,
        ...PAGE_PERFORMANCE_RECORD_IDS,
        ...SERP_SHAPE_RECORD_IDS,
      ]) {
        const entry = records[id];
        if (!entry?.title?.trim() || !entry.description?.trim()) {
          missing.push(`${locale}:${id}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  // These two used to compare the ledger against a set built from the ledger,
  // which proved nothing: both sides moved together and the assertion could
  // not fail. They now cross into the shipped message catalogues, which is
  // where the real gap is — next-intl renders a missing key as its own path,
  // so an unnamed code reaches a visitor as
  // "limitations.search_console_reported_no_impressions_..." instead of
  // failing anywhere a test could see.
  it("names every limitation code in both shipped catalogues", () => {
    const missing: string[] = [];
    for (const locale of ["en", "zh"] as const) {
      const copy = (locale === "en" ? enMessages : zhMessages).tools.seoAudit
        .limitations as Readonly<Record<string, string>>;
      for (const code of [
        ...SEO_AUDIT_LIMITATION_CODES,
        ...SEARCH_PERFORMANCE_LIMITATION_CODES,
        ...KEYWORD_EVIDENCE_LIMITATION_CODES,
        ...PAGE_PERFORMANCE_LIMITATION_CODES,
        ...SERP_SHAPE_LIMITATION_CODES,
      ]) {
        if (!copy[code]?.trim()) missing.push(`${locale}:${code}`);
        if (!AGENT_LIMITATION_CODES.has(code)) missing.push(`seam:${code}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("names every evidence label in both shipped catalogues", () => {
    const missing: string[] = [];
    for (const locale of ["en", "zh"] as const) {
      const copy = (locale === "en" ? enMessages : zhMessages).tools.seoAudit
        .evidence as Readonly<Record<string, string>>;
      for (const label of [
        ...SEO_AUDIT_EVIDENCE_LABELS,
        ...SEARCH_PERFORMANCE_EVIDENCE_LABELS,
        ...KEYWORD_EVIDENCE_EVIDENCE_LABELS,
        ...PAGE_PERFORMANCE_EVIDENCE_LABELS,
        ...SERP_SHAPE_EVIDENCE_LABELS,
      ]) {
        if (!copy[label]?.trim()) missing.push(`${locale}:${label}`);
        if (!AGENT_EVIDENCE_LABELS.has(label)) missing.push(`seam:${label}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("Agent display vocabulary", () => {
  it("accepts the current SEO ledger vocabulary", () => {
    expect(supportsAgentDisplayVocabulary(data(), "seo")).toBe(true);
  });

  it("accepts crawl vocabulary for SEO because both Agents receive the neutral ledger", () => {
    const current = data();
    const crawl: AgentAuditSuccessData = {
      ...current,
      result: {
        ...current.result,
        records: [
          {
            ...current.result.records[0]!,
            id: "non_2xx_final_status",
            category: "crawl",
          },
        ],
      },
    };

    expect(supportsAgentDisplayVocabulary(crawl, "seo")).toBe(true);
  });

  it.each([
    ["record id", { id: "future_record" }],
    ["evidence label", { evidenceLabel: "future_measurement" }],
    ["limitation", { limitation: "future_limitation" }],
  ] as const)("rejects an unknown %s", (_, change) => {
    const current = data();
    const record = current.result.records[0]!;
    const changed: AgentAuditSuccessData = {
      ...current,
      result: {
        ...current.result,
        records: [
          {
            ...record,
            id: "id" in change ? change.id : record.id,
            limitation:
              "limitation" in change ? change.limitation : record.limitation,
            observations: [
              {
                ...record.observations[0]!,
                values: [
                  {
                    ...record.observations[0]!.values[0]!,
                    label:
                      "evidenceLabel" in change
                        ? change.evidenceLabel
                        : record.observations[0]!.values[0]!.label,
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    expect(supportsAgentDisplayVocabulary(changed, "seo")).toBe(false);
  });

  it("rejects data for the other Agent", () => {
    expect(supportsAgentDisplayVocabulary(data(), "tech")).toBe(false);
  });
});
