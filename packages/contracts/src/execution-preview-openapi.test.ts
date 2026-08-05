import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { components } from "./generated/openapi.ts";
import type { ExecutionPreview as RuntimeExecutionPreview } from "./zod/execution-preview.ts";
import type { OpportunityRuleId as RuntimeOpportunityRuleId } from "./zod/opportunities.ts";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Expect<Value extends true> = Value;
type RequiredKeys<Value> = {
  [Key in keyof Value]-?: Record<never, never> extends Pick<Value, Key>
    ? never
    : Key;
}[keyof Value];

type GeneratedExecutionPreview = components["schemas"]["ExecutionPreview"];
type GeneratedGrowthMapUrlFinding =
  components["schemas"]["GrowthMapUrlFinding"];
type GeneratedGrowthOpportunity =
  components["schemas"]["GrowthOpportunity"];
type CandidateGrowthOpportunity = Extract<
  GeneratedGrowthOpportunity,
  { readiness: "candidate" }
>;
type ReviewableGrowthOpportunity = Extract<
  GeneratedGrowthOpportunity,
  { readiness: "reviewable" }
>;
type ConfirmedGrowthOpportunity = Extract<
  GeneratedGrowthOpportunity,
  { readiness: "confirmed" }
>;

type _ExecutionPreviewMatchesRuntime = Expect<
  Equal<GeneratedExecutionPreview, RuntimeExecutionPreview>
>;
type _OpportunityRuleIdsMatchRuntime = Expect<
  Equal<
    components["schemas"]["OpportunityRuleId"],
    RuntimeOpportunityRuleId
  >
>;
type _GrowthMapPreviewIsRequired = Expect<
  Equal<
    Extract<RequiredKeys<GeneratedGrowthMapUrlFinding>, "executionPreview">,
    "executionPreview"
  >
>;
type _GrowthMapPreviewIsSharedNullableSchema = Expect<
  Equal<
    GeneratedGrowthMapUrlFinding["executionPreview"],
    GeneratedExecutionPreview | null
  >
>;
type _CandidateVariantExists = Expect<
  Equal<CandidateGrowthOpportunity extends never ? false : true, true>
>;
type _CandidateDoesNotAcceptPreview = Expect<
  Equal<
    "executionPreview" extends keyof CandidateGrowthOpportunity ? true : false,
    false
  >
>;
type _ReviewablePreviewIsRequired = Expect<
  Equal<
    Extract<RequiredKeys<ReviewableGrowthOpportunity>, "executionPreview">,
    "executionPreview"
  >
>;
type _ReviewablePreviewIsSharedNullableSchema = Expect<
  Equal<
    ReviewableGrowthOpportunity["executionPreview"],
    GeneratedExecutionPreview | null
  >
>;
type _ConfirmedPreviewIsRequired = Expect<
  Equal<
    Extract<RequiredKeys<ConfirmedGrowthOpportunity>, "executionPreview">,
    "executionPreview"
  >
>;
type _ConfirmedPreviewIsSharedNullableSchema = Expect<
  Equal<
    ConfirmedGrowthOpportunity["executionPreview"],
    GeneratedExecutionPreview | null
  >
>;

const generated = readFileSync(
  new URL("./generated/openapi.ts", import.meta.url),
  "utf8",
);
const implementationOpenApi = readFileSync(
  new URL("../../../openapi/mvp.yaml", import.meta.url),
  "utf8",
);

function schemaSource(name: string, nextName: string): string {
  const start = generated.indexOf(`        ${name}:`);
  const end = generated.indexOf(`        ${nextName}:`, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return generated.slice(start, end);
}

describe("Execution Preview generated OpenAPI contract", () => {
  it("publishes the strict shared presentational shape once", () => {
    const preview = schemaSource("ExecutionPreview", "WorkShape");

    expect(preview).toContain("templateId: string;");
    expect(preview).toContain("templateVersion: 1 | 2;");
    expect(preview).toContain(
      'artifactType: components["schemas"]["ArtifactType"];',
    );
    expect(preview).toContain('effort: "small" | "medium" | "large";');
    expect(preview).toContain('risk: "low" | "medium" | "high";');
    expect(preview).toContain('contentLocale: "en" | "zh-CN";');
    expect(preview).toContain("title: string;");
    expect(preview).toContain("description: string;");
    expect(preview).toContain("expectedOutcome: string;");
    expect(generated.match(/^ {8}ExecutionPreview:/gm)).toHaveLength(1);
  });

  it("references the shared preview only from the three read projections", () => {
    expect(
      generated.match(/components\["schemas"\]\["ExecutionPreview"\]/g),
    ).toHaveLength(3);

    const growthMap = schemaSource(
      "GrowthMapUrlFinding",
      "GrowthMapUrlPortfolioItem",
    );
    expect(growthMap).toContain(
      'executionPreview: components["schemas"]["ExecutionPreview"] | null;',
    );
  });

  it("locks the new Opportunity rule to version one in the machine schema", () => {
    expect(implementationOpenApi).toMatch(
      /OpportunityRuleId:\n[\s\S]*?- TECH-INDEXABILITY-006\n/,
    );
    expect(implementationOpenApi).toMatch(
      /if:\n\s+properties:\n\s+ruleId: \{ const: TECH-INDEXABILITY-006 \}\n\s+required: \[ruleId\]\n\s+then:\n\s+properties:\n\s+ruleVersion: \{ const: 1 \}/,
    );
  });
});
