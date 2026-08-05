import { isBcp47LanguageTag } from "@sf/contracts";
import { subjectUrlOf } from "@sf/sources";

import type { EngineConversion } from "./icp.ts";

/** Exact schema carried inside a current-generation DiagnosticRun manifest. */
export const CONTEXT_PROJECTION_SCHEMA_VERSION = "context-projection.v1";

/** Self-description for the pure compiler; executor selection remains rule-set based. */
export const CONTEXT_PROJECTION_COMPILER_VERSION =
  "context-projection.compiler.1.0.0";

export type ContextProjectionProfileGeneration =
  | "product-profile.0.3.0"
  | "legacy-icp.v1";

export interface ContextProjectionV1 {
  readonly schemaVersion: typeof CONTEXT_PROJECTION_SCHEMA_VERSION;
  readonly compilerVersion: typeof CONTEXT_PROJECTION_COMPILER_VERSION;
  readonly profileGeneration: ContextProjectionProfileGeneration;
  readonly productRouting: {
    readonly sourceKind: "product_profile" | "legacy_icp";
    readonly productName: string;
    readonly oneLiner: string;
    readonly productType: string;
    readonly businessModels: readonly string[];
    readonly primaryMarket: string | null;
    readonly primaryAudience: string | null;
  };
  readonly siteLanguage: {
    readonly sourceKind: "site";
    readonly state: "declared_non_empty" | "declared_empty";
    readonly languageCodes: readonly string[];
  };
  readonly primaryConversion:
    | {
        readonly state: "available";
        readonly sourceKind: "legacy_icp";
        readonly value: EngineConversion;
      }
    | {
        readonly state: "missing";
        readonly sourceKind:
          | "legacy_icp"
          | "not_declared_for_generation";
      };
  readonly priorityUrlSubjects:
    | {
        readonly state: "available";
        readonly sourceKind: "legacy_icp";
        readonly sourceHash: string;
        readonly normalizedRefs: readonly string[];
      }
    | {
        readonly state: "missing";
        readonly sourceKind:
          | "legacy_icp"
          | "not_declared_for_generation";
      };
  readonly declaredExecutionConstraints:
    | {
        readonly state: "available";
        readonly sourceKind: "legacy_icp";
        readonly technical: readonly string[];
        readonly resource: readonly string[];
      }
    | {
        readonly state: "missing";
        readonly sourceKind:
          | "legacy_icp"
          | "not_declared_for_generation";
      };
}

export interface BuildContextProjectionV1Input {
  /** Immutable IcpProfile.content_hash already selected for the run. */
  readonly profileContentHash: string;
  /** Immutable IcpProfile.profile JSON selected for the run. */
  readonly profile: unknown;
  /** Current Site.languageCodes frozen at run creation. */
  readonly siteLanguageCodes: readonly string[];
}

const CURRENT_PROFILE_SCHEMA_VERSION = "product-profile.0.3.0";
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const MARKET_CODE = /^[A-Z]{2}$/u;

/**
 * Compile only stable, declared business routing facts. Snapshot availability,
 * workflow state, priorities, permissions, and inferred execution facts belong
 * to their existing authorities and are intentionally absent here.
 */
export function buildContextProjectionV1(
  value: BuildContextProjectionV1Input,
): ContextProjectionV1 {
  const input = record(value, "input");
  exactKeys(
    input,
    ["profileContentHash", "profile", "siteLanguageCodes"],
    "input",
  );
  const profileContentHash = sha256(
    input["profileContentHash"],
    "input.profileContentHash",
  );
  const profile = record(input["profile"], "input.profile");
  const profileGeneration = profileGenerationOf(profile);
  const languageCodes = declaredLanguageCodes(
    input["siteLanguageCodes"],
    "input.siteLanguageCodes",
  );
  const siteLanguage = {
    sourceKind: "site" as const,
    state:
      languageCodes.length === 0
        ? ("declared_empty" as const)
        : ("declared_non_empty" as const),
    languageCodes,
  };

  const candidate: ContextProjectionV1 =
    profileGeneration === CURRENT_PROFILE_SCHEMA_VERSION
      ? {
          schemaVersion: CONTEXT_PROJECTION_SCHEMA_VERSION,
          compilerVersion: CONTEXT_PROJECTION_COMPILER_VERSION,
          profileGeneration,
          productRouting: currentProductRouting(profile),
          siteLanguage,
          primaryConversion: {
            state: "missing",
            sourceKind: "not_declared_for_generation",
          },
          priorityUrlSubjects: {
            state: "missing",
            sourceKind: "not_declared_for_generation",
          },
          declaredExecutionConstraints: {
            state: "missing",
            sourceKind: "not_declared_for_generation",
          },
        }
      : {
          schemaVersion: CONTEXT_PROJECTION_SCHEMA_VERSION,
          compilerVersion: CONTEXT_PROJECTION_COMPILER_VERSION,
          profileGeneration,
          productRouting: legacyProductRouting(profile),
          siteLanguage,
          primaryConversion: legacyPrimaryConversion(profile),
          priorityUrlSubjects: legacyPriorityUrls(
            profile,
            profileContentHash,
          ),
          declaredExecutionConstraints: legacyConstraints(profile),
        };

  // One parser owns exact shape and canonical-output validation for both writer
  // and reader call sites. It also returns a fresh deeply frozen graph.
  return parseContextProjectionV1(candidate);
}

