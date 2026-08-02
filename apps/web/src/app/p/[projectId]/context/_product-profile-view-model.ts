import {
  ConfirmedProductProfile,
  type ProductProfileDraft,
  type ProductProfileFieldProvenance,
  type ProductProfileTargetAudience,
} from "@sf/contracts";
import type { ProductProfileWorkspace } from "@/lib/api/hooks-product-profile";

export type ProductProfileFactState =
  | "supported"
  | "missing"
  | "conflicting"
  | "unconfirmed";

export interface FieldFactState {
  readonly state: ProductProfileFactState;
  readonly label:
    | ProductProfileFieldProvenance["derivation"]
    | "unconfirmed"
    | "conflicting";
  readonly confidence: ProductProfileFieldProvenance["confidence"];
  readonly limitation: string | null;
  readonly observedAt: string | null;
}

export type ConfirmationItemId =
  | "identity"
  | "business"
  | "value"
  | "markets"
  | "primaryIcp"
  | "competitors";

export interface ConfirmationItem {
  readonly id: ConfirmationItemId;
  readonly complete: boolean;
  /**
   * Editable field keys that are blocking this item, named so the customer can
   * go fill exactly those instead of hunting through the editor. Only the ICP
   * item populates this today: it gates on six separate list fields, and a
   * single empty one silently blocks confirmation and every downstream step.
   * The other items gate on one or two fields that the page already shows in
   * full, so naming them would add noise rather than direction.
   */
  readonly missingFieldKeys: readonly string[];
}

export interface ProductProfileViewModel {
  readonly profileState: "missing" | "draft" | "confirmed";
  readonly row: ProductProfileWorkspace["currentProfile"];
  readonly profile: ProductProfileDraft | null;
  readonly primaryAudience: ProductProfileTargetAudience | null;
  readonly confirmation: {
    readonly ready: boolean;
    readonly items: readonly ConfirmationItem[];
  };
  readonly evidence: {
    readonly sourcePageUrl: string | null;
    readonly frozen: boolean;
    readonly sourceSnapshotId: string | null;
    readonly analysisInvocationId: string | null;
    readonly generatedAt: string | null;
    readonly provenanceCount: number;
    readonly missingCount: number;
    readonly conflictCount: number;
  };
}

/**
 * A discovery run can be a backfill for an already-generated draft. Its prior
 * generatedAt timestamp must not suppress the synthesis retry that consumes
 * the newly collected competitor evidence.
 */
export function shouldContinueSynthesisAfterCompetitorDiscovery(input: {
  readonly rowStatus: "draft" | "complete" | null;
  readonly generatedAt: string | null;
}): boolean {
  return input.rowStatus === "draft";
}

const FACT_DERIVATIONS = new Set([
  "declared",
  "observed",
  "computed",
  "inferred",
  "contradicted",
]);

