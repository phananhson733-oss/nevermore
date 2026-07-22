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

function hasPrimaryIcp(
  profile: ProductProfileDraft,
  audience: ProductProfileTargetAudience | null,
): boolean {
  if (!audience || !hasText(audience.targetCompanyOrAudience)) return false;
  if (
    [
      audience.buyerRoles,
      audience.userRoles,
      audience.useCases,
      audience.triggers,
      audience.pains,
      audience.jtbd,
    ].some((values) => values.length === 0)
  ) {
    return false;
  }
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
    profile.competitorCandidates.length === 0 ||
    supported(profile, ["/competitorCandidates"]);

  return [
    {
      id: "identity",
      complete:
        identityValues.every(hasText) && supported(profile, identityPaths),
    },
    {
      id: "business",
      complete:
        profile.businessModels.length > 0 &&
        supported(profile, ["/businessModels"]),
    },
    {
      id: "value",
      complete:
        hasText(profile.valueProposition) &&
        profile.coreFeatures.length > 0 &&
        supported(profile, ["/valueProposition", "/coreFeatures"]),
    },
    {
      id: "markets",
      complete:
        profile.targetMarkets.filter((market) => market.priority === "primary")
          .length === 1 && supported(profile, ["/targetMarkets"]),
    },
    {
      id: "primaryIcp",
      complete: hasPrimaryIcp(profile, primaryAudience),
    },
    {
      id: "competitors",
      complete: approvedCompetitorsValid && competitorEvidence,
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
    ) ?? null;
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
