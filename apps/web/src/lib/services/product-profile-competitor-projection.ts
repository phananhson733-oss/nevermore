import type {
  ConfirmedProductProfile,
  ProductProfileFieldProvenance,
  ProductProfileProvenanceDerivation,
} from "@sf/contracts";
import { isProductProfileCompetitorIncludedByDefault } from "@sf/contracts";
import {
  CompetitorsRepository,
  type Executor,
  type ProductProfileCompetitorOriginInput,
  type ProductProfileEvidenceRef,
  type ProjectScope,
} from "@sf/db";
import { ProblemError } from "@sf/observability";

const TRACEABLE_DERIVATIONS = new Set<ProductProfileProvenanceDerivation>([
  "declared",
  "observed",
  "computed",
  "inferred",
]);

function isTraceableDerivation(
  derivation: ProductProfileProvenanceDerivation,
): boolean {
  return TRACEABLE_DERIVATIONS.has(derivation);
}

interface ConfirmedProfileIdentity {
  readonly id: string;
  readonly version: number;
}

function traceableCompetitorProvenance(
  profile: ConfirmedProductProfile,
  candidateIndex: number,
): ProductProfileFieldProvenance {
  const candidatePath = `/competitorCandidates/${candidateIndex}`;
  const exact = profile.fieldProvenance.find(
    (entry) => entry.path === candidatePath && isTraceableDerivation(entry.derivation),
  );
  if (exact) return exact;

  const pool = profile.fieldProvenance.find(
    (entry) =>
      entry.path === "/competitorCandidates" &&
      isTraceableDerivation(entry.derivation),
  );
  if (pool) return pool;

  throw new ProblemError(
    "VALIDATION_ERROR",
    `Product Profile competitor ${candidateIndex} has no exact traceable provenance.`,
  );
}

export function buildProductProfileCompetitorOriginInput(
  profileIdentity: ConfirmedProfileIdentity,
  profile: ConfirmedProductProfile,
  candidateIndex: number,
): ProductProfileCompetitorOriginInput {
  const candidate = profile.competitorCandidates[candidateIndex];
  if (!candidate) {
    throw new RangeError("candidateIndex must reference a retained competitor");
  }
  const provenance = traceableCompetitorProvenance(profile, candidateIndex);
  return {
    originKind: "product_profile",
    domain: candidate.domain,
    name: candidate.name,
    productProfileId: profileIdentity.id,
    profileVersion: profileIdentity.version,
    candidateId: candidate.candidateId,
    fieldProvenancePath: provenance.path,
    evidenceRefs: provenance.evidenceRefs as readonly ProductProfileEvidenceRef[],
    sourceReviewStatus: candidate.reviewStatus,
    sourceRelationship: candidate.relationship,
    sourceAnalysisScope: candidate.analysisScope,
  };
}

export async function projectConfirmedProductProfileCompetitors(
  tx: Executor,
  scope: ProjectScope,
  profileIdentity: ConfirmedProfileIdentity,
  profile: ConfirmedProductProfile,
): Promise<void> {
  if (profile.competitorCandidates.length === 0) return;
  const repository = new CompetitorsRepository(tx);
  for (let index = 0; index < profile.competitorCandidates.length; index += 1) {
    const candidate = profile.competitorCandidates[index]!;
    const origin = await repository.upsertOrigin(
      scope,
      buildProductProfileCompetitorOriginInput(profileIdentity, profile, index),
    );
    const included = isProductProfileCompetitorIncludedByDefault(candidate);
    await repository.applyProductProfileDefaultGovernance(
      scope,
      origin.competitorId,
      {
        name: candidate.name,
        reviewStatus: included
          ? "approved"
          : candidate.reviewStatus === "excluded"
            ? "excluded"
            : "candidate",
        relationship: included ? candidate.relationship : null,
        analysisScope: included ? candidate.analysisScope : [],
      },
    );
  }
}
