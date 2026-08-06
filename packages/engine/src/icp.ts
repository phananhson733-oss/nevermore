import {
  parseContextProjectionV1,
  type ContextProjectionV1,
} from "./context-projection.ts";

/**
 * The engine's read model of a complete ICP profile (spec §6.2). Historical
 * executors retain this defensive parser so frozen runs preserve their original
 * semantics; the contextual current executor uses the generation-aware adapter
 * below. Missing arrays become empty and this legacy parser never throws.
 */

export type CustomerModel = "b2b" | "b2c" | "hybrid";

export interface EngineConversion {
  readonly label: string;
  readonly type: string;
  readonly targetUrl: string | null;
}

export interface EngineCompetitor {
  readonly name: string;
  readonly domain: string;
  readonly relationship: string | null;
  readonly analysisScope: readonly string[];
  readonly reason: string;
  readonly reviewStatus: string;
  readonly confidence: string;
  readonly similarity: number | null;
}

export interface EngineIcp {
  readonly productName: string;
  readonly oneLineDescription: string;
  readonly category: string;
  readonly productType: string;
  readonly businessModels: readonly string[];
  readonly customerModel: CustomerModel | null;
  readonly businessProfile: string | null;
  readonly marketCodes: readonly string[];
  readonly siteLanguageCodes: readonly string[];
  readonly defaultDeliveryLocale: string;
  readonly segments: readonly string[];
  readonly useCases: readonly string[];
  readonly offers: readonly string[];
  readonly differentiators: readonly string[];
  readonly primaryConversion: EngineConversion | null;
  readonly priorityProductsOrServices: readonly string[];
  readonly priorityUrls: readonly string[];
  readonly competitors: readonly string[];
  readonly competitorDetails: readonly EngineCompetitor[];
  readonly growthObjectives: readonly string[];
  readonly pains: readonly string[];
  readonly jobsToBeDone: readonly string[];
  readonly desiredOutcomes: readonly string[];
  readonly triggers: readonly string[];
  readonly buyerRoles: readonly string[];
  readonly userRoles: readonly string[];
  readonly barriers: readonly string[];
  readonly qualificationSignals: readonly string[];
  readonly disqualifiers: readonly string[];
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function records(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? v.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item),
      )
    : [];
}

function preferred(legacy: unknown, generated: readonly string[]): string[] {
  const declared = strArray(legacy);
  return declared.length > 0 ? declared : [...generated];
}

function parseConversion(v: unknown): EngineConversion | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  return {
    label: str(o["label"]),
    type: str(o["type"]),
    targetUrl: typeof o["targetUrl"] === "string" ? o["targetUrl"] : null,
  };
}

function parseCompetitor(
  value: Record<string, unknown>,
): EngineCompetitor | null {
  const domain = str(value["domain"]);
  if (!domain) return null;
  const similarity = value["similarity"];
  return {
    name: str(value["name"]),
    domain,
    relationship:
      typeof value["relationship"] === "string"
        ? value["relationship"]
        : null,
    analysisScope: strArray(value["analysisScope"]),
    reason: str(value["reason"]),
    reviewStatus: str(value["reviewStatus"]),
    confidence: str(value["confidence"]),
    similarity:
      typeof similarity === "number" && Number.isFinite(similarity)
        ? similarity
        : null,
  };
}

export function parseIcp(profile: unknown): EngineIcp {
  const p = (typeof profile === "object" && profile !== null ? profile : {}) as Record<
    string,
    unknown
  >;
  const customerModel = str(p["customerModel"]);
  const audiences = records(p["targetAudiences"]);
  const primaryAudience =
    audiences.find((audience) => audience["reviewStatus"] === "primary") ??
    audiences.find((audience) => audience["reviewStatus"] !== "excluded") ??
    null;
  const targetMarkets = records(p["targetMarkets"]);
  const competitorCandidates = records(p["competitorCandidates"]);
  const includedCompetitors = competitorCandidates.filter(
    (candidate) => candidate["reviewStatus"] !== "excluded",
  );
  const valueProposition = str(p["valueProposition"]);
  const oneLiner = str(p["oneLiner"]);
  const coreFeatures = strArray(p["coreFeatures"]);
  return {
    productName: str(p["productName"]),
    oneLineDescription: str(p["oneLineDescription"], oneLiner),
    category: str(p["category"]),
    productType: str(p["productType"]),
    businessModels: strArray(p["businessModels"]),
    customerModel:
      customerModel === "b2b" || customerModel === "b2c" || customerModel === "hybrid"
        ? customerModel
        : null,
    businessProfile:
      typeof p["businessProfile"] === "string"
        ? p["businessProfile"]
        : valueProposition || null,
    marketCodes: preferred(
      p["marketCodes"],
      targetMarkets.map((market) => str(market["marketCode"])).filter(Boolean),
    ),
    siteLanguageCodes: strArray(p["siteLanguageCodes"]),
    defaultDeliveryLocale: str(p["defaultDeliveryLocale"], "en"),
    segments: preferred(
      p["segments"],
      primaryAudience === null
        ? []
        : [str(primaryAudience["targetCompanyOrAudience"])].filter(Boolean),
    ),
    useCases: preferred(
      p["useCases"],
      strArray(primaryAudience?.["useCases"]),
    ),
    offers: preferred(p["offers"], coreFeatures),
    differentiators: preferred(
      p["differentiators"],
      valueProposition ? [valueProposition] : [],
    ),
    primaryConversion: parseConversion(p["primaryConversion"]),
    priorityProductsOrServices: strArray(p["priorityProductsOrServices"]),
    priorityUrls: strArray(p["priorityUrls"]),
    competitors: preferred(
      p["competitors"],
      includedCompetitors
        .map((candidate) => str(candidate["domain"]))
        .filter(Boolean),
    ),
    competitorDetails: includedCompetitors
      .map(parseCompetitor)
      .filter((candidate): candidate is EngineCompetitor => candidate !== null),
    growthObjectives: strArray(p["growthObjectives"]),
    pains: strArray(primaryAudience?.["pains"]),
    jobsToBeDone: strArray(primaryAudience?.["jtbd"]),
    desiredOutcomes: strArray(primaryAudience?.["outcomes"]),
    triggers: strArray(primaryAudience?.["triggers"]),
    buyerRoles: strArray(primaryAudience?.["buyerRoles"]),
    userRoles: strArray(primaryAudience?.["userRoles"]),
    barriers: strArray(primaryAudience?.["barriers"]),
    qualificationSignals: strArray(
      primaryAudience?.["qualificationSignals"],
    ),
    disqualifiers: strArray(primaryAudience?.["disqualifiers"]),
  };
}