function overlaps(left: string, right: string): boolean {
  return (
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

function provenanceFor(
  profile: ProductProfileDraft,
  path: string,
): ProductProfileFieldProvenance | undefined {
  return profile.fieldProvenance.find(
    (entry) => overlaps(entry.path, path) && FACT_DERIVATIONS.has(entry.derivation),
  );
}

export function getFieldFactState(
  profile: ProductProfileDraft,
  path: string,
): FieldFactState {
  const provenance = provenanceFor(profile, path);
  const contradicted =
    profile.conflictingFields.some((entry) => overlaps(entry, path)) ||
    provenance?.derivation === "contradicted";
  if (contradicted) {
    return {
      state: "conflicting",
      label: "conflicting",
      confidence: provenance?.confidence ?? "unknown",
      limitation: provenance?.limitation ?? null,
      observedAt: provenance?.observedAt ?? null,
    };
  }
  if (profile.missingFields.some((entry) => overlaps(entry, path))) {
    return {
      state: "missing",
      label: "missing",
      confidence: "unknown",
      limitation: null,
      observedAt: null,
    };
  }
  if (provenance) {
    return {
      state: "supported",
      label: provenance.derivation,
      confidence: provenance.confidence,
      limitation: provenance.limitation,
      observedAt: provenance.observedAt,
    };
  }
  return {
    state: "unconfirmed",
    label: "unconfirmed",
    confidence: "unknown",
    limitation: null,
    observedAt: null,
  };
}

function hasText(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}

function supported(profile: ProductProfileDraft, paths: readonly string[]): boolean {
  return paths.every(
    (path) => getFieldFactState(profile, path).state === "supported",
  );
}

/** Every list field a primary ICP must fill before the profile can be confirmed. */
const PRIMARY_ICP_REQUIRED_LIST_FIELDS = [
  "buyerRoles",
  "userRoles",
  "useCases",
  "triggers",
  "pains",
  "jtbd",
] as const;

/**
 * Name the fields blocking the primary ICP, in the order the editor shows them.
 * Returns an empty list once every required field is filled; a complete list
 * still needs traceable provenance, which hasPrimaryIcp checks separately
 * because it is not something the customer fixes by typing.
 */
function primaryIcpMissingFieldKeys(
  audience: ProductProfileTargetAudience | null,
): readonly string[] {
  if (!audience) {
    return ["targetCompanyOrAudience", ...PRIMARY_ICP_REQUIRED_LIST_FIELDS];
  }
  const missing: string[] = [];
  if (!hasText(audience.targetCompanyOrAudience)) {
    missing.push("targetCompanyOrAudience");
  }
  for (const key of PRIMARY_ICP_REQUIRED_LIST_FIELDS) {
    if (audience[key].length === 0) missing.push(key);
  }
  return missing;
}

function hasPrimaryIcp(
  profile: ProductProfileDraft,
  audience: ProductProfileTargetAudience | null,
): boolean {
  if (primaryIcpMissingFieldKeys(audience).length > 0) return false;
  return supported(profile, ["/targetAudiences"]);
}

function confirmationItems(
  profile: ProductProfileDraft,
  primaryAudience: ProductProfileTargetAudience | null,
): readonly ConfirmationItem[] {
  const identityPaths = [
    "/productName",
    "/oneLiner",
    "/category",
    "/productType",
  ] as const;
  const identityValues = [
    profile.productName,
    profile.oneLiner,
    profile.category,
    profile.productType,
  ];
  const approvedCompetitorsValid = profile.competitorCandidates.every(
    (competitor) =>
      competitor.reviewStatus !== "approved" ||
      (competitor.relationship !== null && competitor.analysisScope.length > 0),
  );
  const competitorEvidence =
    profile.competitorCandidates.length > 0 &&
    supported(profile, ["/competitorCandidates"]);

  const icpMissingFieldKeys = primaryIcpMissingFieldKeys(primaryAudience);

  return [
    {
      id: "identity",
      complete:
        identityValues.every(hasText) && supported(profile, identityPaths),
      missingFieldKeys: [],
    },
    {
      id: "business",
      complete:
        profile.businessModels.length > 0 &&
        supported(profile, ["/businessModels"]),
      missingFieldKeys: [],
    },
    {
      id: "value",
      complete:
        hasText(profile.valueProposition) &&
        profile.coreFeatures.length > 0 &&
        supported(profile, ["/valueProposition", "/coreFeatures"]),
      missingFieldKeys: [],
    },
    {
      id: "markets",
      complete:
        profile.targetMarkets.filter((market) => market.priority === "primary")
          .length === 1 && supported(profile, ["/targetMarkets"]),
      missingFieldKeys: [],
    },
    {
      id: "primaryIcp",
      complete: hasPrimaryIcp(profile, primaryAudience),
      missingFieldKeys: icpMissingFieldKeys,
    },
    {
      id: "competitors",
      complete: approvedCompetitorsValid && competitorEvidence,
      missingFieldKeys: [],
    },
  ];
}

export function buildProductProfileViewModel(
  workspace: ProductProfileWorkspace,
): ProductProfileViewModel {
  const row = workspace.currentProfile ?? workspace.confirmedProfile;
  const profile = row?.profile ?? null;
  if (!row || !profile) {
    return {
      profileState: "missing",
      row: null,
      profile: null,
      primaryAudience: null,
      confirmation: { ready: false, items: [] },
      evidence: {
        sourcePageUrl: null,
        frozen: false,
        sourceSnapshotId: null,
        analysisInvocationId: null,
        generatedAt: null,
        provenanceCount: 0,
        missingCount: 0,
        conflictCount: 0,
      },
    };
  }

  const primaryAudience =
    profile.targetAudiences.find(
      (audience) => audience.reviewStatus === "primary",
    ) ??
    profile.targetAudiences.find(
      (audience) => audience.reviewStatus !== "excluded",
    ) ??
    null;
  const items = confirmationItems(profile, primaryAudience);
  const isDraft = row.status === "draft";
  const contractReady = ConfirmedProductProfile.safeParse(profile).success;
  return {
    profileState: isDraft ? "draft" : "confirmed",
    row,
    profile,
    primaryAudience,
    confirmation: {
      ready:
        isDraft &&
        workspace.activeSynthesisRun === null &&
        contractReady &&
        items.every((item) => item.complete),
      items,
    },
    evidence: {
      sourcePageUrl: profile.sourcePageUrl,
      frozen:
        profile.sourceSnapshotId !== null &&
        profile.analysisInvocationId !== null &&
        profile.generatedAt !== null,
      sourceSnapshotId: profile.sourceSnapshotId,
      analysisInvocationId: profile.analysisInvocationId,
      generatedAt: profile.generatedAt,
      provenanceCount: profile.fieldProvenance.length,
      missingCount: profile.missingFields.length,
      conflictCount: profile.conflictingFields.length,
    },
  };
}
