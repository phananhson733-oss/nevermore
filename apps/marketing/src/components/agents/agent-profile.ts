// @input  -- exact Agent identity and a visitor-entered public URL
// @output -- immutable, source-labeled Product/ICP drafts and local confirmation
// @pos    -- browser-only Profile contract; it never writes an app project/profile

import type { AgentKind } from "./agent-types";

export const AGENT_PROFILE_SCHEMA_VERSION = "agent-profile.v2" as const;

export type AgentProfileDevice = "mobile" | "desktop";
export type AgentProfilePageType = "homepage" | "product" | "tool" | "guide";
export type AgentAuditScope = "site-first" | "page-only";
export type AgentProfileReviewState = "needs_confirmation" | "confirmed";

export type AgentProfileSourceId =
  | "product_information_supplied"
  | "marketing_strategy_supplied"
  | "hostname_inference"
  | "confirmation_required"
  | "inferred_run_assumptions";

export interface AgentProfileSources {
  readonly product: AgentProfileSourceId;
  readonly icp: AgentProfileSourceId;
  readonly competitor: AgentProfileSourceId;
  readonly run: AgentProfileSourceId;
}

export interface AgentProfileDraft {
  readonly schemaVersion: typeof AGENT_PROFILE_SCHEMA_VERSION;
  readonly agent: AgentKind;
  /** Exact trimmed visitor input. Server-side URL normalization stays authoritative. */
  readonly targetUrl: string;
  /** Lowercase display host only; not an authorization or SSRF decision. */
  readonly host: string;
  readonly productName: string;
  readonly oneLinePositioning: string;
  readonly categories: readonly string[];
  readonly businessModel: string;
  readonly primaryCta: string;
  readonly trustSignals: readonly string[];
  readonly primaryIcp: string;
  readonly buyer: string;
  readonly user: string;
  readonly triggerPain: string;
  readonly icpInterests: readonly string[];
  readonly icpPain: string;
  readonly icpBehavior: string;
  readonly icpPositioning: string;
  readonly jtbd: string;
  readonly directCompetitors: readonly string[];
  readonly indirectAlternatives: readonly string[];
  readonly excludedAlternatives: readonly string[];
  readonly firstOutcome: string;
  /** Explicit run assumptions; supplied documents do not prove these values. */
  readonly country: string;
  readonly locale: string;
  readonly device: AgentProfileDevice;
  readonly pageType: AgentProfilePageType;
  readonly targetQuery: string;
  readonly auditScope: AgentAuditScope;
  readonly sources: AgentProfileSources;
  readonly editedFields: readonly AgentProfileEditableField[];
  readonly reviewState: AgentProfileReviewState;
}

export type AgentProfileEditableField =
  | "productName"
  | "oneLinePositioning"
  | "categories"
  | "businessModel"
  | "primaryCta"
  | "trustSignals"
  | "primaryIcp"
  | "buyer"
  | "user"
  | "triggerPain"
  | "icpInterests"
  | "icpPain"
  | "icpBehavior"
  | "icpPositioning"
  | "jtbd"
  | "directCompetitors"
  | "indirectAlternatives"
  | "excludedAlternatives"
  | "firstOutcome"
  | "country"
  | "locale"
  | "device"
  | "pageType"
  | "targetQuery"
  | "auditScope";

export type AgentProfileEdits = Partial<
  Pick<AgentProfileDraft, AgentProfileEditableField>
>;

const EDITABLE_FIELDS: readonly AgentProfileEditableField[] = [
  "productName",
  "oneLinePositioning",
  "categories",
  "businessModel",
  "primaryCta",
  "trustSignals",
  "primaryIcp",
  "buyer",
  "user",
  "triggerPain",
  "icpInterests",
  "icpPain",
  "icpBehavior",
  "icpPositioning",
  "jtbd",
  "directCompetitors",
  "indirectAlternatives",
  "excludedAlternatives",
  "firstOutcome",
  "country",
  "locale",
  "device",
  "pageType",
  "targetQuery",
  "auditScope",
];

const EDITABLE_FIELD_SET = new Set<AgentProfileEditableField>(EDITABLE_FIELDS);
const DEVICE_VALUES = new Set<AgentProfileDevice>(["mobile", "desktop"]);
const PAGE_TYPE_VALUES = new Set<AgentProfilePageType>([
  "homepage",
  "product",
  "tool",
  "guide",
]);
const AUDIT_SCOPE_VALUES = new Set<AgentAuditScope>([
  "site-first",
  "page-only",
]);
const SOURCE_VALUES = new Set<AgentProfileSourceId>([
  "product_information_supplied",
  "marketing_strategy_supplied",
  "hostname_inference",
  "confirmation_required",
  "inferred_run_assumptions",
]);

