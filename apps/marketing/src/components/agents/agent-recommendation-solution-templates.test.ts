// @input  -- the same evaluated v2 checks viewed through SEO and Tech Agents
// @output -- regression coverage for solution-specific language and evidence-filled previews
// @pos    -- pure contract guard for Stage 04 semantics

import { describe, expect, it } from "vitest";
import type { SeoAuditRecord } from "@sf/public-tools";
import type { AgentAuditEvaluatedCheck } from "@sf/public-tools/agent-audit";

import {
  solutionTemplate,
  type AgentSolutionPreviewInput,
} from "./agent-solution-templates";

function check(id: string): AgentAuditEvaluatedCheck {
  return {
    check: {
      id,
      scope: id.includes(".") ? "page" : "site",
      groupId: id.split(".")[0] ?? id,
    },
    result: "warning",
    evidenceRecordIds: [],
  } as unknown as AgentAuditEvaluatedCheck;
}

const FILL_IN = "[to fill in]";
const NOT_CAPTURED = "[not captured this run]";

const INPUT: AgentSolutionPreviewInput = {
  fillIn: FILL_IN,
  notCaptured: NOT_CAPTURED,
  targetUrl: "https://astrologywiki.com/tools/birth-chart",
  productName: "AstrologyWiki",
  targetQuery: "free birth chart",
  pageType: "Tool page",
  searchContext: "CN · zh-CN · Mobile",
  measurement: "2 of 12 inspected pages affected",
  evidenceRecords: [],
};

function evidence(
  id: string,
  values: Readonly<Record<string, string | number>>,
  url = "https://astrologywiki.com/tools/birth-chart",
): SeoAuditRecord {
  return {
    id,
    category: "indexability",
    state: "observed",
    unit: "pages",
    population: "every_collected_page",
    tested: 12,
    affected: 1,
    observations: [
      {
        url,
        values: Object.entries(values).map(([label, value]) => ({
          label,
          value,
        })),
      },
    ],
    limitation: null,
  } as unknown as SeoAuditRecord;
}

function withEvidence(
  records: readonly SeoAuditRecord[],
): AgentSolutionPreviewInput {
  return { ...INPUT, evidenceRecords: records };
}

const TEMPLATE_TEXT_KEYS = [
  "recommendationKey",
  "impactSurfaceKey",
  "risksKey",
  "limitsKey",
] as const;