/**
 * Strictly parse untrusted manifest JSON. Unknown fields and non-canonical
 * values throw instead of being stripped or silently repaired.
 */
export function parseContextProjectionV1(value: unknown): ContextProjectionV1 {
  const root = record(value, "contextProjection");
  exactKeys(
    root,
    [
      "schemaVersion",
      "compilerVersion",
      "profileGeneration",
      "productRouting",
      "siteLanguage",
      "primaryConversion",
      "priorityUrlSubjects",
      "declaredExecutionConstraints",
    ],
    "contextProjection",
  );
  if (root["schemaVersion"] !== CONTEXT_PROJECTION_SCHEMA_VERSION) {
    throw invalid(
      `contextProjection.schemaVersion must equal "${CONTEXT_PROJECTION_SCHEMA_VERSION}"`,
    );
  }
  if (root["compilerVersion"] !== CONTEXT_PROJECTION_COMPILER_VERSION) {
    throw invalid(
      `contextProjection.compilerVersion must equal "${CONTEXT_PROJECTION_COMPILER_VERSION}"`,
    );
  }
  const profileGeneration = enumValue(
    root["profileGeneration"],
    [CURRENT_PROFILE_SCHEMA_VERSION, "legacy-icp.v1"] as const,
    "contextProjection.profileGeneration",
  );
  const projection: ContextProjectionV1 = {
    schemaVersion: CONTEXT_PROJECTION_SCHEMA_VERSION,
    compilerVersion: CONTEXT_PROJECTION_COMPILER_VERSION,
    profileGeneration,
    productRouting: parseProductRouting(
      root["productRouting"],
      profileGeneration,
    ),
    siteLanguage: parseSiteLanguage(root["siteLanguage"]),
    primaryConversion: parsePrimaryConversion(
      root["primaryConversion"],
      profileGeneration,
    ),
    priorityUrlSubjects: parsePriorityUrls(
      root["priorityUrlSubjects"],
      profileGeneration,
    ),
    declaredExecutionConstraints: parseConstraints(
      root["declaredExecutionConstraints"],
      profileGeneration,
    ),
  };
  return deepFreeze(projection);
}

function currentProductRouting(
  profile: Record<string, unknown>,
): ContextProjectionV1["productRouting"] {
  const markets = objectArray(
    profile["targetMarkets"],
    "input.profile.targetMarkets",
  );
  const primaryMarkets = markets
    .filter((market) => market["priority"] === "primary")
    .map((market, index) =>
      marketCode(
        market["marketCode"],
        `input.profile.targetMarkets[primary:${index}].marketCode`,
      ),
    );
  if (primaryMarkets.length > 1) {
    throw invalid("input.profile.targetMarkets has more than one primary market");
  }

  const audiences = objectArray(
    profile["targetAudiences"],
    "input.profile.targetAudiences",
  );
  const primaryAudiences = audiences.filter(
    (audience) => audience["reviewStatus"] === "primary",
  );
  if (primaryAudiences.length > 1) {
    throw invalid(
      "input.profile.targetAudiences has more than one primary audience",
    );
  }
  const primaryAudience =
    primaryAudiences[0] ??
    audiences
      .filter((audience) => audience["reviewStatus"] !== "excluded")
      .sort((left, right) =>
        compareAscii(
          nullableInputString(left["targetCompanyOrAudience"], 2_000) ?? "",
          nullableInputString(right["targetCompanyOrAudience"], 2_000) ?? "",
        ),
      )[0] ??
    null;

  return {
    sourceKind: "product_profile",
    productName: inputString(
      profile["productName"],
      "input.profile.productName",
      160,
    ),
    oneLiner: inputString(
      profile["oneLiner"],
      "input.profile.oneLiner",
      1_000,
    ),
    productType: inputString(
      profile["productType"],
      "input.profile.productType",
      160,
    ),
    businessModels: canonicalStringList(
      profile["businessModels"],
      "input.profile.businessModels",
      20,
      160,
    ),
    primaryMarket: primaryMarkets[0] ?? null,
    primaryAudience:
      primaryAudience === null
        ? null
        : nullableString(
            primaryAudience["targetCompanyOrAudience"],
            "input.profile.targetAudiences.primary.targetCompanyOrAudience",
            2_000,
          ),
  };
}

