// @input  -- a confirmed Marketing website profile plus one Agent run context
// @output -- detached imports, exact references, and source-honest refresh drafts
// @pos    -- explicit adapter between durable account context and local Agent state

import {
  createAgentProfileDraft,
  isAgentProfileReady,
  type AgentAuditScope,
  type AgentProfileDraft,
  type AgentProfileEditableField,
  type AgentProfilePageType,
  type AgentProfileDevice,
} from "../../components/agents/agent-profile.ts";
import type { AgentKind } from "../../components/agents/agent-types.ts";
import type { AgentProfileRefreshResult } from "../agents/profile-refresh-contract.ts";
import {
  MARKETING_WEBSITE_PROFILE_VERSION,
  normalizeAccountWebsiteUrl,
  parseMarketingWebsiteProfile,
  parseWebsiteProfileReference,
  profileSha256,
  WEBSITE_PROFILE_FIELD_NAMES,
  type MarketingWebsiteProfileV1,
  type WebsiteProfileFieldName,
  type WebsiteProfileFieldProvenance,
  type WebsiteProfileReferenceV1,
} from "./contracts.ts";

export interface AgentWebsiteProfileRunContext {
  readonly agent: AgentKind;
  readonly targetUrl: string;
  readonly presentationLocale: string;
  readonly device: AgentProfileDevice;
  readonly pageType: AgentProfilePageType;
  readonly targetQuery: string;
  readonly auditScope: AgentAuditScope;
}

export interface WebsiteProfileRefreshIdentity {
  readonly origin: string;
  readonly canonicalSiteKey: string;
}

export interface ImportedWebsiteProfile {
  readonly kind: "import";
  readonly draft: AgentProfileDraft;
  readonly reference: null;
}

export interface ReferencedWebsiteProfile {
  readonly kind: "reference";
  readonly draft: AgentProfileDraft;
  readonly reference: WebsiteProfileReferenceV1;
}

const WEBSITE_FIELD_SET = new Set<string>(WEBSITE_PROFILE_FIELD_NAMES);
const AGENT_REQUIRED_WEBSITE_TEXT_FIELDS = [
  "productName",
  "oneLinePositioning",
  "valueProposition",
  "businessModel",
  "primaryCta",
  "primaryIcp",
  "buyer",
  "user",
  "triggerPain",
  "icpPain",
  "icpBehavior",
  "icpPositioning",
  "jtbd",
  "firstOutcome",
] as const;
const WEBSITE_LIST_FIELD_SET = new Set<WebsiteProfileFieldName>([
  "coreFeatures",
  "categories",
  "trustSignals",
  "icpInterests",
  "useCases",
  "outcomes",
  "barriers",
  "qualificationSignals",
  "disqualifiers",
  "directCompetitors",
  "indirectAlternatives",
  "excludedAlternatives",
]);

type WebsiteProfileFields = Omit<
  MarketingWebsiteProfileV1,
  "schemaVersion" | "fieldProvenance"
>;
type MutableWebsiteProfileFields = {
  -readonly [Field in keyof WebsiteProfileFields]: WebsiteProfileFields[Field];
};

function websiteFieldValues(profile: WebsiteProfileFields): WebsiteProfileFields {
  return {
    productName: profile.productName,
    oneLinePositioning: profile.oneLinePositioning,
    valueProposition: profile.valueProposition,
    coreFeatures: [...profile.coreFeatures],
    categories: [...profile.categories],
    businessModel: profile.businessModel,
    primaryCta: profile.primaryCta,
    trustSignals: [...profile.trustSignals],
    primaryIcp: profile.primaryIcp,
    buyer: profile.buyer,
    user: profile.user,
    triggerPain: profile.triggerPain,
    icpInterests: [...profile.icpInterests],
    icpPain: profile.icpPain,
    icpBehavior: profile.icpBehavior,
    icpPositioning: profile.icpPositioning,
    jtbd: profile.jtbd,
    useCases: [...profile.useCases],
    outcomes: [...profile.outcomes],
    barriers: [...profile.barriers],
    qualificationSignals: [...profile.qualificationSignals],
    disqualifiers: [...profile.disqualifiers],
    directCompetitors: [...profile.directCompetitors],
    indirectAlternatives: [...profile.indirectAlternatives],
    excludedAlternatives: [...profile.excludedAlternatives],
    firstOutcome: profile.firstOutcome,
    country: profile.country,
    locale: profile.locale,
  };
}

