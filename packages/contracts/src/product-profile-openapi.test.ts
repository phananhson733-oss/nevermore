import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { components, operations } from "./generated/openapi.ts";
import type { ConfirmedProductProfile as ConfirmedProductProfileZod } from "./zod/product-profile.ts";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Expect<Value extends true> = Value;

type ActiveSynthesisRun =
  components["schemas"]["ProductProfileActiveSynthesisRun"];
type CreateProductProfileProject =
  components["schemas"]["ProductProfileCreateProjectRequest"];
type DraftProfile = components["schemas"]["ProductProfileDraft"];
type ConfirmedProfile = components["schemas"]["ConfirmedProductProfile"];
type ProductProfileWorkspaceResponse =
  operations["getProjectProductProfile"]["responses"][200]["content"]["application/json"];
type ConfirmProductProfileResponse =
  operations["confirmProductProfile"]["responses"][200]["content"]["application/json"];
type EditablePatch = components["schemas"]["ProductProfileEditablePatch"];
type ForbiddenEditableKeys = Extract<
  keyof EditablePatch,
  | "sourceSiteId"
  | "sourceSnapshotId"
  | "analysisInvocationId"
  | "fieldProvenance"
  | "competitorCandidates"
>;

type _ActiveKind = Expect<
  Equal<ActiveSynthesisRun["kind"], "product_profile_synthesis">
>;
type _ActiveStatus = Expect<
  Equal<ActiveSynthesisRun["status"], "queued" | "running">
>;
type _ConfirmedWorkspaceRow = Expect<
  Equal<
    ProductProfileWorkspaceResponse["data"]["confirmedProfile"],
    components["schemas"]["ConfirmedProductProfileRowDto"] | null
  >
>;
type _ConfirmResponseRow = Expect<
  Equal<
    ConfirmProductProfileResponse["data"],
    components["schemas"]["ConfirmedProductProfileRowDto"]
  >
>;
type _NoServerOwnedEditableKeys = Expect<Equal<ForbiddenEditableKeys, never>>;
type _CreateCustomerModel = Expect<
  Equal<
    CreateProductProfileProject["customerModel"],
    components["schemas"]["ProductProfileCustomerModel"] | undefined
  >
>;
type _CreateGrowthObjectives = Expect<
  Equal<
    CreateProductProfileProject["growthObjectives"],
    components["schemas"]["ProductProfileGrowthObjective"][] | undefined
  >
>;
type _DraftCustomerModel = Expect<
  Equal<
    DraftProfile["customerModel"],
    components["schemas"]["ProductProfileCustomerModel"] | undefined
  >
>;
type _DraftGrowthObjectives = Expect<
  Equal<
    DraftProfile["growthObjectives"],
    components["schemas"]["ProductProfileGrowthObjective"][] | undefined
  >
>;
type _EditableCustomerModel = Expect<
  Equal<
    EditablePatch["customerModel"],
    components["schemas"]["ProductProfileCustomerModel"] | undefined
  >
>;
type _EditableGrowthObjectives = Expect<
  Equal<
    EditablePatch["growthObjectives"],
    components["schemas"]["ProductProfileGrowthObjective"][] | undefined
  >
>;
type _ConfirmedProductName = Expect<
  Equal<ConfirmedProfile["productName"], string>
>;
type _ConfirmedZodProductName = Expect<
  Equal<ConfirmedProductProfileZod["productName"], string>
>;
type _ConfirmedBusinessModels = Expect<
  Equal<ConfirmedProfile["businessModels"], string[]>
>;
type _ConfirmedMarkets = Expect<
  Equal<
    ConfirmedProfile["targetMarkets"],
    components["schemas"]["ProductProfileTargetMarket"][]
  >
>;
type _ConfirmedAudiences = Expect<
  Equal<
    ConfirmedProfile["targetAudiences"],
    components["schemas"]["ProductProfileTargetAudience"][]
  >
>;

const generated = readFileSync(
  new URL("./generated/openapi.ts", import.meta.url),
  "utf8",
);
const openapi = readFileSync(
  new URL("../../../openapi/mvp.yaml", import.meta.url),
  "utf8",
);

describe("Product Profile generated OpenAPI contract", () => {
  it("keeps active onboarding runs and confirmed rows narrow in generated clients", () => {
    expect(generated).toContain(
      'kind: "product_profile_synthesis";',
    );
    expect(generated).toContain(
      'activeSynthesisRun: components["schemas"]["ProductProfileActiveSynthesisRun"] | null;',
    );
    expect(generated).toContain('kind: "collection";');
    expect(generated).toContain(
      'activeCrawlRun: components["schemas"]["ProductProfileActiveCrawlRun"] | null;',
    );
    expect(generated).toContain(
      'confirmedProfile: components["schemas"]["ConfirmedProductProfileRowDto"] | null;',
    );
    expect(generated).toContain(
      'customerModel?: components["schemas"]["ProductProfileCustomerModel"];',
    );
    expect(generated).toContain(
      'growthObjectives?: components["schemas"]["ProductProfileGrowthObjective"][];',
    );
  });

  it("documents URL-first declarations and the mode-dependent project location", () => {
    const createStart = openapi.indexOf("operationId: createProject");
    const createEnd = openapi.indexOf("operationId:", createStart + 1);
    const createOperation = openapi.slice(createStart, createEnd);
    const requestStart = openapi.indexOf(
      "ProductProfileCreateProjectRequest:",
    );
    const requestEnd = openapi.indexOf(
      "ProductProfileCustomerModel:",
      requestStart,
    );
    const requestSchema = openapi.slice(requestStart, requestEnd);

    expect(createOperation).toContain(
      "^/p/[0-9a-f-]+/(?:overview|context)$",
    );
    for (const field of [
      "productName:",
      "customerModel:",
      "primaryMarket:",
      "growthObjectives:",
    ]) {
      expect(requestSchema).toContain(field);
    }
  });
});
