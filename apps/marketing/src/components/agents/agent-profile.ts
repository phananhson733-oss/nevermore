// @input  -- exact Agent identity and a visitor-entered public URL
// @output -- immutable, source-labeled Product/ICP drafts and local confirmation
// @pos    -- browser-only Profile contract; it never writes an app project/profile

import type {
  AgentProfileRefreshFieldPath,
  AgentProfileRefreshResult,
} from "../../lib/agents/profile-refresh-contract";
import type { AgentKind } from "./agent-types";

export const AGENT_PROFILE_SCHEMA_VERSION = "agent-profile.v3" as const;

export type AgentProfileDevice = "mobile" | "desktop";
export type AgentProfilePageType = "homepage" | "product" | "tool" | "guide";
export type AgentAuditScope = "site-first" | "page-only";
export type AgentProfileReviewState = "needs_confirmation" | "confirmed";
export type AgentProfileProvenanceDerivation =
  | "declared"
  | "observed"
  | "computed"
  | "inferred"
  | "missing";
export type AgentProfileConfidence = "high" | "medium" | "low" | "unknown";
export type AgentProfileFieldSource =
  | "supplied_product_information"
  | "supplied_marketing_strategy"
  | "visitor_url"
  | "public_page"
  | "local_computation"
  | "local_inference"
  | "user_edit"
  | "not_available";

export type AgentProfileSourceId =
  | "product_information_supplied"
  | "marketing_strategy_supplied"
  | "saved_website_profile"
  | "hostname_inference"
  | "public_page_refresh"
  | "confirmation_required"
  | "inferred_run_assumptions";

export interface AgentProfileSources {
  readonly product: AgentProfileSourceId;
  readonly icp: AgentProfileSourceId;
  readonly competitor: AgentProfileSourceId;
  readonly run: AgentProfileSourceId;
}

export interface AgentProfileFieldProvenance {
  readonly path: `/${AgentProfileEditableField}`;
  readonly derivation: AgentProfileProvenanceDerivation;
  readonly confidence: AgentProfileConfidence;
  readonly source: AgentProfileFieldSource;
  readonly limitation: string | null;
  readonly observedAt: string | null;
  /** Public source URLs used for a live refresh; local/supplied facts keep this empty. */
  readonly evidenceUrls: readonly string[];
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
  readonly valueProposition: string;
  readonly coreFeatures: readonly string[];
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
  readonly useCases: readonly string[];
  readonly outcomes: readonly string[];
  readonly barriers: readonly string[];
  readonly qualificationSignals: readonly string[];
  readonly disqualifiers: readonly string[];
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
  /** Local field facts only; these are not canonical app evidence references. */
  readonly fieldProvenance: readonly AgentProfileFieldProvenance[];
  readonly editedFields: readonly AgentProfileEditableField[];
  readonly reviewState: AgentProfileReviewState;
}

export type AgentProfileEditableField =
  | "productName"
  | "oneLinePositioning"
  | "valueProposition"
  | "coreFeatures"
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
  | "useCases"
  | "outcomes"
  | "barriers"
  | "qualificationSignals"
  | "disqualifiers"
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

export interface AgentProfileRefreshSummary {
  readonly found: number;
  readonly applied: number;
  readonly retained: number;
  readonly unavailable: number;
}

export type AgentProfileRefreshProposalValue =
  AgentProfileDraft[AgentProfileRefreshFieldPath];

export interface AgentProfileRefreshProposal {
  readonly path: AgentProfileRefreshFieldPath;
  readonly currentValue: AgentProfileRefreshProposalValue;
  readonly liveValue: AgentProfileRefreshProposalValue;
  readonly evidenceUrls: readonly string[];
  readonly currentSource: AgentProfileFieldSource;
  readonly liveSource: "public_page";
}