function displayHost(input: string): string {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 2_048) return "";
  try {
    const parsed = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`,
    );
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  } catch {
    return "";
  }
}

function copyDraft(profile: AgentProfileDraft): AgentProfileDraft {
  return {
    ...profile,
    categories: [...profile.categories],
    trustSignals: [...profile.trustSignals],
    icpInterests: [...profile.icpInterests],
    directCompetitors: [...profile.directCompetitors],
    indirectAlternatives: [...profile.indirectAlternatives],
    excludedAlternatives: [...profile.excludedAlternatives],
    sources: { ...profile.sources },
    editedFields: [...profile.editedFields],
  };
}

function astrologyWikiDraft(
  agent: AgentKind,
  targetUrl: string,
): AgentProfileDraft {
  return {
    schemaVersion: AGENT_PROFILE_SCHEMA_VERSION,
    agent,
    targetUrl,
    host: "astrologywiki.com",
    productName: "AstrologyWiki",
    oneLinePositioning:
      "A free birth-chart and self-exploration web app combining astrology with modern psychology.",
    categories: [
      "Astrology tool",
      "Self-discovery platform",
      "Birth-chart calculator",
    ],
    businessModel: "Freemium · subscription · credits",
    primaryCta: "Generate Free Birth Chart",
    trustSignals: [
      "Anonymous calculation",
      "Real astronomical data",
      "Multilingual web app",
    ],
    primaryIcp: "Mobile-first young adults, 22–38, female-skewed",
    buyer:
      "Inferred — the user and payer are likely the same self-serve individual; confirm.",
    user:
      "Documented — an astrology-interested young adult using the product for self-reflection.",
    triggerPain:
      "Documented — wants self-understanding, relationship insight, or emotional reflection without fatalistic prediction.",
    icpInterests: [
      "Astrology",
      "Psychology",
      "Personal growth",
      "Mindfulness",
    ],
    icpPain:
      "Wants a self-understanding tool but rejects deterministic fortune-telling.",
    icpBehavior:
      "Socially active, shares astrology content, and values emotional health.",
    icpPositioning: "Self-reflection, not fate prediction",
    jtbd: "Understand themselves without deterministic fortune-telling.",
    directCompetitors: [],
    indirectAlternatives: [],
    excludedAlternatives: [],
    firstOutcome:
      agent === "seo"
        ? "Own the free birth-chart query and convert to chart generation"
        : "Keep mobile anonymous chart generation crawlable and reliable",
    country: "CN",
    locale: "zh-CN",
    device: "mobile",
    pageType: "tool",
    targetQuery: "免费星盘计算",
    auditScope: "site-first",
    sources: {
      product: "product_information_supplied",
      icp: "marketing_strategy_supplied",
      competitor: "confirmation_required",
      run: "inferred_run_assumptions",
    },
    editedFields: [],
    reviewState: "needs_confirmation",
  };
}

function genericDraft(
  agent: AgentKind,
  targetUrl: string,
  host: string,
): AgentProfileDraft {
  const label = host || "Unknown website";
  return {
    schemaVersion: AGENT_PROFILE_SCHEMA_VERSION,
    agent,
    targetUrl,
    host,
    productName: label,
    oneLinePositioning: `Public website at ${label}; its product and positioning are not yet confirmed.`,
    categories: ["Unknown — confirm the category."],
    businessModel: "Unknown — confirm the business model.",
    primaryCta: "Unknown — confirm the primary call to action.",
    trustSignals: [],
    primaryIcp: "Unknown — confirm the primary audience.",
    buyer: "Unknown — confirm the buying role.",
    user: "Unknown — confirm the user role.",
    triggerPain: "Unknown — confirm the trigger or pain.",
    icpInterests: [],
    icpPain: "Unknown — confirm the audience pain.",
    icpBehavior: "Unknown — confirm audience behavior.",
    icpPositioning: "Unknown — confirm the positioning.",
    jtbd: "Unknown — confirm the job to be done.",
    directCompetitors: [],
    indirectAlternatives: [],
    excludedAlternatives: [],
    firstOutcome:
      agent === "seo"
        ? "Confirm the first search-growth outcome."
        : "Confirm the first technical reliability outcome.",
    country: "GLOBAL",
    locale: "en",
    device: "mobile",
    pageType: "homepage",
    targetQuery: "",
    auditScope: "site-first",
    sources: {
      product: "hostname_inference",
      icp: "confirmation_required",
      competitor: "confirmation_required",
      run: "inferred_run_assumptions",
    },
    editedFields: [],
    reviewState: "needs_confirmation",
  };
}

/** Create a new independent draft. No network request or app persistence occurs. */
export function createAgentProfileDraft(
  agent: AgentKind,
  url: string,
): AgentProfileDraft {
  const targetUrl = url.trim();
  const host = displayHost(targetUrl);
  return host === "astrologywiki.com"
    ? astrologyWikiDraft(agent, targetUrl)
    : genericDraft(agent, targetUrl, host);
}

/** Changing a URL invalidates confirmation and any edits from the previous target. */
export function redraftAgentProfileForUrl(
  profile: AgentProfileDraft,
  url: string,
): AgentProfileDraft {
  const targetUrl = url.trim();
  return targetUrl === profile.targetUrl
    ? copyDraft(profile)
    : createAgentProfileDraft(profile.agent, targetUrl);
}

/** Apply only declared editable fields and return the run context to draft state. */
export function updateAgentProfile(
  profile: AgentProfileDraft,
  edits: AgentProfileEdits,
): AgentProfileDraft {
  const editedFields = [...profile.editedFields];
  const accepted: AgentProfileEdits = {};
  for (const [key, value] of Object.entries(edits)) {
    if (!EDITABLE_FIELD_SET.has(key as AgentProfileEditableField)) continue;
    const field = key as AgentProfileEditableField;
    (accepted as Record<string, unknown>)[field] = value;
    if (!editedFields.includes(field)) editedFields.push(field);
  }
  return copyDraft({
    ...profile,
    ...accepted,
    editedFields,
    reviewState: "needs_confirmation",
  });
}

/** Confirmation is a local immutable snapshot, not an app Product Profile version. */
export function confirmAgentProfile(
  profile: AgentProfileDraft,
): AgentProfileDraft {
  return copyDraft({ ...profile, reviewState: "confirmed" });
}

function isBoundedString(value: unknown, allowEmpty = false): value is string {
  return (
    typeof value === "string" &&
    value.length <= 2_048 &&
    (allowEmpty || value.trim().length > 0)
  );
}

function isStringArray(value: unknown, max = 16): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= max &&
    value.every((item) => isBoundedString(item))
  );
}

/** Runtime guard used only for a same-tab, short-lived auth handoff. */
export function isConfirmedAgentProfile(
  value: unknown,
  agent?: AgentKind,
  exactUrl?: string,
): value is AgentProfileDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<AgentProfileDraft>;
  const sources = candidate.sources;
  return (
    candidate.schemaVersion === AGENT_PROFILE_SCHEMA_VERSION &&
    (candidate.agent === "seo" || candidate.agent === "tech") &&
    (agent === undefined || candidate.agent === agent) &&
    isBoundedString(candidate.targetUrl) &&
    (exactUrl === undefined || candidate.targetUrl === exactUrl) &&
    isBoundedString(candidate.host, true) &&
    isBoundedString(candidate.productName) &&
    isBoundedString(candidate.oneLinePositioning) &&
    isStringArray(candidate.categories) &&
    isBoundedString(candidate.businessModel) &&
    isBoundedString(candidate.primaryCta) &&
    isStringArray(candidate.trustSignals) &&
    isBoundedString(candidate.primaryIcp) &&
    isBoundedString(candidate.buyer) &&
    isBoundedString(candidate.user) &&
    isBoundedString(candidate.triggerPain) &&
    isStringArray(candidate.icpInterests) &&
    isBoundedString(candidate.icpPain) &&
    isBoundedString(candidate.icpBehavior) &&
    isBoundedString(candidate.icpPositioning) &&
    isBoundedString(candidate.jtbd) &&
    isStringArray(candidate.directCompetitors) &&
    isStringArray(candidate.indirectAlternatives) &&
    isStringArray(candidate.excludedAlternatives) &&
    isBoundedString(candidate.firstOutcome) &&
    isBoundedString(candidate.country) &&
    isBoundedString(candidate.locale) &&
    DEVICE_VALUES.has(candidate.device as AgentProfileDevice) &&
    PAGE_TYPE_VALUES.has(candidate.pageType as AgentProfilePageType) &&
    isBoundedString(candidate.targetQuery, true) &&
    AUDIT_SCOPE_VALUES.has(candidate.auditScope as AgentAuditScope) &&
    !!sources &&
    SOURCE_VALUES.has(sources.product as AgentProfileSourceId) &&
    SOURCE_VALUES.has(sources.icp as AgentProfileSourceId) &&
    SOURCE_VALUES.has(sources.competitor as AgentProfileSourceId) &&
    SOURCE_VALUES.has(sources.run as AgentProfileSourceId) &&
    Array.isArray(candidate.editedFields) &&
    candidate.editedFields.every((field) =>
      EDITABLE_FIELD_SET.has(field as AgentProfileEditableField),
    ) &&
    candidate.reviewState === "confirmed"
  );
}