function legacyProductRouting(
  profile: Record<string, unknown>,
): ContextProjectionV1["productRouting"] {
  const markets = inputStringList(
    profile["marketCodes"],
    "input.profile.marketCodes",
    20,
    32,
  );
  const segments = inputStringList(
    profile["segments"],
    "input.profile.segments",
    100,
    500,
  );
  return {
    sourceKind: "legacy_icp",
    productName: inputString(
      profile["productName"],
      "input.profile.productName",
      160,
    ),
    oneLiner: inputString(
      profile["oneLineDescription"],
      "input.profile.oneLineDescription",
      1_000,
    ),
    // Historical complete ICPs did not require these two routing fields. Keep
    // absence honest as an empty string/list rather than borrowing new fields.
    productType: optionalInputString(
      profile["productType"],
      "input.profile.productType",
      160,
    ),
    businessModels: canonicalStringList(
      profile["businessModels"],
      "input.profile.businessModels",
      20,
      160,
    ),
    primaryMarket: markets[0] ?? null,
    primaryAudience: segments[0] ?? null,
  };
}

function legacyPrimaryConversion(
  profile: Record<string, unknown>,
): ContextProjectionV1["primaryConversion"] {
  if (profile["primaryConversion"] === undefined || profile["primaryConversion"] === null) {
    return { state: "missing", sourceKind: "legacy_icp" };
  }
  const conversion = record(
    profile["primaryConversion"],
    "input.profile.primaryConversion",
  );
  exactKeys(
    conversion,
    ["label", "type", "targetUrl"],
    "input.profile.primaryConversion",
  );
  return {
    state: "available",
    sourceKind: "legacy_icp",
    value: {
      label: inputString(
        conversion["label"],
        "input.profile.primaryConversion.label",
        160,
      ),
      type: inputString(
        conversion["type"],
        "input.profile.primaryConversion.type",
        64,
      ),
      targetUrl:
        conversion["targetUrl"] === null
          ? null
          : inputString(
              conversion["targetUrl"],
              "input.profile.primaryConversion.targetUrl",
              2_048,
            ),
    },
  };
}

function legacyPriorityUrls(
  profile: Record<string, unknown>,
  profileContentHash: string,
): ContextProjectionV1["priorityUrlSubjects"] {
  const rawRefs = inputStringList(
    profile["priorityUrls"],
    "input.profile.priorityUrls",
    100,
    2_048,
  );
  if (rawRefs.length === 0) {
    return { state: "missing", sourceKind: "legacy_icp" };
  }
  const normalizedRefs = new Set<string>();
  for (const [index, rawRef] of rawRefs.entries()) {
    const normalized = subjectUrlOf(rawRef);
    if (normalized === null) {
      throw invalid(
        `input.profile.priorityUrls[${index}] must be an absolute HTTP(S) URL`,
      );
    }
    normalizedRefs.add(normalized);
  }
  return {
    state: "available",
    sourceKind: "legacy_icp",
    sourceHash: profileContentHash,
    normalizedRefs: [...normalizedRefs].sort(compareAscii),
  };
}

function legacyConstraints(
  profile: Record<string, unknown>,
): ContextProjectionV1["declaredExecutionConstraints"] {
  const technical = canonicalStringList(
    profile["technicalConstraints"],
    "input.profile.technicalConstraints",
    100,
    1_000,
  );
  const resource = canonicalStringList(
    profile["resourceConstraints"],
    "input.profile.resourceConstraints",
    100,
    1_000,
  );
  return technical.length === 0 && resource.length === 0
    ? { state: "missing", sourceKind: "legacy_icp" }
    : {
        state: "available",
        sourceKind: "legacy_icp",
        technical,
        resource,
      };
}