/**
 * Adapt an immutable profile for the current context-projection executor.
 *
 * This is deliberately separate from `parseIcp`: historical 0.2.1–0.2.3
 * replay retains the hybrid compatibility parser above, while current runs use
 * one explicit profile generation and the run-frozen Site/conversion/URL facts.
 */
export function parseIcpForContextProjectionV1(
  profile: unknown,
  projectionValue: ContextProjectionV1,
): EngineIcp {
  const projection = parseContextProjectionV1(projectionValue);
  if (
    typeof profile !== "object" ||
    profile === null ||
    Array.isArray(profile)
  ) {
    throw new TypeError(
      "Invalid ContextProjectionV1 ICP adapter: profile must be a JSON object",
    );
  }
  const p = profile as Record<string, unknown>;
  const generation = Object.hasOwn(p, "profileSchemaVersion")
    ? p["profileSchemaVersion"] === "product-profile.0.3.0"
      ? "product-profile.0.3.0"
      : "unsupported"
    : "legacy-icp.v1";
  if (generation !== projection.profileGeneration) {
    throw new TypeError(
      `Invalid ContextProjectionV1 ICP adapter: profile generation ${String(generation)} does not match projection generation ${projection.profileGeneration}`,
    );
  }

  const frozenPrimaryConversion =
    projection.primaryConversion.state === "available"
      ? projection.primaryConversion.value
      : null;
  const frozenPriorityUrls =
    projection.priorityUrlSubjects.state === "available"
      ? projection.priorityUrlSubjects.normalizedRefs
      : [];
  const frozenFacts = {
    siteLanguageCodes: projection.siteLanguage.languageCodes,
    // Current contexts never consult this field for language routing. Keeping
    // it empty also prevents accidental delivery-locale fallback by a caller
    // that uses this adapter without the accompanying DiagnosticContext field.
    defaultDeliveryLocale: "",
    primaryConversion: frozenPrimaryConversion,
    priorityUrls: frozenPriorityUrls,
  };

  if (generation === "product-profile.0.3.0") {
    return parseIcp({
      profileSchemaVersion: p["profileSchemaVersion"],
      productName: p["productName"],
      oneLiner: p["oneLiner"],
      category: p["category"],
      productType: p["productType"],
      businessModels: p["businessModels"],
      customerModel: p["customerModel"],
      growthObjectives: p["growthObjectives"],
      valueProposition: p["valueProposition"],
      coreFeatures: p["coreFeatures"],
      targetMarkets: p["targetMarkets"],
      targetAudiences: p["targetAudiences"],
      competitorCandidates: p["competitorCandidates"],
      ...frozenFacts,
    });
  }

  // Explicit allow-list: new-generation aliases such as oneLiner,
  // targetMarkets, targetAudiences, coreFeatures, and valueProposition cannot
  // leak into a discriminator-less legacy profile.
  return parseIcp({
    productName: p["productName"],
    oneLineDescription: p["oneLineDescription"],
    category: p["category"],
    productType: p["productType"],
    businessModels: p["businessModels"],
    customerModel: p["customerModel"],
    businessProfile: p["businessProfile"],
    marketCodes: p["marketCodes"],
    segments: p["segments"],
    useCases: p["useCases"],
    offers: p["offers"],
    differentiators: p["differentiators"],
    priorityProductsOrServices: p["priorityProductsOrServices"],
    competitors: p["competitors"],
    growthObjectives: p["growthObjectives"],
    ...frozenFacts,
  });
}

/**
 * Whether the project's primary site language is English (spec §8.4). Regex/
 * heuristic rules (intent match, proof block) only run for English projects;
 * otherwise they return `inconclusive` rather than manufacturing a defect.
 */
export function isEnglishProject(icp: EngineIcp): boolean {
  const primary = icp.siteLanguageCodes[0] ?? icp.defaultDeliveryLocale;
  return primary.toLowerCase().startsWith("en");
}