const EDITABLE_FIELDS: readonly AgentProfileEditableField[] = [
  "productName",
  "oneLinePositioning",
  "valueProposition",
  "coreFeatures",
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
  "useCases",
  "outcomes",
  "barriers",
  "qualificationSignals",
  "disqualifiers",
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
  "saved_website_profile",
  "hostname_inference",
  "public_page_refresh",
  "confirmation_required",
  "inferred_run_assumptions",
]);
const PROVENANCE_DERIVATION_VALUES = new Set<AgentProfileProvenanceDerivation>([
  "declared",
  "observed",
  "computed",
  "inferred",
  "missing",
]);
const CONFIDENCE_VALUES = new Set<AgentProfileConfidence>([
  "high",
  "medium",
  "low",
  "unknown",
]);
const FIELD_SOURCE_VALUES = new Set<AgentProfileFieldSource>([
  "supplied_product_information",
  "supplied_marketing_strategy",
  "visitor_url",
  "public_page",
  "local_computation",
  "local_inference",
  "user_edit",
  "not_available",
]);
const DRAFT_KEYS = new Set<keyof AgentProfileDraft>([
  "schemaVersion",
  "agent",
  "targetUrl",
  "host",
  "productName",
  "oneLinePositioning",
  "valueProposition",
  "coreFeatures",
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
  "useCases",
  "outcomes",
  "barriers",
  "qualificationSignals",
  "disqualifiers",
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
  "sources",
  "fieldProvenance",
  "editedFields",
  "reviewState",
]);
const SOURCE_KEYS = new Set<keyof AgentProfileSources>([
  "product",
  "icp",
  "competitor",
  "run",
]);
const FIELD_PROVENANCE_KEYS = new Set<keyof AgentProfileFieldProvenance>([
  "path",
  "derivation",
  "confidence",
  "source",
  "limitation",
  "observedAt",
  "evidenceUrls",
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

function hasRootPath(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 2_048) return false;
  try {
    const parsed = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`,
    );
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.pathname === "/"
    );
  } catch {
    return false;
  }
}

function copyDraft(profile: AgentProfileDraft): AgentProfileDraft {
  return {
    ...profile,
    coreFeatures: [...profile.coreFeatures],
    categories: [...profile.categories],
    trustSignals: [...profile.trustSignals],
    icpInterests: [...profile.icpInterests],
    useCases: [...profile.useCases],
    outcomes: [...profile.outcomes],
    barriers: [...profile.barriers],
    qualificationSignals: [...profile.qualificationSignals],
    disqualifiers: [...profile.disqualifiers],
    directCompetitors: [...profile.directCompetitors],
    indirectAlternatives: [...profile.indirectAlternatives],
    excludedAlternatives: [...profile.excludedAlternatives],
    sources: { ...profile.sources },
    fieldProvenance: profile.fieldProvenance.map((entry) => ({
      ...entry,
      evidenceUrls: [...entry.evidenceUrls],
    })),
    editedFields: [...profile.editedFields],
  };
}

function usesChinesePresentation(locale: string): boolean {
  return locale.toLowerCase().startsWith("zh");
}

const ASTROLOGY_PRODUCT_FIELDS = new Set<AgentProfileEditableField>([
  "productName",
  "oneLinePositioning",
  "valueProposition",
  "coreFeatures",
  "categories",
  "businessModel",
  "primaryCta",
  "trustSignals",
  "primaryIcp",
  "user",
  "icpInterests",
]);
const ASTROLOGY_PRODUCT_DERIVED_FIELDS = new Set<AgentProfileEditableField>([
  "triggerPain",
  "icpPositioning",
  "jtbd",
  "useCases",
  "outcomes",
  "qualificationSignals",
]);
const ASTROLOGY_UNSUPPORTED_ICP_FIELDS = new Set<AgentProfileEditableField>([
  "icpBehavior",
  "barriers",
  "disqualifiers",
]);
const COMPETITOR_FIELDS = new Set<AgentProfileEditableField>([
  "directCompetitors",
  "indirectAlternatives",
  "excludedAlternatives",
]);

function declaredProvenance(
  field: AgentProfileEditableField,
  source:
    | "supplied_product_information"
    | "supplied_marketing_strategy"
    | "user_edit",
): AgentProfileFieldProvenance {
  return {
    path: `/${field}`,
    derivation: "declared",
    confidence: "high",
    source,
    limitation: null,
    observedAt: null,
    evidenceUrls: [],
  };
}

function inferredProvenance(
  field: AgentProfileEditableField,
  source: "visitor_url" | "local_inference",
  limitation: string,
  observedAt: string,
): AgentProfileFieldProvenance {
  return {
    path: `/${field}`,
    derivation: "inferred",
    confidence: "low",
    source,
    limitation,
    observedAt,
    evidenceUrls: [],
  };
}

function missingProvenance(
  field: AgentProfileEditableField,
  limitation: string,
): AgentProfileFieldProvenance {
  return {
    path: `/${field}`,
    derivation: "missing",
    confidence: "unknown",
    source: "not_available",
    limitation,
    observedAt: null,
    evidenceUrls: [],
  };
}

function astrologyWikiFieldProvenance(
  observedAt: string,
): readonly AgentProfileFieldProvenance[] {
  return EDITABLE_FIELDS.map((field) => {
    if (ASTROLOGY_PRODUCT_FIELDS.has(field)) {
      return declaredProvenance(field, "supplied_product_information");
    }
    if (ASTROLOGY_PRODUCT_DERIVED_FIELDS.has(field)) {
      return inferredProvenance(
        field,
        "local_inference",
        "Normalized from the supplied Product Information for this local Agent run; confirm before use.",
        observedAt,
      );
    }
    if (ASTROLOGY_UNSUPPORTED_ICP_FIELDS.has(field)) {
      return missingProvenance(
        field,
        "The supplied Product Information does not establish this ICP field; confirm before use.",
      );
    }
    if (COMPETITOR_FIELDS.has(field)) {
      return missingProvenance(
        field,
        "No business competitor was supplied; confirm before use.",
      );
    }
    if (field === "country") {
      return missingProvenance(
        field,
        "No primary search market was supplied; select one before running the audit.",
      );
    }
    if (field === "locale") {
      return missingProvenance(
        field,
        "The product supports multiple languages, but no primary audit locale was supplied; select one before running the audit.",
      );
    }
    if (field === "targetQuery") {
      return missingProvenance(
        field,
        "The supplied Product Information does not specify a target query for this run.",
      );
    }
    if (field === "pageType") {
      return inferredProvenance(
        field,
        "visitor_url",
        "Inferred only from the visitor-entered URL path; confirm before use.",
        observedAt,
      );
    }
    if (field === "buyer") {
      return inferredProvenance(
        field,
        "local_inference",
        "The Product Information describes a consumer self-serve offer but does not name a separate buyer; confirm before use.",
        observedAt,
      );
    }
    if (field === "icpPain") {
      return inferredProvenance(
        field,
        "local_inference",
        "Inferred from the Product Information target-customer outcomes; confirm the audience pain before use.",
        observedAt,
      );
    }
    return inferredProvenance(
      field,
      "local_inference",
      "This run setting is not an explicit fact in the supplied Product Information; confirm before use.",
      observedAt,
    );
  });
}

function genericFieldProvenance(
  host: string,
  observedAt: string,
): readonly AgentProfileFieldProvenance[] {
  return EDITABLE_FIELDS.map((field) => {
    if (host && (field === "productName" || field === "oneLinePositioning")) {
      return inferredProvenance(
        field,
        "visitor_url",
        "Derived only from the visitor-entered hostname; confirm the product identity.",
        observedAt,
      );
    }
    if (
      field === "device" ||
      field === "pageType" ||
      field === "auditScope"
    ) {
      return inferredProvenance(
        field,
        "local_inference",
        "Default run assumption; confirm before use.",
        observedAt,
      );
    }
    return missingProvenance(field, "No supporting source is available yet.");
  });
}

function astrologyWikiDraft(
  agent: AgentKind,
  targetUrl: string,
  presentationLocale: string,
): AgentProfileDraft {
  const chinese = usesChinesePresentation(presentationLocale);
  const observedAt = new Date().toISOString();
  return {
    schemaVersion: AGENT_PROFILE_SCHEMA_VERSION,
    agent,
    targetUrl,
    host: "astrologywiki.com",
    productName: "AstrologyWiki",
    oneLinePositioning: chinese
      ? "融合占星学与现代心理学的免费出生星盘与自我探索 Web 应用。"
      : "A free birth-chart and self-exploration web app combining astrology with modern psychology.",
    valueProposition: chinese
      ? "将占星符号用于自我认知与心理反思，而非命运预测。"
      : "Use astrological symbols for self-understanding and psychological reflection, not fate prediction.",
    coreFeatures: chinese
      ? [
          "免费本命星盘计算器",
          "行星过境洞察",
          "合盘关系分析",
          "占星时间轴",
          "每周 AI 问卦",
          "认知行为疗法占星日记",
          "占星百科与工具库",
        ]
      : [
          "Free natal chart calculator",
          "Planetary transit insights",
          "Synastry analysis",
          "Astrology timeline",
          "Weekly AI oracle",
          "CBT astrology journal",
          "Astrology encyclopedia and tools",
        ],
    categories: chinese
      ? ["占星工具", "自我探索平台", "出生星盘计算器"]
      : ["Astrology tool", "Self-discovery platform", "Birth-chart calculator"],
    businessModel: chinese
      ? "免费增值 · 订阅 · 点数"
      : "Freemium · subscription · credits",
    primaryCta: chinese ? "生成免费出生星盘" : "Generate Free Birth Chart",
    trustSignals: chinese
      ? ["匿名计算", "真实天文数据", "多语言 Web 应用"]
      : ["Anonymous calculation", "Real astronomical data", "Multilingual web app"],
    primaryIcp: chinese
      ? "对占星感兴趣、将星盘用于自我认知与心理探索的普通用户"
      : "People interested in astrology who use birth charts for self-understanding and psychological exploration",
    buyer: chinese
      ? "推断——自助型普通用户很可能同时是使用者与购买者；需确认。"
      : "Inferred — a self-serve consumer is likely both user and buyer; confirm.",
    user: chinese
      ? "关注个人成长、关系分析或情绪洞察的人群。"
      : "People focused on personal growth, relationship analysis, or emotional insight.",
    triggerPain: chinese
      ? "希望将占星用于自我认知与心理反思，而非命运预测。"
      : "Wants to use astrology for self-understanding and psychological reflection rather than fate prediction.",
    icpInterests: chinese
      ? ["占星", "个人成长", "关系分析", "情绪洞察"]
      : ["Astrology", "Personal growth", "Relationship analysis", "Emotional insight"],
    icpPain: chinese
      ? "推断——目标客户希望获得个人成长、关系分析或情绪洞察；需确认。"
      : "Inferred — the target customer seeks personal growth, relationship analysis, or emotional insight; confirm.",
    icpBehavior: chinese
      ? "未提供 · 需要确认"
      : "Not supplied · confirmation required",
    icpPositioning: chinese
      ? "自我认知与心理反思，而非命运预测"
      : "Self-understanding and psychological reflection, not fate prediction",
    jtbd: chinese
      ? "借助星盘进行自我认知与心理探索。"
      : "Use a birth chart for self-understanding and psychological exploration.",
    useCases: chinese
      ? [
          "生成并探索精准本命星盘",
          "反思情绪与个人成长",
          "通过合盘探索关系动态",
          "通过百科与工具系统学习占星",
        ]
      : [
          "Generate and explore an accurate natal chart",
          "Reflect on emotions and personal growth",
          "Explore relationship dynamics with synastry",
          "Learn astrology through the encyclopedia and tools",
        ],
    outcomes: chinese
      ? [
          "30 秒内生成精准出生星盘",
          "理解个人与情绪模式",
          "探索关系中的契合点与张力",
        ]
      : [
          "Generate an accurate birth chart in 30 seconds",
          "Understand personal and emotional patterns",
          "Explore relationship compatibility and tension",
        ],
    barriers: [],
    qualificationSignals: chinese
      ? [
          "将占星作为自我认知或心理探索工具",
          "关注个人成长、关系或情绪洞察",
        ]
      : [
          "Interested in astrology as a self-understanding or psychological exploration tool",
          "Focused on personal growth, relationships, or emotional insight",
        ],
    disqualifiers: [],
    directCompetitors: [],
    indirectAlternatives: [],
    excludedAlternatives: [],
    firstOutcome:
      agent === "seo"
        ? chinese
          ? "评估与出生星盘生成相关的搜索机会"
          : "Evaluate birth-chart search opportunities that lead to chart generation"
        : chinese
          ? "评估公开出生星盘体验的可抓取性与可靠性"
          : "Evaluate crawlability and reliability of the public birth-chart experience",
    country: "",
    locale: "",
    device: "mobile",
    pageType: hasRootPath(targetUrl) ? "homepage" : "tool",
    targetQuery: "",
    auditScope: "site-first",
    sources: {
      product: "product_information_supplied",
      icp: "product_information_supplied",
      competitor: "confirmation_required",
      run: "inferred_run_assumptions",
    },
    fieldProvenance: astrologyWikiFieldProvenance(observedAt),
    editedFields: [],
    reviewState: "needs_confirmation",
  };
}

function genericDraft(
  agent: AgentKind,
  targetUrl: string,
  host: string,
  presentationLocale: string,
): AgentProfileDraft {
  const chinese = usesChinesePresentation(presentationLocale);
  const label = host || (chinese ? "未知网站" : "Unknown website");
  const observedAt = new Date().toISOString();
  return {
    schemaVersion: AGENT_PROFILE_SCHEMA_VERSION,
    agent,
    targetUrl,
    host,
    productName: label,
    oneLinePositioning: chinese
      ? `${label} 上的公开网站；其产品与定位尚未确认。`
      : `Public website at ${label}; its product and positioning are not yet confirmed.`,
    valueProposition: chinese
      ? "未知——请确认核心价值主张。"
      : "Unknown — confirm the value proposition.",
    coreFeatures: [],
    categories: [
      chinese ? "未知——请确认产品类别。" : "Unknown — confirm the category.",
    ],
    businessModel: chinese
      ? "未知——请确认商业模式。"
      : "Unknown — confirm the business model.",
    primaryCta: chinese
      ? "未知——请确认主要行动号召。"
      : "Unknown — confirm the primary call to action.",
    trustSignals: [],
    primaryIcp: chinese
      ? "未知——请确认主要受众。"
      : "Unknown — confirm the primary audience.",
    buyer: chinese
      ? "未知——请确认购买者角色。"
      : "Unknown — confirm the buying role.",
    user: chinese ? "未知——请确认用户角色。" : "Unknown — confirm the user role.",
    triggerPain: chinese
      ? "未知——请确认触发因素或痛点。"
      : "Unknown — confirm the trigger or pain.",
    icpInterests: [],
    icpPain: chinese
      ? "未知——请确认受众痛点。"
      : "Unknown — confirm the audience pain.",
    icpBehavior: chinese
      ? "未知——请确认受众行为。"
      : "Unknown — confirm audience behavior.",
    icpPositioning: chinese
      ? "未知——请确认定位。"
      : "Unknown — confirm the positioning.",
    jtbd: chinese
      ? "未知——请确认需要完成的任务。"
      : "Unknown — confirm the job to be done.",
    useCases: [],
    outcomes: [],
    barriers: [],
    qualificationSignals: [],
    disqualifiers: [],
    directCompetitors: [],
    indirectAlternatives: [],
    excludedAlternatives: [],
    firstOutcome:
      agent === "seo"
        ? chinese
          ? "确认首个搜索增长目标。"
          : "Confirm the first search-growth outcome."
        : chinese
          ? "确认首个技术可靠性目标。"
          : "Confirm the first technical reliability outcome.",
    country: "",
    locale: "",
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
    fieldProvenance: genericFieldProvenance(host, observedAt),
    editedFields: [],
    reviewState: "needs_confirmation",
  };
}

/** Create a new independent draft. No network request or app persistence occurs. */
export function createAgentProfileDraft(
  agent: AgentKind,
  url: string,
  presentationLocale = "en",
): AgentProfileDraft {
  const targetUrl = url.trim();
  const host = displayHost(targetUrl);
  return host === "astrologywiki.com"
    ? astrologyWikiDraft(agent, targetUrl, presentationLocale)
    : genericDraft(agent, targetUrl, host, presentationLocale);
}

/** Changing a URL invalidates confirmation and any edits from the previous target. */
export function redraftAgentProfileForUrl(
  profile: AgentProfileDraft,
  url: string,
  presentationLocale = "en",
): AgentProfileDraft {
  const targetUrl = url.trim();
  return targetUrl === profile.targetUrl
    ? copyDraft(profile)
    : createAgentProfileDraft(profile.agent, targetUrl, presentationLocale);
}

/** Apply only declared editable fields and return the run context to draft state. */
/**
 * The edits a checker handoff is allowed to claim the visitor made.
 *
 * `targetQuery` is present only when the checker actually carried one. Passing
 * the key with an inherited value would stamp `user_edit` on a query nobody
 * supplied, which is the same laundering the market fix exists to stop, pointed
 * the other way — and `updateAgentProfile` treats every key present as a
 * deliberate edit, so "leave it alone" has to be expressed by omission.
 */
export function checkerHandoffEdits(draft: {
  readonly country: string;
  readonly locale: string;
  readonly pageType: AgentProfileDraft["pageType"];
  readonly targetQueries: readonly string[];
}): AgentProfileEdits {
  const handedQuery = draft.targetQueries[0];
  return {
    country: draft.country,
    locale: draft.locale,
    pageType: draft.pageType,
    ...(handedQuery !== undefined && handedQuery.trim() !== ""
      ? { targetQuery: handedQuery }
      : {}),
  };
}

export function updateAgentProfile(
  profile: AgentProfileDraft,
  edits: AgentProfileEdits,
): AgentProfileDraft {
  const editedFields = [...profile.editedFields];
  const fieldProvenance: AgentProfileFieldProvenance[] =
    profile.fieldProvenance.map((entry) => ({
      ...entry,
      evidenceUrls: [...entry.evidenceUrls],
    }));
  const accepted: AgentProfileEdits = {};
  for (const [key, value] of Object.entries(edits)) {
    if (!EDITABLE_FIELD_SET.has(key as AgentProfileEditableField)) continue;
    const field = key as AgentProfileEditableField;
    (accepted as Record<string, unknown>)[field] = value;
    if (!editedFields.includes(field)) editedFields.push(field);
    const index = fieldProvenance.findIndex(
      (entry) => entry.path === `/${field}`,
    );
    const userEdit = declaredProvenance(field, "user_edit");
    if (index === -1) fieldProvenance.push(userEdit);
    else fieldProvenance[index] = userEdit;
  }
  return copyDraft({
    ...profile,
    ...accepted,
    fieldProvenance,
    editedFields,
    reviewState: "needs_confirmation",
  });
}

const REFRESH_PRODUCT_FIELDS = new Set<AgentProfileEditableField>([
  "productName",
  "oneLinePositioning",
  "valueProposition",
  "coreFeatures",
  "categories",
  "businessModel",
  "primaryCta",
  "trustSignals",
]);
const REFRESH_ICP_FIELDS = new Set<AgentProfileEditableField>([
  "primaryIcp",
  "buyer",
  "user",
  "triggerPain",
  "icpInterests",
  "icpPain",
  "icpBehavior",
  "icpPositioning",
  "jtbd",
  "useCases",
  "outcomes",
  "barriers",
  "qualificationSignals",
  "disqualifiers",
]);

function comparableUrl(input: string): string {
  try {
    const parsed = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`,
    );
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function isMatchingAgentProfileRefresh(
  profile: AgentProfileDraft,
  refresh: AgentProfileRefreshResult,
): boolean {
  return (
    refresh.agent === profile.agent &&
    comparableUrl(refresh.request.submittedUrl) ===
      comparableUrl(profile.targetUrl) &&
    comparableUrl(refresh.request.normalizedUrl) ===
      comparableUrl(profile.targetUrl) &&
    displayHost(refresh.request.targetHost) === profile.host &&
    refresh.request.marketCode.toUpperCase() === profile.country.toUpperCase() &&
    refresh.request.languageTag.toLowerCase() === profile.locale.toLowerCase()
  );
}

function profileValueMatchesRefreshField(
  profile: AgentProfileDraft,
  field: AgentProfileRefreshResult["fields"][number],
): boolean {
  if (field.state !== "available") return false;
  const current = profile[field.path];
  return Array.isArray(current) && Array.isArray(field.value)
    ? current.length === field.value.length &&
        current.every((value, index) => value === field.value[index])
    : current === field.value;
}

function isAppliedRefreshField(
  profile: AgentProfileDraft,
  refresh: AgentProfileRefreshResult,
  field: AgentProfileRefreshResult["fields"][number],
): boolean {
  const provenance = profile.fieldProvenance.find(
    (entry) => entry.path === `/${field.path}`,
  );
  return (
    field.state === "available" &&
    provenance?.source === "public_page" &&
    provenance.observedAt === refresh.observedAt &&
    profileValueMatchesRefreshField(profile, field)
  );
}

/** Describe a matching live refresh by what this draft actually contains. */
export function summarizeAgentProfileRefresh(
  profile: AgentProfileDraft,
  refresh: AgentProfileRefreshResult,
): AgentProfileRefreshSummary {
  if (!isMatchingAgentProfileRefresh(profile, refresh)) {
    return { found: 0, applied: 0, retained: 0, unavailable: 0 };
  }

  let found = 0;
  let applied = 0;
  let unavailable = 0;
  for (const field of refresh.fields) {
    if (field.state === "unavailable") {
      unavailable += 1;
      continue;
    }
    found += 1;
    if (isAppliedRefreshField(profile, refresh, field)) {
      applied += 1;
    }
  }
  return { found, applied, retained: found - applied, unavailable };
}

/** Return source-labeled live alternatives that differ from retained values. */
export function listAgentProfileRefreshProposals(
  profile: AgentProfileDraft,
  refresh: AgentProfileRefreshResult,
): readonly AgentProfileRefreshProposal[] {
  if (!isMatchingAgentProfileRefresh(profile, refresh)) return [];

  const proposals: AgentProfileRefreshProposal[] = [];
  for (const field of refresh.fields) {
    if (
      field.state !== "available" ||
      isAppliedRefreshField(profile, refresh, field) ||
      profileValueMatchesRefreshField(profile, field)
    ) {
      continue;
    }
    const provenance = profile.fieldProvenance.find(
      (entry) => entry.path === `/${field.path}`,
    );
    if (!provenance) continue;
    const currentValue = profile[field.path];
    proposals.push({
      path: field.path,
      currentValue: Array.isArray(currentValue)
        ? [...currentValue]
        : currentValue,
      liveValue: Array.isArray(field.value) ? [...field.value] : field.value,
      evidenceUrls: [...field.evidenceUrls],
      currentSource: provenance.source,
      liveSource: "public_page",
    });
  }
  return proposals;
}

/** Apply explicit live choices while keeping manual edits authoritative. */
export function acceptAgentProfileRefreshFields(
  profile: AgentProfileDraft,
  refresh: AgentProfileRefreshResult,
  paths: readonly AgentProfileRefreshFieldPath[],
): AgentProfileDraft {
  if (!isMatchingAgentProfileRefresh(profile, refresh)) return profile;

  const selected = new Set(paths);
  const accepted: AgentProfileEdits = {};
  const fieldProvenance: AgentProfileFieldProvenance[] =
    profile.fieldProvenance.map((entry) => ({
      ...entry,
      evidenceUrls: [...entry.evidenceUrls],
    }));
  let acceptedCount = 0;
  let productRefreshed = false;
  let icpRefreshed = false;

  for (const field of refresh.fields) {
    if (field.state !== "available" || !selected.has(field.path)) continue;
    const provenanceIndex = fieldProvenance.findIndex(
      (entry) => entry.path === `/${field.path}`,
    );
    const currentProvenance = fieldProvenance[provenanceIndex];
    if (
      !currentProvenance ||
      currentProvenance.source === "user_edit" ||
      profile.editedFields.includes(field.path)
    ) {
      continue;
    }
    (accepted as Record<string, unknown>)[field.path] = Array.isArray(field.value)
      ? [...field.value]
      : field.value;
    fieldProvenance[provenanceIndex] = {
      path: `/${field.path}`,
      derivation: "inferred",
      confidence: field.confidence,
      source: "public_page",
      limitation: field.limitation,
      observedAt: refresh.observedAt,
      evidenceUrls: [...field.evidenceUrls],
    };
    acceptedCount += 1;
    productRefreshed ||= REFRESH_PRODUCT_FIELDS.has(field.path);
    icpRefreshed ||= REFRESH_ICP_FIELDS.has(field.path);
  }

  if (acceptedCount === 0) return profile;
  return copyDraft({
    ...profile,
    ...accepted,
    sources: {
      ...profile.sources,
      product:
        productRefreshed &&
        profile.sources.product !== "product_information_supplied" &&
        profile.sources.product !== "marketing_strategy_supplied"
          ? "public_page_refresh"
          : profile.sources.product,
      icp:
        icpRefreshed &&
        profile.sources.icp !== "product_information_supplied" &&
        profile.sources.icp !== "marketing_strategy_supplied"
          ? "public_page_refresh"
          : profile.sources.icp,
    },
    fieldProvenance,
    reviewState: "needs_confirmation",
  });
}

/**
 * Merge one browser-validated live diagnosis into this temporary local draft.
 * This does not confirm or persist an app Product Profile.
 */
export function applyAgentProfileRefresh(
  profile: AgentProfileDraft,
  refresh: AgentProfileRefreshResult,
): AgentProfileDraft {
  if (!isMatchingAgentProfileRefresh(profile, refresh)) {
    return profile;
  }

  const accepted: AgentProfileEdits = {};
  const fieldProvenance: AgentProfileFieldProvenance[] =
    profile.fieldProvenance.map((entry) => ({
      ...entry,
      evidenceUrls: [...entry.evidenceUrls],
    }));
  let productRefreshed = false;
  let icpRefreshed = false;

  for (const field of refresh.fields) {
    if (field.state !== "available") continue;
    const provenanceIndex = fieldProvenance.findIndex(
      (entry) => entry.path === `/${field.path}`,
    );
    const currentProvenance = fieldProvenance[provenanceIndex];
    if (
      !currentProvenance ||
      profile.editedFields.includes(field.path) ||
      !(
        currentProvenance.source === "not_available" ||
        currentProvenance.source === "visitor_url" ||
        currentProvenance.source === "local_inference" ||
        currentProvenance.source === "public_page"
      )
    ) {
      continue;
    }
    (accepted as Record<string, unknown>)[field.path] = Array.isArray(field.value)
      ? [...field.value]
      : field.value;
    const provenance: AgentProfileFieldProvenance = {
      path: `/${field.path}`,
      derivation: "inferred",
      confidence: field.confidence,
      source: "public_page",
      limitation: field.limitation,
      observedAt: refresh.observedAt,
      evidenceUrls: [...field.evidenceUrls],
    };
    fieldProvenance[provenanceIndex] = provenance;
    productRefreshed ||= REFRESH_PRODUCT_FIELDS.has(field.path);
    icpRefreshed ||= REFRESH_ICP_FIELDS.has(field.path);
  }

  return copyDraft({
    ...profile,
    ...accepted,
    sources: {
      ...profile.sources,
      product:
        productRefreshed &&
        profile.sources.product !== "product_information_supplied" &&
        profile.sources.product !== "marketing_strategy_supplied"
        ? "public_page_refresh"
        : profile.sources.product,
      icp:
        icpRefreshed &&
        profile.sources.icp !== "product_information_supplied" &&
        profile.sources.icp !== "marketing_strategy_supplied"
          ? "public_page_refresh"
          : profile.sources.icp,
    },
    fieldProvenance,
    reviewState: "needs_confirmation",
  });
}

/** Confirmation is a local immutable snapshot, not an app Product Profile version. */
export function confirmAgentProfile(
  profile: AgentProfileDraft,
): AgentProfileDraft {
  return copyDraft({
    ...profile,
    reviewState: isAgentProfileReady(profile)
      ? "confirmed"
      : "needs_confirmation",
  });
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
    value.every((item) => isBoundedString(item)) &&
    new Set(value).size === value.length
  );
}

function hasExactKeys(value: object, expected: ReadonlySet<PropertyKey>): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.size && keys.every((key) => expected.has(key))
  );
}

function isIsoDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isFieldProvenance(
  value: unknown,
): value is AgentProfileFieldProvenance {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!hasExactKeys(value, FIELD_PROVENANCE_KEYS)) return false;
  const candidate = value as Partial<AgentProfileFieldProvenance>;
  if (
    typeof candidate.path !== "string" ||
    !candidate.path.startsWith("/") ||
    !EDITABLE_FIELD_SET.has(
      candidate.path.slice(1) as AgentProfileEditableField,
    ) ||
    !PROVENANCE_DERIVATION_VALUES.has(
      candidate.derivation as AgentProfileProvenanceDerivation,
    ) ||
    !CONFIDENCE_VALUES.has(candidate.confidence as AgentProfileConfidence) ||
    !FIELD_SOURCE_VALUES.has(candidate.source as AgentProfileFieldSource) ||
    !(
      candidate.limitation === null ||
      isBoundedString(candidate.limitation)
    ) ||
    !(candidate.observedAt === null || isIsoDateTime(candidate.observedAt)) ||
    !isStringArray(candidate.evidenceUrls)
  ) {
    return false;
  }

  if (candidate.derivation === "declared") {
    return (
      candidate.observedAt === null &&
      candidate.evidenceUrls.length === 0 &&
      candidate.confidence !== "unknown" &&
      (candidate.source === "supplied_product_information" ||
        candidate.source === "supplied_marketing_strategy" ||
        candidate.source === "user_edit")
    );
  }
  if (candidate.derivation === "observed") {
    return (
      candidate.source === "public_page" &&
      isIsoDateTime(candidate.observedAt) &&
      candidate.evidenceUrls.length > 0
    );
  }
  if (candidate.derivation === "computed") {
    return (
      candidate.source === "local_computation" &&
      isIsoDateTime(candidate.observedAt) &&
      candidate.evidenceUrls.length === 0
    );
  }
  if (candidate.derivation === "inferred") {
    return (
      (candidate.source === "visitor_url" ||
        candidate.source === "local_inference" ||
        candidate.source === "public_page") &&
      isIsoDateTime(candidate.observedAt) &&
      (candidate.source === "public_page"
        ? candidate.evidenceUrls.length > 0
        : candidate.evidenceUrls.length === 0) &&
      (candidate.limitation === null || isBoundedString(candidate.limitation))
    );
  }
  return (
    candidate.derivation === "missing" &&
    candidate.source === "not_available" &&
    candidate.confidence === "unknown" &&
    candidate.observedAt === null &&
    candidate.evidenceUrls.length === 0 &&
    isBoundedString(candidate.limitation)
  );
}