function websiteProfileToAgentDraft(
  input: MarketingWebsiteProfileV1,
  run: AgentWebsiteProfileRunContext,
  reviewState: AgentProfileDraft["reviewState"],
): AgentProfileDraft {
  const profile = parseMarketingWebsiteProfile(input);
  const base = createAgentProfileDraft(
    run.agent,
    run.targetUrl,
    run.presentationLocale,
  );
  const editedFields = profile.fieldProvenance.flatMap((entry) =>
    entry.source === "user_edit"
      ? [entry.path.slice(1) as AgentProfileEditableField]
      : [],
  );
  const websiteProvenance = new Map<string, WebsiteProfileFieldProvenance>(
    profile.fieldProvenance.map((entry) => [entry.path, entry] as const),
  );
  const fieldProvenance = base.fieldProvenance.map((baseEntry) => {
    const websiteEntry = websiteProvenance.get(baseEntry.path);
    if (websiteEntry === undefined) {
      return { ...baseEntry, evidenceUrls: [...baseEntry.evidenceUrls] };
    }
    return {
      ...websiteEntry,
      // AgentProfileDraft's established guard treats missing as timeless: the
      // failed observation stays in limitation copy, not a fact timestamp.
      observedAt:
        websiteEntry.derivation === "missing"
          ? null
          : websiteEntry.observedAt,
      evidenceUrls: [...websiteEntry.evidenceUrls],
    };
  });

  const values = websiteFieldValues(profile) as MutableWebsiteProfileFields &
    Record<string, unknown>;
  for (const field of AGENT_REQUIRED_WEBSITE_TEXT_FIELDS) {
    if ((values[field] as string).trim() === "") values[field] = base[field];
  }
  const draft: AgentProfileDraft = {
    ...base,
    ...values,
    device: run.device,
    pageType: run.pageType,
    targetQuery: run.targetQuery,
    auditScope: run.auditScope,
    sources: {
      product: "saved_website_profile",
      icp: "saved_website_profile",
      competitor: "saved_website_profile",
      run: "inferred_run_assumptions",
    },
    fieldProvenance,
    editedFields,
    reviewState: "needs_confirmation",
  };
  return reviewState === "confirmed" && isAgentProfileReady(draft)
    ? { ...draft, reviewState: "confirmed" }
    : draft;
}

export function importWebsiteProfile(
  profile: MarketingWebsiteProfileV1,
  run: AgentWebsiteProfileRunContext,
): ImportedWebsiteProfile {
  return {
    kind: "import",
    draft: websiteProfileToAgentDraft(profile, run, "needs_confirmation"),
    reference: null,
  };
}

export async function referenceWebsiteProfile(
  profile: MarketingWebsiteProfileV1,
  reference: WebsiteProfileReferenceV1,
  run: AgentWebsiteProfileRunContext,
): Promise<ReferencedWebsiteProfile> {
  // This bridge creates local Agent state only. The account API remains the
  // authority for ownership and snapshot identity and must recompute the hash
  // server-side; Web Crypto here is a second consistency check, not trust.
  const parsedProfile = parseMarketingWebsiteProfile(profile);
  const parsedReference = parseWebsiteProfileReference(reference);
  if ((await profileSha256(parsedProfile)) !== parsedReference.profileHash) {
    throw new Error("profile hash does not match the referenced snapshot");
  }
  return {
    kind: "reference",
    draft: websiteProfileToAgentDraft(parsedProfile, run, "confirmed"),
    reference: parsedReference,
  };
}