function parseProductRouting(
  value: unknown,
  generation: ContextProjectionProfileGeneration,
): ContextProjectionV1["productRouting"] {
  const input = record(value, "contextProjection.productRouting");
  exactKeys(
    input,
    [
      "sourceKind",
      "productName",
      "oneLiner",
      "productType",
      "businessModels",
      "primaryMarket",
      "primaryAudience",
    ],
    "contextProjection.productRouting",
  );
  const expectedSource =
    generation === CURRENT_PROFILE_SCHEMA_VERSION
      ? "product_profile"
      : "legacy_icp";
  if (input["sourceKind"] !== expectedSource) {
    throw invalid(
      `contextProjection.productRouting.sourceKind must equal "${expectedSource}" for ${generation}`,
    );
  }
  return {
    sourceKind: expectedSource,
    productName: boundedString(
      input["productName"],
      "contextProjection.productRouting.productName",
      160,
    ),
    oneLiner: boundedString(
      input["oneLiner"],
      "contextProjection.productRouting.oneLiner",
      1_000,
    ),
    productType: boundedString(
      input["productType"],
      "contextProjection.productRouting.productType",
      160,
      generation === "legacy-icp.v1",
    ),
    businessModels: parseCanonicalStringList(
      input["businessModels"],
      "contextProjection.productRouting.businessModels",
      20,
      160,
    ),
    primaryMarket: nullableMarketCode(
      input["primaryMarket"],
      "contextProjection.productRouting.primaryMarket",
    ),
    primaryAudience: nullableString(
      input["primaryAudience"],
      "contextProjection.productRouting.primaryAudience",
      2_000,
    ),
  };
}

function parseSiteLanguage(
  value: unknown,
): ContextProjectionV1["siteLanguage"] {
  const input = record(value, "contextProjection.siteLanguage");
  exactKeys(
    input,
    ["sourceKind", "state", "languageCodes"],
    "contextProjection.siteLanguage",
  );
  if (input["sourceKind"] !== "site") {
    throw invalid('contextProjection.siteLanguage.sourceKind must equal "site"');
  }
  const state = enumValue(
    input["state"],
    ["declared_non_empty", "declared_empty"] as const,
    "contextProjection.siteLanguage.state",
  );
  const languageCodes = declaredLanguageCodes(
    input["languageCodes"],
    "contextProjection.siteLanguage.languageCodes",
  );
  if (
    (state === "declared_empty" && languageCodes.length !== 0) ||
    (state === "declared_non_empty" && languageCodes.length === 0)
  ) {
    throw invalid(
      "contextProjection.siteLanguage.state must match languageCodes emptiness",
    );
  }
  return { sourceKind: "site", state, languageCodes };
}

function parsePrimaryConversion(
  value: unknown,
  generation: ContextProjectionProfileGeneration,
): ContextProjectionV1["primaryConversion"] {
  const input = record(value, "contextProjection.primaryConversion");
  const state = enumValue(
    input["state"],
    ["available", "missing"] as const,
    "contextProjection.primaryConversion.state",
  );
  if (state === "available") {
    exactKeys(
      input,
      ["state", "sourceKind", "value"],
      "contextProjection.primaryConversion",
    );
    requireLegacyAvailableSource(input, generation, "primaryConversion");
    const conversion = record(
      input["value"],
      "contextProjection.primaryConversion.value",
    );
    exactKeys(
      conversion,
      ["label", "type", "targetUrl"],
      "contextProjection.primaryConversion.value",
    );
    return {
      state: "available",
      sourceKind: "legacy_icp",
      value: {
        label: boundedString(
          conversion["label"],
          "contextProjection.primaryConversion.value.label",
          160,
        ),
        type: boundedString(
          conversion["type"],
          "contextProjection.primaryConversion.value.type",
          64,
        ),
        targetUrl: nullableString(
          conversion["targetUrl"],
          "contextProjection.primaryConversion.value.targetUrl",
          2_048,
        ),
      },
    };
  }
  exactKeys(
    input,
    ["state", "sourceKind"],
    "contextProjection.primaryConversion",
  );
  return {
    state: "missing",
    sourceKind: missingSourceKind(
      input["sourceKind"],
      generation,
      "contextProjection.primaryConversion.sourceKind",
    ),
  };
}

