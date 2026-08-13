// @input  -- minimal shape-valid Agent data and current display-vocabulary guard
// @output -- regression coverage for record, evidence, limitation, and Agent drift
// @pos    -- unit guard preventing dynamic next-intl missing-message failures

import { describe, expect, it } from "vitest";
import type { AgentAuditSuccessData } from "../../lib/agents/audit-contract";

import { supportsAgentDisplayVocabulary } from "./agent-display-contract";

function data(): AgentAuditSuccessData {
  return {
    run: {
      agent: "seo",
      mode: "authenticated_agent",
      persistence: "none",
      source: {
        tool: "seo_audit",
        schemaVersion: "seo_audit.sitewide.v3",
        completedAt: "2026-08-12T00:00:00.000Z",
        cache: { status: "miss", capturedAt: null },
      },
    },
    result: {
      targetUrl: "https://example.com",
      siteOrigin: "https://example.com",
      scannedAt: "2026-08-12T00:00:00.000Z",
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

describe("Agent display vocabulary", () => {
  it("accepts the current SEO ledger vocabulary", () => {
    expect(supportsAgentDisplayVocabulary(data(), "seo")).toBe(true);
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
