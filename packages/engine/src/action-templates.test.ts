import { describe, expect, it } from "vitest";
import { ACTION_TEMPLATES } from "./action-templates.ts";

/**
 * The Action template registry is the ONE mapping from a rule to the single
 * artifact type its Action mints (spec §9.2), and Slice 2 red line B rests on
 * it: `confirmFinding` resolves a template from `finding.rule_id`, so the
 * registry being total over the executed rule set is what makes "one confirmed
 * Finding -> one Action -> one artifact type" mechanical instead of incidental.
 *
 * These assertions exist to fail loudly if a future rule change silently drops
 * a mapping (which would surface as a 503 at confirm time) or promotes
 * `english_blog_draft` — the shadow-only draft type — into an operator-mintable
 * template.
 */
describe("ACTION_TEMPLATES", () => {
  it("registers exactly the twelve shipped deterministic rules", () => {
    expect(Object.keys(ACTION_TEMPLATES)).toHaveLength(12);
  });

  it("binds content_brief to exactly the four content rules", () => {
    const contentBriefRules = Object.entries(ACTION_TEMPLATES)
      .filter(([, template]) => template.artifactType === "content_brief")
      .map(([ruleId]) => ruleId)
      .sort();

    expect(contentBriefRules).toEqual([
      "CONTENT-COVERAGE-001",
      "CONTENT-GAP-011",
      "CRO-LANDING-003",
      "SEARCH-DECAY-002",
    ]);
  });

  it("never mints english_blog_draft from a template", () => {
    // english_blog_draft belongs to the Content Shadow worker alone. A template
    // declaring it would make the public artifact route able to cast one.
    for (const template of Object.values(ACTION_TEMPLATES)) {
      expect(template.artifactType).not.toBe("english_blog_draft");
    }
  });

  it("gives every rule a distinct template id", () => {
    // action_key = sha256({projectId, findingKey, templateId}); a shared
    // templateId across rules would alias two Findings onto one Action.
    const templateIds = Object.values(ACTION_TEMPLATES).map(
      (template) => template.templateId,
    );
    expect(new Set(templateIds).size).toBe(templateIds.length);
  });

  it("uses the broader v2 internal-link repair template", () => {
    expect(ACTION_TEMPLATES["TECH-LINKGRAPH-005"]).toMatchObject({
      templateId: "repair_internal_link_architecture.v2",
      templateVersion: 2,
      artifactType: "technical_ticket",
    });
  });

  it("keeps sitemap/indexability resolution human-reviewed and high-risk", () => {
    expect(ACTION_TEMPLATES["TECH-INDEXABILITY-006"]).toEqual({
      templateId: "resolve_sitemap_indexability_conflict.v1",
      artifactType: "technical_ticket",
      templateVersion: 1,
      effort: "medium",
      risk: "high",
      copy: {
        en: {
          title: "Resolve a sitemap and indexability conflict",
          description:
            "Confirm the intended index state, then align the sitemap entry and page-level indexability signal without changing the canonical URL unintentionally.",
          expectedOutcome:
            "The URL no longer has contradictory sitemap membership and indexability signals, while the intended canonical URL remains verifiable.",
        },
        "zh-CN": {
          title: "解决 Sitemap 与可索引性冲突",
          description:
            "先确认页面预期的收录状态，再协调 Sitemap 条目与页面级索引信号，避免误改 canonical URL。",
          expectedOutcome:
            "该 URL 的 Sitemap 成员关系与可索引性信号不再冲突，同时预期 canonical URL 仍可验证。",
        },
      },
    });
  });
});