function parsePriorityUrls(
  value: unknown,
  generation: ContextProjectionProfileGeneration,
): ContextProjectionV1["priorityUrlSubjects"] {
  const input = record(value, "contextProjection.priorityUrlSubjects");
  const state = enumValue(
    input["state"],
    ["available", "missing"] as const,
    "contextProjection.priorityUrlSubjects.state",
  );
  if (state === "available") {
    exactKeys(
      input,
      ["state", "sourceKind", "sourceHash", "normalizedRefs"],
      "contextProjection.priorityUrlSubjects",
    );
    requireLegacyAvailableSource(input, generation, "priorityUrlSubjects");
    const normalizedRefs = parseCanonicalUrlList(
      input["normalizedRefs"],
      "contextProjection.priorityUrlSubjects.normalizedRefs",
    );
    if (normalizedRefs.length === 0) {
      throw invalid(
        "contextProjection.priorityUrlSubjects.normalizedRefs must not be empty when available",
      );
    }
    return {
      state: "available",
      sourceKind: "legacy_icp",
      sourceHash: sha256(
        input["sourceHash"],
        "contextProjection.priorityUrlSubjects.sourceHash",
      ),
      normalizedRefs,
    };
  }
  exactKeys(
    input,
    ["state", "sourceKind"],
    "contextProjection.priorityUrlSubjects",
  );
  return {
    state: "missing",
    sourceKind: missingSourceKind(
      input["sourceKind"],
      generation,
      "contextProjection.priorityUrlSubjects.sourceKind",
    ),
  };
}

function parseConstraints(
  value: unknown,
  generation: ContextProjectionProfileGeneration,
): ContextProjectionV1["declaredExecutionConstraints"] {
  const input = record(
    value,
    "contextProjection.declaredExecutionConstraints",
  );
  const state = enumValue(
    input["state"],
    ["available", "missing"] as const,
    "contextProjection.declaredExecutionConstraints.state",
  );
  if (state === "available") {
    exactKeys(
      input,
      ["state", "sourceKind", "technical", "resource"],
      "contextProjection.declaredExecutionConstraints",
    );
    requireLegacyAvailableSource(
      input,
      generation,
      "declaredExecutionConstraints",
    );
    const technical = parseCanonicalStringList(
      input["technical"],
      "contextProjection.declaredExecutionConstraints.technical",
      100,
      1_000,
    );
    const resource = parseCanonicalStringList(
      input["resource"],
      "contextProjection.declaredExecutionConstraints.resource",
      100,
      1_000,
    );
    if (technical.length === 0 && resource.length === 0) {
      throw invalid(
        "contextProjection.declaredExecutionConstraints must carry at least one declared constraint when available",
      );
    }
    return {
      state: "available",
      sourceKind: "legacy_icp",
      technical,
      resource,
    };
  }
  exactKeys(
    input,
    ["state", "sourceKind"],
    "contextProjection.declaredExecutionConstraints",
  );
  return {
    state: "missing",
    sourceKind: missingSourceKind(
      input["sourceKind"],
      generation,
      "contextProjection.declaredExecutionConstraints.sourceKind",
    ),
  };
}

function profileGenerationOf(
  profile: Record<string, unknown>,
): ContextProjectionProfileGeneration {
  if (!Object.hasOwn(profile, "profileSchemaVersion")) return "legacy-icp.v1";
  if (profile["profileSchemaVersion"] === CURRENT_PROFILE_SCHEMA_VERSION) {
    return CURRENT_PROFILE_SCHEMA_VERSION;
  }
  throw invalid(
    `input.profile has unsupported profileSchemaVersion ${JSON.stringify(profile["profileSchemaVersion"])}`,
  );
}

function requireLegacyAvailableSource(
  input: Record<string, unknown>,
  generation: ContextProjectionProfileGeneration,
  field: string,
): void {
  if (generation !== "legacy-icp.v1" || input["sourceKind"] !== "legacy_icp") {
    throw invalid(
      `contextProjection.${field} available state is only valid for legacy_icp`,
    );
  }
}

function missingSourceKind(
  value: unknown,
  generation: ContextProjectionProfileGeneration,
  path: string,
): "legacy_icp" | "not_declared_for_generation" {
  const expected =
    generation === CURRENT_PROFILE_SCHEMA_VERSION
      ? "not_declared_for_generation"
      : "legacy_icp";
  if (value !== expected) {
    throw invalid(`${path} must equal "${expected}" for ${generation}`);
  }
  return expected;
}