describe("Agent-specific selected solution templates", () => {
  it("turns the same canonical evidence into an SEO issue brief and a Tech config fix", () => {
    const seo = solutionTemplate("seo", check("1.4"), INPUT);
    const tech = solutionTemplate("tech", check("1.4"), INPUT);

    expect(seo.kind).toBe("technical-issue-brief");
    expect(seo.presentation).toBe("content");
    expect(seo.preview).toContain("technical issue brief");
    expect(tech.kind).toBe("canonical");
    expect(tech.presentation).toBe("code");
    expect(tech.preview).toContain('rel="canonical"');
    expect(seo.preview).not.toBe(tech.preview);
  });

  it("uses search/content previews for SEO metadata, headings, links, media, and opportunity", () => {
    expect(solutionTemplate("seo", check("2.3"), INPUT)).toMatchObject({
      kind: "search-presentation",
      presentation: "content",
    });
    expect(solutionTemplate("seo", check("3.1"), INPUT).kind).toBe(
      "heading-structure",
    );
    expect(solutionTemplate("seo", check("6.1"), INPUT).kind).toBe(
      "internal-link-exposure",
    );
    expect(solutionTemplate("seo", check("5.1"), INPUT).kind).toBe(
      "media-assets",
    );
    expect(solutionTemplate("seo", check("D4"), INPUT).kind).toBe(
      "media-assets",
    );
    expect(solutionTemplate("seo", check("9.1"), INPUT)).toMatchObject({
      kind: "search-opportunity",
      presentation: "investigation",
    });
  });

  it("uses code/config or bounded investigation previews for Tech checks", () => {
    expect(solutionTemplate("tech", check("1.6"), INPUT)).toMatchObject({
      kind: "redirect",
      presentation: "code",
    });
    expect(solutionTemplate("tech", check("8.1"), INPUT)).toMatchObject({
      kind: "performance",
      presentation: "investigation",
    });
    expect(solutionTemplate("tech", check("7.3"), INPUT)).toMatchObject({
      kind: "schema",
      presentation: "code",
    });
  });

  it("routes broken-link checks to a link fix instead of the template guard", () => {
    for (const id of ["6.3", "C2"]) {
      const template = solutionTemplate("tech", check(id), INPUT);
      expect(template.kind).toBe("link-integrity");
      expect(template.preview).toContain("link integrity fix");
      expect(template.preview).not.toContain("template guard");
    }
  });

  it("routes reachability checks to adding links, not repairing broken ones", () => {
    // An orphan page and a page with no inbound links need a link added; a
    // repoint/restore/remove preview would be advice for a different problem.
    for (const id of ["C1", "C5", "6.1", "6.2", "6.4"]) {
      const template = solutionTemplate("tech", check(id), INPUT);
      expect(template.kind).toBe("internal-link-exposure");
      expect(template.preview).toContain("discovery path repair");
      expect(template.preview).not.toContain("link integrity fix");
      expect(template.preview).not.toContain("template guard");
    }
  });

  it("routes the new site-level conditions to their own shapes", () => {
    expect(solutionTemplate("tech", check("A7"), INPUT).kind).toBe(
      "indexability",
    );
    expect(solutionTemplate("tech", check("A8"), INPUT).kind).toBe(
      "indexability",
    );
    expect(solutionTemplate("tech", check("C6"), INPUT).kind).toBe("redirect");
    expect(solutionTemplate("tech", check("D7"), INPUT).kind).toBe("canonical");
  });

  it("keeps Tech index-coverage checks on the indexability shape", () => {
    for (const id of ["A1", "A2", "A3", "A4", "1.1", "1.3"]) {
      expect(solutionTemplate("tech", check(id), INPUT).kind).toBe(
        "indexability",
      );
    }
  });

  it("gives every solution kind its own advice, validation, impact, risk, and limit keys", () => {
    const ids = [
      ["seo", "9.1"],
      ["seo", "2.3"],
      ["seo", "3.1"],
      ["seo", "4.1"],
      ["seo", "5.1"],
      ["seo", "6.1"],
      ["seo", "7.1"],
      ["seo", "1.4"],
      ["tech", "1.1"],
      ["tech", "1.2"],
      ["tech", "1.6"],
      ["tech", "1.4"],
      ["tech", "8.1"],
      ["tech", "8.6"],
      ["tech", "2.1"],
      ["tech", "7.3"],
      ["tech", "6.3"],
    ] as const;

    const seen = new Set<string>();
    for (const [agent, id] of ids) {
      const template = solutionTemplate(agent, check(id), INPUT);
      const keys = [
        ...TEMPLATE_TEXT_KEYS.map((field) => template[field]),
        ...template.validationKeys,
      ];
      for (const key of keys) {
        expect(key.startsWith(`recommendations.${agent}.kinds.`)).toBe(true);
      }
      expect(seen.has(template.recommendationKey)).toBe(false);
      seen.add(template.recommendationKey);
    }
    expect(seen.size).toBe(ids.length);
  });

  it("keeps applicable context on the Agent and carries no apply action", () => {
    const template = solutionTemplate("tech", check("1.1"), INPUT);

    expect(template.recommendationKey).toBe(
      "recommendations.tech.kinds.indexability.recommendation",
    );
    expect(template.applicableContextKey).toBe(
      "recommendations.tech.applicableContext",
    );
    expect(template.validationKeys).toEqual([
      "recommendations.tech.kinds.indexability.validation1",
      "recommendations.tech.kinds.indexability.validation2",
      "recommendations.tech.kinds.indexability.validation3",
    ]);
    expect(template).not.toHaveProperty("applyAction");
    expect(template).not.toHaveProperty("deployAction");
  });

  it("addresses the canonical preview to the affected page, not the audit entry", () => {
    const template = solutionTemplate(
      "tech",
      check("1.4"),
      withEvidence([
        evidence("canonical_differs", {
          page_subject: "https://astrologywiki.com/tools/birth-chart",
          canonical_target: "https://astrologywiki.com/",
        }),
      ]),
    );

    // The affected page comes from the evidence; the href stays an author slot
    // because only the reviewer knows which URL should be indexed.
    expect(template.preview).toContain(
      "affected page: https://astrologywiki.com/tools/birth-chart",
    );
    expect(template.preview).toContain(
      "its canonical currently points at: https://astrologywiki.com/",
    );
    expect(template.preview).toContain(
      `<link rel="canonical" href="${FILL_IN}" />`,
    );
    expect(template.preview).toContain("2 of 12 inspected pages affected");
    expect(template.preview).not.toContain("[host]");
    expect(template.preview).not.toContain("[confirmed-200-path]");
  });

  it("fills the redirect preview with the observed hop count and final URL", () => {
    const template = solutionTemplate(
      "tech",
      check("1.6"),
      withEvidence([
        evidence("redirect_chain", {
          redirect_hops: 3,
          final_url: "https://astrologywiki.com/tools/chart",
        }),
      ]),
    );

    expect(template.preview).toContain("observed hops: 3");
    expect(template.preview).toContain(
      'redirect("https://astrologywiki.com/tools/birth-chart", "https://astrologywiki.com/tools/chart", 301)',
    );
    expect(template.preview).not.toContain("[legacy path]");
  });

  it("fills the link fix with the observed broken-target count and source page", () => {
    const template = solutionTemplate(
      "tech",
      check("6.3"),
      withEvidence([
        evidence(
          "page_outbound_broken_link",
          { broken_link_targets: 4 },
          "https://astrologywiki.com/guides/houses",
        ),
      ]),
    );

    expect(template.preview).toContain("observed broken outbound targets: 4");
    expect(template.preview).toContain(
      "https://astrologywiki.com/guides/houses",
    );
  });

  it("quotes the observed title and description in the SEO presentation draft", () => {
    const template = solutionTemplate(
      "seo",
      check("2.5"),
      withEvidence([
        evidence("meta_description_duplicate", {
          meta_description: "Free astrology tools and charts.",
        }),
      ]),
    );

    expect(template.preview).toContain("Free astrology tools and charts.");
    expect(template.preview).toContain("AstrologyWiki · free birth chart");
    expect(template.preview).toContain(FILL_IN);
  });

  it("marks author-supplied slots and uncaptured values with distinct explicit markers", () => {
    const template = solutionTemplate("tech", check("1.4"), {
      ...INPUT,
      measurement: null,
    });

    expect(template.preview).toContain(`measured this run: ${NOT_CAPTURED}`);
    expect(template.preview).toContain(
      `its canonical currently points at: ${NOT_CAPTURED}`,
    );
  });

  it("never leaves a bare bracket placeholder in any rendered preview", () => {
    const ids = [
      ["seo", "9.1"],
      ["seo", "2.3"],
      ["seo", "3.1"],
      ["seo", "4.1"],
      ["seo", "5.1"],
      ["seo", "6.1"],
      ["seo", "7.1"],
      ["seo", "1.4"],
      ["tech", "1.1"],
      ["tech", "1.2"],
      ["tech", "1.6"],
      ["tech", "1.4"],
      ["tech", "8.1"],
      ["tech", "8.6"],
      ["tech", "2.1"],
      ["tech", "7.3"],
      ["tech", "6.3"],
    ] as const;

    for (const [agent, id] of ids) {
      const preview = solutionTemplate(agent, check(id), INPUT).preview;
      const brackets = preview.match(/\[[^\]]*\]/g) ?? [];
      for (const bracket of brackets) {
        expect([FILL_IN, NOT_CAPTURED, "[required property]"]).toContain(
          bracket,
        );
      }
      expect(preview).toContain("https://astrologywiki.com/tools/birth-chart");
    }
  });

  it("truncates a very long observed value instead of pasting a whole document", () => {
    const template = solutionTemplate(
      "seo",
      check("2.5"),
      withEvidence([
        evidence("meta_description_duplicate", {
          meta_description: "x".repeat(400),
        }),
      ]),
    );

    expect(template.preview).toContain("…");
    expect(template.preview).not.toContain("x".repeat(200));
  });
});
