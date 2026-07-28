import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type {
  components,
  operations,
  paths,
} from "./generated/openapi.ts";
import type {
  CreateMeasurementWindowRequest as CreateMeasurementWindowRequestZod,
  MeasurementWindowAccepted as MeasurementWindowAcceptedZod,
  MeasurementWindowHistoryResponse as MeasurementWindowHistoryResponseZod,
  MeasurementWindowRecentResponse as MeasurementWindowRecentResponseZod,
} from "./zod/measurement.ts";

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

type MeasurementHistoryOperation =
  operations["getProjectMeasurementWindowHistory"];
type MeasurementRecentOperation =
  operations["getProjectRecentMeasurementWindows"];
type CreateMeasurementOperation =
  operations["createProjectMeasurementWindow"];
type MeasurementHistoryQuery = NonNullable<
  MeasurementHistoryOperation["parameters"]["query"]
>;
type CreateMeasurementHeaders = NonNullable<
  CreateMeasurementOperation["parameters"]["header"]
>;
type MeasurementRecentQuery = NonNullable<
  MeasurementRecentOperation["parameters"]["query"]
>;
type CreateMeasurementRequest =
  CreateMeasurementOperation["requestBody"]["content"]["application/json"];
type CreateMeasurementHttpResponse =
  CreateMeasurementOperation["responses"][202]["content"]["application/json"];
type MeasurementHistoryHttpResponse =
  MeasurementHistoryOperation["responses"][200]["content"]["application/json"];
type MeasurementRecentHttpResponse =
  MeasurementRecentOperation["responses"][200]["content"]["application/json"];
type MeasurementAccepted =
  components["schemas"]["MeasurementWindowAccepted"];
type MeasurementHistory =
  components["schemas"]["MeasurementWindowHistoryResponse"];
type MeasurementRecent =
  components["schemas"]["MeasurementWindowRecentResponse"];
type MeasurementWindow = components["schemas"]["MeasurementWindow"];
type MeasurementDimensions =
  components["schemas"]["MeasurementDimensions"];
type MeasurementHistoryPath =
  paths["/projects/{projectId}/measurement-windows"];
type MeasurementRecentPath =
  paths["/projects/{projectId}/measurement-windows/recent"];

type _QueryKeysAreExact = Expect<
  Equal<keyof MeasurementHistoryQuery, "sitePageId" | "targetRef" | "limit">
>;
type _RequiredQueryKeysAreExact = Expect<
  Equal<RequiredKeys<MeasurementHistoryQuery>, "sitePageId" | "targetRef">
>;
type _RecentQueryHasOnlyOptionalLimit = Expect<
  Equal<keyof MeasurementRecentQuery, "limit">
>;
type _RecentQueryHasNoRequiredKeys = Expect<
  Equal<RequiredKeys<MeasurementRecentQuery>, never>
>;
type _CreateHeaderIsExact = Expect<
  Equal<keyof CreateMeasurementHeaders, "Idempotency-Key">
>;
type _CreateHeaderIsRequired = Expect<
  Equal<RequiredKeys<CreateMeasurementHeaders>, "Idempotency-Key">
>;
type _GeneratedCreateRequestMatchesRuntime = Expect<
  Equal<CreateMeasurementRequest, CreateMeasurementWindowRequestZod>
>;
type _GeneratedAcceptedMatchesRuntime = Expect<
  Equal<MeasurementAccepted, MeasurementWindowAcceptedZod>
>;
type _CreateHttpEnvelopeIsExact = Expect<
  Equal<CreateMeasurementHttpResponse["data"], MeasurementAccepted>
>;
type _HttpEnvelopeIsExact = Expect<
  Equal<MeasurementHistoryHttpResponse["data"], MeasurementHistory>
>;
type _RecentHttpEnvelopeIsExact = Expect<
  Equal<MeasurementRecentHttpResponse["data"], MeasurementRecent>
>;
type _GeneratedResponseExtendsRuntimeContract = Expect<
  MeasurementHistory extends MeasurementWindowHistoryResponseZod
    ? true
    : false
>;
type _RuntimeContractExtendsGeneratedResponse = Expect<
  MeasurementWindowHistoryResponseZod extends MeasurementHistory
    ? true
    : false
>;
type _GeneratedRecentMatchesRuntimeContract = Expect<
  Equal<MeasurementRecent, MeasurementWindowRecentResponseZod>
>;
type _HistoryFieldsAreExact = Expect<
  Equal<
    keyof MeasurementHistory,
    "projectId" | "target" | "windows" | "generatedAt"
  >
>;
type _HistoryFieldsAreRequired = Expect<
  Equal<RequiredKeys<MeasurementHistory>, keyof MeasurementHistory>
