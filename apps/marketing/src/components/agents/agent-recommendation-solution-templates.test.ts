// @input  -- the same evaluated v2 checks viewed through SEO and Tech Agents
// @output -- regression coverage for Agent-specific solution language and previews
// @pos    -- pure contract guard for Stage 04 semantics

import { describe, expect, it } from "vitest";
import type { AgentAuditEvaluatedCheck } from "@sf/public-tools/agent-audit";

import { solutionTemplate } from "./agent-solution-templates";

function check(id: string): AgentAuditEvaluatedCheck {
  return {
    check: {
      id,
      scope: "page",
      groupId: id.split(".")[0] ?? id,
    },
    result: "warning",
    evidenceRecordIds: [],
  } as unknown as AgentAuditEvaluatedCheck;
}

describe("Agent-specific selected solution templates", () => {
  it("turns the same canonical evidence into an SEO issue brief and a Tech config fix", () => {
    const seo = solutionTemplate("seo", check("1.4"));
    const tech = solutionTemplate("tech", check("1.4"));

    expect(seo.kind).toBe("technical-issue-brief");
    expect(seo.presentation).toBe("content");
    expect(seo.preview).toContain("technical issue brief");
    expect(tech.kind).toBe("canonical");
    expect(tech.presentation).toBe("code");
    expect(tech.preview).toContain('rel="canonical"');
    expect(seo.preview).not.toBe(tech.preview);
  });

  it("uses search/content previews for SEO metadata, headings, links, and search opportunity", () => {
    expect(solutionTemplate("seo", check("2.3"))).toMatchObject({
      kind: "search-presentation",
      presentation: "content",
    });
    expect(solutionTemplate("seo", check("3.1")).kind).toBe(
      "heading-structure",
    );
    expect(solutionTemplate("seo", check("6.1")).kind).toBe(
      "internal-link-exposure",
    );
    expect(solutionTemplate("seo", check("9.1"))).toMatchObject({
      kind: "search-opportunity",
      presentation: "investigation",
    });
  });

  it("uses code/config or bounded investigation previews for Tech checks", () => {
    expect(solutionTemplate("tech", check("1.6"))).toMatchObject({
      kind: "redirect",
      presentation: "code",
    });
    expect(solutionTemplate("tech", check("8.1"))).toMatchObject({
      kind: "performance",
      presentation: "investigation",
    });
    expect(solutionTemplate("tech", check("7.3"))).toMatchObject({
      kind: "schema",
      presentation: "code",
    });
  });

  it("uses only generic recommendation i18n keys and carries no apply action", () => {
    const template = solutionTemplate("tech", check("1.1"));

    expect(template.recommendationKey).toBe(
      "recommendations.tech.recommendation",
    );
    expect(template.applicableContextKey).toBe(
      "recommendations.tech.applicableContext",
    );
    expect(template.validationKeys).toEqual([
      "recommendations.tech.validation1",
      "recommendations.tech.validation2",
      "recommendations.tech.validation3",
    ]);
    expect(template).not.toHaveProperty("applyAction");
    expect(template).not.toHaveProperty("deployAction");
  });
});