function isCompleteFieldProvenance(
  value: unknown,
  editedFields: readonly AgentProfileEditableField[],
): value is readonly AgentProfileFieldProvenance[] {
  if (!Array.isArray(value) || value.length !== EDITABLE_FIELDS.length) {
    return false;
  }
  if (!value.every(isFieldProvenance)) return false;
  const paths = new Set(value.map((entry) => entry.path));
  if (
    paths.size !== EDITABLE_FIELDS.length ||
    !EDITABLE_FIELDS.every((field) => paths.has(`/${field}`))
  ) {
    return false;
  }
  const edited = new Set(editedFields);
  return value.every(
    (entry) =>
      (entry.source === "user_edit") ===
      edited.has(entry.path.slice(1) as AgentProfileEditableField),
  );
}

/**
 * The context a run actually consumes.
 *
 * The audit itself is decided by crawl evidence alone, so blocking a run on
 * fifteen positioning fields bought nothing. These five are the ones the run
 * reads back: they label the evidence and fill the Stage 04 solution preview.
 *
 * The first desired outcome is deliberately not here. It ships with a prompt
 * for a placeholder ("Confirm the first search-growth outcome.") and the page
 * renders it as the section heading, so a visitor reading the card sees a
 * sentence, not an empty field — gating a run on it stops the run with no
 * visible way to satisfy it.
 */
