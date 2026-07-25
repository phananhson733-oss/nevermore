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
  it("registers exactly the eleven executed MVP rules", () => {
    expect(Object.keys(ACTION_TEMPLATES)).toHaveLength(11);
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
});
