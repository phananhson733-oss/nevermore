import { describe, expect, it } from "vitest";
import { CLEAN_DRAFT } from "./__fixtures__/drafts.ts";
import { FIXTURE_BRIEF, fixturePack, qaInput } from "./__fixtures__/pack.ts";
import { claimIdForRule, evaluateDraftQa } from "./index.ts";
import type { QaRuleId } from "./rule-types.ts";

function rule(markdown: string, ruleId: QaRuleId, brief = FIXTURE_BRIEF) {
  return evaluateDraftQa(
    qaInput(markdown, fixturePack(), undefined, brief),
  ).rules.find((candidate) => candidate.ruleId === ruleId);
}

const GEO_BASE = [
  "# Onboarding analytics for RevOps teams",
  "",
  "## What onboarding analytics covers",
  "",
  "**Onboarding analytics** measures how quickly a new account reaches its",
  "first successful outcome. RevOps leads use it to decide where to invest.",
  "",
  "## Audience for onboarding analytics",
  "",
  "RevOps leads evaluating onboarding tooling own this work.",
  "",
];

const GEO_THIN = GEO_BASE.join("\n");

const GEO_RICH = [
  ...GEO_BASE.slice(0, 7),
  "- **Activation rate** is the share of accounts reaching the milestone.",
  "- **Time to value** is the median days to that milestone.",
  "- **Coverage** is the share of accounts instrumented at all.",
  "",
  ...GEO_BASE.slice(7),
].join("\n");

describe("P3 — GEO citability is advisory, never gating", () => {
  it("gives two drafts with identical assertions the same verdict", () => {
    const thin = evaluateDraftQa(qaInput(GEO_THIN));
    const rich = evaluateDraftQa(qaInput(GEO_RICH));

    expect(thin.verdict).toBe(rich.verdict);
    expect(rich.citability.score).toBeGreaterThan(thin.citability.score);
  });

  it("keeps the citability claim off `failed` even below the advisory floor", () => {
    const thin = evaluateDraftQa(qaInput(GEO_THIN));

    expect(thin.citability.score).toBeLessThan(50);
    expect(
      thin.claims.find(
        (claim) => claim.claimId === claimIdForRule("citability_geo"),
      )?.status,
    ).toBe("passed");
  });
});

describe("RL13 — the re-derived jargon list (decision Q7)", () => {
  it("does not fail ordinary B2B software vocabulary", () => {
    const draft = [
      "# Onboarding analytics",
      "",
      "## What onboarding analytics covers",
      "",
      "**Onboarding analytics** describes the architecture, the ingestion engine,",
      "the scoring mechanism and the robust retry module behind activation.",
      "",
      "## Audience",
      "",
      "RevOps leads evaluating onboarding tooling own this work.",
      "",
    ].join("\n");

    expect(rule(draft, "rl13_banned_jargon")?.pass).toBe(true);
  });

  it("still flags AI-slop vocabulary, advisory only", () => {
    const draft = [
      "# Onboarding analytics",
      "",
      "## What onboarding analytics covers",
      "",
      "**Onboarding analytics** lets teams delve into activation.",
      "",
    ].join("\n");

    expect(rule(draft, "rl13_banned_jargon")?.pass).toBe(false);
    expect(evaluateDraftQa(qaInput(draft)).verdict).not.toBe("blocked");
  });
});

describe("structure checks", () => {
  it("has no opinion on SC1/SC7 when the draft has no `##` section", () => {
    const draft = "# Onboarding analytics\n\nOne paragraph, no sections.\n";

    expect(rule(draft, "sc1_bolded_definition")?.pass).toBe(true);
    expect(rule(draft, "sc7_snippet_bullets")?.pass).toBe(true);
  });

  it("fails a paragraph wall", () => {
    const wall = [
      "# Onboarding analytics",
      "",
      "## What onboarding analytics covers",
      "",
      "**Onboarding analytics** is one. Two. Three. Four. Five. Six. Seven. Eight. Nine.",
      "",
    ].join("\n");

    expect(rule(wall, "sc3_paragraph_wall")?.pass).toBe(false);
  });

  it("reports the internal-link rules as unevaluated with a stated reason", () => {
    const sc2 = rule(CLEAN_DRAFT, "sc2_internal_link_density");
    const sc4 = rule(CLEAN_DRAFT, "sc4_link_distribution");

    expect(sc2?.evaluable).toBe(false);
    expect(sc2?.detail).toContain("no own-domain");
    expect(sc4?.evaluable).toBe(false);
  });

  it("keeps customer-visible structure details free of the internal brand", () => {
    const sources = rule(CLEAN_DRAFT, "sc9_sources_section");

    expect(sources?.detail).not.toMatch(/SignalFrame/i);
  });

  it("detects a draft that merely restates the brief", () => {
    const restated = [
      "# Onboarding analytics",
      "",
      "## What onboarding analytics covers",
      "",
      "**Onboarding analytics** matters because we must define the activation",
      "milestone and say who owns it, define the activation milestone and say who",
      "owns it, define the activation milestone and say who owns it, define the",
      "activation milestone and say who owns it, define the activation milestone",
      "and say who owns it.",
      "",
    ].join("\n");
    const brief = [
      "## What onboarding analytics covers",
      "",
      "define the activation milestone and say who owns it, define the activation",
      "milestone and say who owns it, define the activation milestone and say who",
      "owns it, define the activation milestone and say who owns it, define the",
      "activation milestone and say who owns it.",
      "",
    ].join("\n");

    const result = rule(restated, "scdup_brief_overlap", brief);
    expect(result?.pass).toBe(false);
    expect(evaluateDraftQa(qaInput(restated, fixturePack(), undefined, brief)).verdict)
      .not.toBe("blocked");
  });
});

describe("input bounds", () => {
  it("reviews an oversized draft instead of running the quadratic checks on it", () => {
    const huge = `# Onboarding analytics\n\n${"word ".repeat(120_000)}`;
    const evaluation = evaluateDraftQa(qaInput(huge));

    expect(evaluation.verdict).toBe("needs_review");
    expect(evaluation.rules.every((entry) => !entry.evaluable)).toBe(true);
    expect(evaluation.rules[0]?.detail).toContain("Nothing was judged");
  });
});

describe("keyword rules", () => {
  it("fails a stuffed draft", () => {
    const stuffed = [
      "# Onboarding analytics",
      "",
      "## What onboarding analytics covers",
      "",
      `**Onboarding analytics** ${"onboarding analytics ".repeat(20)}`,
      "",
    ].join("\n");

    expect(rule(stuffed, "rl5_keyword_stuffing")?.pass).toBe(false);
  });

  it("passes a normally weighted draft", () => {
    expect(rule(CLEAN_DRAFT, "rl5_keyword_stuffing")?.pass).toBe(true);
    expect(rule(CLEAN_DRAFT, "rl4_keyword_anchor")?.pass).toBe(true);
  });
});