>;
type _WindowCarriesReceiptLineage = Expect<
  Equal<
    Pick<
      MeasurementWindow,
      "verifiedChangeReceipt" | "timelineDeliveryReceipt"
    >,
    {
      verifiedChangeReceipt: components["schemas"]["PublicationChangeReceipt"];
      timelineDeliveryReceipt:
        | components["schemas"]["PublicationDeliveryReceipt"]
        | null;
    }
  >
>;
type _WindowCarriesAbsoluteWindows = Expect<
  Equal<
    Pick<MeasurementWindow, "beforeWindow" | "afterWindow" | "timezone">,
    {
      beforeWindow: components["schemas"]["MeasurementWindowInterval"];
      afterWindow: components["schemas"]["MeasurementWindowInterval"];
      timezone: string;
    }
  >
>;
type _DimensionsAreExact = Expect<
  Equal<keyof MeasurementDimensions, "gsc" | "ga4" | "geo">
>;
type _PathHasOnlyImplementedGetAndPost = Expect<
  Equal<
    | MeasurementHistoryPath["put"]
    | MeasurementHistoryPath["patch"]
    | MeasurementHistoryPath["delete"]
    | MeasurementHistoryPath["head"]
    | MeasurementHistoryPath["options"]
    | MeasurementHistoryPath["trace"],
    undefined
  >
>;
type _RecentPathHasOnlyImplementedGet = Expect<
  Equal<
    | MeasurementRecentPath["post"]
    | MeasurementRecentPath["put"]
    | MeasurementRecentPath["patch"]
    | MeasurementRecentPath["delete"]
    | MeasurementRecentPath["head"]
    | MeasurementRecentPath["options"]
    | MeasurementRecentPath["trace"],
    undefined
  >
>;

const generated = readFileSync(
  new URL("./generated/openapi.ts", import.meta.url),
  "utf8",
);

describe("Measurement Window history generated OpenAPI contract", () => {
  it("publishes the exact-target GET and the implemented Change-Receipt POST", () => {
    expect(generated).toContain(
      '"/projects/{projectId}/measurement-windows": {',
    );
    expect(generated).toContain(
      'get: operations["getProjectMeasurementWindowHistory"];',
    );
    expect(generated).toContain(
      'post: operations["createProjectMeasurementWindow"];',
    );
  });

  it("publishes the project-wide recent feed without target filters or fabricated aggregates", () => {
    expect(generated).toContain(
      '"/projects/{projectId}/measurement-windows/recent": {',
    );
    expect(generated).toContain(
      'get: operations["getProjectRecentMeasurementWindows"];',
    );

    const schemaStart = generated.indexOf(
      "MeasurementWindowRecentResponse:",
    );
    const schemaEnd = generated.indexOf(
      "MeasurementWindowRecentHttpResponse:",
      schemaStart,
    );
    const recentSchema = generated.slice(schemaStart, schemaEnd);
    expect(schemaStart).toBeGreaterThan(-1);
    expect(schemaEnd).toBeGreaterThan(schemaStart);
    expect(recentSchema).toContain("projectId:");
    expect(recentSchema).toContain("windows:");
    expect(recentSchema).toContain("generatedAt:");
    expect(recentSchema).not.toContain("targetRef:");
    expect(recentSchema).not.toContain("aggregateLift:");
    expect(recentSchema).not.toContain("causal");
  });

  it("does not let the browser author target, time-window, provider, or result facts", () => {
    const requestStart = generated.indexOf(
      "CreateMeasurementWindowRequest:",
    );
    const requestEnd = generated.indexOf(
      "MeasurementWindowAccepted:",
      requestStart,
    );
    const requestSchema = generated.slice(requestStart, requestEnd);

    expect(requestStart).toBeGreaterThan(-1);
    expect(requestEnd).toBeGreaterThan(requestStart);
    expect(requestSchema).toContain("changeReceiptId:");
    expect(requestSchema).toContain("idempotencyKey:");
    for (const field of [
      "target:",
      "beforeWindow:",
      "afterWindow:",
      "dimensions:",
      "state:",
      "recordedAt:",
    ]) {
      expect(requestSchema).not.toContain(field);
    }
  });

  it("keeps the customer-visible before/after evidence and publication lineage", () => {
    for (const field of [
      "verifiedChangeReceipt",
      "timelineDeliveryReceipt",
      "beforeWindow",
      "afterWindow",
      "dimensions",
      "campaigns",
      "directConversionDefinition",
      "assistedConversionDefinition",
      "generatedAt",
    ]) {
      expect(generated).toContain(`${field}:`);
    }
  });
});