export const AGENT_PROFILE_READY_FIELDS = [
  "productName",
  "primaryCta",
  "primaryIcp",
  "country",
  "locale",
] as const satisfies readonly AgentProfileEditableField[];

/** Minimal local gate aligned with the app's confirmed Product Profile roots. */
export function isAgentProfileReady(profile: AgentProfileDraft): boolean {
  const provenance = new Map(
    profile.fieldProvenance.map((entry) => [entry.path, entry]),
  );
  return AGENT_PROFILE_READY_FIELDS.every((field) => {
    const entry = provenance.get(`/${field}`);
    if (!entry || entry.derivation === "missing") return false;
    const value = profile[field];
    return Array.isArray(value)
      ? value.length > 0 && value.every((item) => isBoundedString(item))
      : isBoundedString(value);
  });
}

/** Strict browser guard for an untrusted, same-tab v3 draft handoff. */
export function isAgentProfileDraft(
  value: unknown,
  agent?: AgentKind,
  exactUrl?: string,
): value is AgentProfileDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!hasExactKeys(value, DRAFT_KEYS)) return false;
  const candidate = value as Partial<AgentProfileDraft>;
  const sources = candidate.sources;
  const editedFields = candidate.editedFields;
  return (
    candidate.schemaVersion === AGENT_PROFILE_SCHEMA_VERSION &&
    (candidate.agent === "seo" || candidate.agent === "tech") &&
    (agent === undefined || candidate.agent === agent) &&
    isBoundedString(candidate.targetUrl, true) &&
    candidate.targetUrl.trim() === candidate.targetUrl &&
    (exactUrl === undefined || candidate.targetUrl === exactUrl) &&
    isBoundedString(candidate.host, true) &&
    candidate.host === displayHost(candidate.targetUrl) &&
    isBoundedString(candidate.productName) &&
    isBoundedString(candidate.oneLinePositioning) &&
    isBoundedString(candidate.valueProposition) &&
    isStringArray(candidate.coreFeatures, 20) &&
    isStringArray(candidate.categories, 20) &&
    isBoundedString(candidate.businessModel) &&
    isBoundedString(candidate.primaryCta) &&
    isStringArray(candidate.trustSignals, 20) &&
    isBoundedString(candidate.primaryIcp) &&
    isBoundedString(candidate.buyer) &&
    isBoundedString(candidate.user) &&
    isBoundedString(candidate.triggerPain) &&
    isStringArray(candidate.icpInterests, 20) &&
    isBoundedString(candidate.icpPain) &&
    isBoundedString(candidate.icpBehavior) &&
    isBoundedString(candidate.icpPositioning) &&
    isBoundedString(candidate.jtbd) &&
    isStringArray(candidate.useCases, 20) &&
    isStringArray(candidate.outcomes, 20) &&
    isStringArray(candidate.barriers, 20) &&
    isStringArray(candidate.qualificationSignals, 20) &&
    isStringArray(candidate.disqualifiers, 20) &&
    isStringArray(candidate.directCompetitors) &&
    isStringArray(candidate.indirectAlternatives) &&
    isStringArray(candidate.excludedAlternatives) &&
    isBoundedString(candidate.firstOutcome) &&
    isBoundedString(candidate.country, true) &&
    isBoundedString(candidate.locale, true) &&
    DEVICE_VALUES.has(candidate.device as AgentProfileDevice) &&
    PAGE_TYPE_VALUES.has(candidate.pageType as AgentProfilePageType) &&
    isBoundedString(candidate.targetQuery, true) &&
    AUDIT_SCOPE_VALUES.has(candidate.auditScope as AgentAuditScope) &&
    !!sources &&
    typeof sources === "object" &&
    !Array.isArray(sources) &&
    hasExactKeys(sources, SOURCE_KEYS) &&
    SOURCE_VALUES.has(sources.product as AgentProfileSourceId) &&
    SOURCE_VALUES.has(sources.icp as AgentProfileSourceId) &&
    SOURCE_VALUES.has(sources.competitor as AgentProfileSourceId) &&
    SOURCE_VALUES.has(sources.run as AgentProfileSourceId) &&
    Array.isArray(editedFields) &&
    new Set(editedFields).size === editedFields.length &&
    editedFields.every((field) =>
      EDITABLE_FIELD_SET.has(field as AgentProfileEditableField),
    ) &&
    isCompleteFieldProvenance(
      candidate.fieldProvenance,
      editedFields as readonly AgentProfileEditableField[],
    ) &&
    (candidate.reviewState === "needs_confirmation" ||
      candidate.reviewState === "confirmed")
  );
}

/** Runtime guard used only for a same-tab, short-lived confirmed run handoff. */
export function isConfirmedAgentProfile(
  value: unknown,
  agent?: AgentKind,
  exactUrl?: string,
): value is AgentProfileDraft {
  return (
    isAgentProfileDraft(value, agent, exactUrl) &&
    value.reviewState === "confirmed" &&
    isAgentProfileReady(value)
  );
}