export function agentDraftToWebsiteProfile(
  draft: AgentProfileDraft,
): MarketingWebsiteProfileV1 {
  const provenance = draft.fieldProvenance.filter((entry) =>
    WEBSITE_FIELD_SET.has(entry.path.slice(1)),
  ) as readonly WebsiteProfileFieldProvenance[];
  const values = websiteFieldValues(draft) as MutableWebsiteProfileFields &
    Record<string, unknown>;
  for (const entry of provenance) {
    if (entry.derivation !== "missing") continue;
    const field = entry.path.slice(1) as WebsiteProfileFieldName;
    (values as unknown as Record<string, unknown>)[field] =
      WEBSITE_LIST_FIELD_SET.has(field) ? [] : "";
  }
  return parseMarketingWebsiteProfile({
    schemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
    ...values,
    fieldProvenance: provenance.map((entry) => ({
      ...entry,
      evidenceUrls: [...entry.evidenceUrls],
    })),
  });
}

function isWebsiteField(
  value: string,
): value is WebsiteProfileFieldName {
  return WEBSITE_FIELD_SET.has(value);
}

export function applyProfileRefreshToWebsiteDraft(
  input: MarketingWebsiteProfileV1,
  refresh: AgentProfileRefreshResult,
  identity: WebsiteProfileRefreshIdentity,
): MarketingWebsiteProfileV1 {
  const expected = normalizeAccountWebsiteUrl(identity.origin);
  const requested = normalizeAccountWebsiteUrl(refresh.request.normalizedUrl);
  const targetHost = normalizeAccountWebsiteUrl(
    `https://${refresh.request.targetHost}`,
  );
  const resolved = normalizeAccountWebsiteUrl(refresh.diagnostics.resolvedOrigin);
  if (
    expected === null ||
    expected.canonicalSiteKey !== identity.canonicalSiteKey ||
    requested?.canonicalSiteKey !== identity.canonicalSiteKey ||
    targetHost?.canonicalSiteKey !== identity.canonicalSiteKey ||
    resolved?.canonicalSiteKey !== identity.canonicalSiteKey
  ) {
    throw new Error("profile refresh belongs to a different website");
  }
  const profile = parseMarketingWebsiteProfile(input);
  const fieldProvenance: WebsiteProfileFieldProvenance[] =
    profile.fieldProvenance.map((entry) => ({
      ...entry,
      evidenceUrls: [...entry.evidenceUrls],
    }));
  const next = {
    ...profile,
    ...websiteFieldValues(profile),
    fieldProvenance,
  };

  for (const field of refresh.fields) {
    if (!isWebsiteField(field.path)) continue;
    const currentIndex = next.fieldProvenance.findIndex(
      (entry) => entry.path === `/${field.path}`,
    );
    const current = next.fieldProvenance[currentIndex];
    if (current?.source === "user_edit") continue;

    if (field.state === "unavailable") {
      const currentValue = (next as unknown as Record<string, unknown>)[
        field.path
      ];
      const currentIsEmpty = Array.isArray(currentValue)
        ? currentValue.length === 0
        : currentValue === "";
      if (!currentIsEmpty || (current && current.source !== "not_available")) {
        continue;
      }
      const unavailableProvenance: WebsiteProfileFieldProvenance = {
        path: `/${field.path}`,
        derivation: field.derivation,
        confidence: field.confidence,
        source: field.source,
        limitation: field.limitation,
        observedAt: null,
        evidenceUrls: [],
      };
      if (currentIndex === -1) {
        next.fieldProvenance.push(unavailableProvenance);
      } else {
        next.fieldProvenance[currentIndex] = unavailableProvenance;
      }
      continue;
    }

    (next as unknown as Record<string, unknown>)[field.path] = Array.isArray(
      field.value,
    )
      ? [...field.value]
      : field.value;
    const provenance: WebsiteProfileFieldProvenance = {
      path: `/${field.path}`,
      derivation: field.derivation,
      confidence: field.confidence,
      source: field.source,
      limitation: field.limitation,
      observedAt: refresh.observedAt,
      evidenceUrls: [...field.evidenceUrls],
    };
    if (currentIndex === -1) {
      next.fieldProvenance.push(provenance);
    } else {
      next.fieldProvenance[currentIndex] = provenance;
    }
  }

  return parseMarketingWebsiteProfile(next);
}