/**
 * Site.languageCodes is creation-time authority, so the projection must retain
 * its exact declared order and spelling. RFC 5646 permits valid tags (including
 * grandfathered and private-use tags) that Intl.getCanonicalLocales rejects;
 * canonicalising here would also make the manifest differ from the pinned Site
 * row enforced by the database trigger.
 */
function declaredLanguageCodes(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    throw invalid(`${path} must be an array with at most 20 entries`);
  }
  const values = inputStringList(value, path, 20, 255);
  for (const [index, languageCode] of values.entries()) {
    if (!isBcp47LanguageTag(languageCode)) {
      throw invalid(`${path}[${index}] must be a valid BCP-47 language tag`);
    }
  }
  // Site order is meaningful: element zero is the declared primary language.
  // Preserve the exact creation-time Site array, including any legacy or
  // directly-seeded duplicates, so the manifest stays byte-equal to the row
  // enforced by the SQL trigger.
  return [...values];
}

function parseCanonicalUrlList(value: unknown, path: string): string[] {
  const refs = inputStringList(value, path, 100, 2_048);
  assertAsciiSortedUnique(refs, path);
  for (const [index, ref] of refs.entries()) {
    if (subjectUrlOf(ref) !== ref) {
      throw invalid(`${path}[${index}] must be a canonical HTTP(S) subject URL`);
    }
  }
  return refs;
}

function canonicalStringList(
  value: unknown,
  path: string,
  maxItems: number,
  maxLength: number,
): string[] {
  return [...new Set(inputStringList(value, path, maxItems, maxLength))].sort(
    compareAscii,
  );
}

function parseCanonicalStringList(
  value: unknown,
  path: string,
  maxItems: number,
  maxLength: number,
): string[] {
  const values = inputStringList(value, path, maxItems, maxLength);
  assertAsciiSortedUnique(values, path);
  return values;
}

function inputStringList(
  value: unknown,
  path: string,
  maxItems: number,
  maxLength: number,
): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    throw invalid(`${path} must be an array with at most ${maxItems} entries`);
  }
  return value.map((item, index) =>
    boundedString(item, `${path}[${index}]`, maxLength),
  );
}

function objectArray(value: unknown, path: string): Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalid(`${path} must be an array`);
  return value.map((item, index) => record(item, `${path}[${index}]`));
}

function inputString(value: unknown, path: string, max: number): string {
  return boundedString(value, path, max);
}

function optionalInputString(
  value: unknown,
  path: string,
  max: number,
): string {
  return value === undefined || value === null
    ? ""
    : boundedString(value, path, max);
}

function nullableInputString(value: unknown, max: number): string | null {
  return value === undefined || value === null
    ? null
    : typeof value === "string" && value.trim() === value && value.length <= max
      ? value
      : null;
}

function nullableString(
  value: unknown,
  path: string,
  max: number,
): string | null {
  return value === null ? null : boundedString(value, path, max);
}

function marketCode(value: unknown, path: string): string {
  const result = boundedString(value, path, 2);
  if (!MARKET_CODE.test(result)) {
    throw invalid(`${path} must be a two-letter uppercase market code`);
  }
  return result;
}

function nullableMarketCode(value: unknown, path: string): string | null {
  return value === null ? null : marketCode(value, path);
}

function sha256(value: unknown, path: string): string {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) {
    throw invalid(`${path} must be a lowercase SHA-256 hex digest`);
  }
  return value;
}

function boundedString(
  value: unknown,
  path: string,
  max: number,
  allowEmpty = false,
): string {
  const minimum = allowEmpty ? 0 : 1;
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > max ||
    value.trim() !== value
  ) {
    throw invalid(
      `${path} must contain ${minimum} to ${max} trimmed characters`,
    );
  }
  return value;
}

function enumValue<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw invalid(`${path} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw invalid(`${path} must be a plain JSON object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  path: string,
): void {
  const allowed = new Set(required);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw invalid(`${path} has unknown field "${key}"`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw invalid(`${path} is missing required field "${key}"`);
    }
  }
}

function assertAsciiSortedUnique(values: readonly string[], path: string): void {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined) continue;
    if (compareAscii(previous, current) >= 0) {
      throw invalid(`${path} must be ASCII-sorted and unique`);
    }
  }
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function invalid(message: string): TypeError {
  return new TypeError(`Invalid ContextProjectionV1: ${message}`);
}
