import {
  IsoDateTime,
  ProductProfileCompetitorDomain,
  ProductProfileDraft as ProductProfileDraftSchema,
  Uuid,
  type ProductProfileCompetitorCandidate,
  type ProductProfileDraft,
  type ProductProfileEvidenceRef,
  type ProductProfileFieldProvenance,
  type ProductProfileTargetAudience,
} from "@sf/contracts";
import {
  PRODUCT_PROFILE_SEMANTIC_PATHS,
  type ProductProfileSemanticCandidateEnvelope,
} from "./llm/product-profile-client.ts";

type SemanticPath = (typeof PRODUCT_PROFILE_SEMANTIC_PATHS)[number];
type Grounding = {
  readonly confidence: ProductProfileFieldProvenance["confidence"];
  readonly sourcePageKeys: readonly string[];
  readonly usesBusinessHint: boolean;
};

export interface BuildProductProfileDraftInput {
  readonly base: ProductProfileDraft;
  readonly candidate: ProductProfileSemanticCandidateEnvelope;
  readonly sourceSnapshotId: string;
  readonly analysisInvocationId: string;
  readonly generatedAt: string;
  readonly pageEvidence: Readonly<Record<string, string>>;
}

const PAGE_KEY_PATTERN = /^page-[1-9]\d*$/u;
const FNV1A_128_OFFSET_BASIS =
  0x6c62272e07bb014262b821756295c58dn;
const FNV1A_128_PRIME = 0x0000000001000000000000000000013bn;
const UINT128_MASK = (1n << 128n) - 1n;
const semanticPathSet = new Set<string>(PRODUCT_PROFILE_SEMANTIC_PATHS);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Runtime-portable deterministic UUIDv8 for semantic and evidence identity. */
function deterministicUuidV8(seed: string): string {
  let hash = FNV1A_128_OFFSET_BASIS;
  for (const byte of new TextEncoder().encode(seed)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV1A_128_PRIME) & UINT128_MASK;
  }

  const raw = hash.toString(16).padStart(32, "0");
  const withVersion = `${raw.slice(0, 12)}8${raw.slice(13)}`;
  const variant = (
    (Number.parseInt(withVersion[16]!, 16) & 0b0011) |
    0b1000
  ).toString(16);
  const uuid = `${withVersion.slice(0, 16)}${variant}${withVersion.slice(17)}`;
  return Uuid.parse(
    `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`,
  );
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort(compareText)
    .map(
      (key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`,
    )
    .join(",")}}`;
}

function isWithinPath(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}/`);
}

function hasUserEdit(entry: ProductProfileFieldProvenance): boolean {
  return entry.evidenceRefs.some((ref) => ref.kind === "userEdit");
}

function parsePageEvidence(
  value: Readonly<Record<string, string>>,
): ReadonlyMap<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("pageEvidence must be a record of page keys to UUIDs");
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("pageEvidence must be a plain record");
  }

  const result = new Map<string, string>();
  const pageSnapshotIds = new Set<string>();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !Object.prototype.propertyIsEnumerable.call(value, key)) {
      throw new TypeError("pageEvidence may contain only enumerable string keys");
    }
    if (key.length > 32 || !PAGE_KEY_PATTERN.test(key)) {
      throw new TypeError(`invalid page evidence key: ${key}`);
    }
    const pageSnapshotId = Uuid.parse(value[key]);
    if (pageSnapshotIds.has(pageSnapshotId)) {
      throw new TypeError("pageEvidence must map each key to a distinct page snapshot");
    }
    pageSnapshotIds.add(pageSnapshotId);
    result.set(key, pageSnapshotId);
  }
  return result;
}

function allGroundings(
  candidate: ProductProfileSemanticCandidateEnvelope,
): readonly {
  readonly present: boolean;
  readonly competitor: boolean;
  readonly grounding: Grounding;
}[] {
  const scalars = [
    candidate.productName,
    candidate.oneLiner,
    candidate.category,
    candidate.productType,
    candidate.valueProposition,
  ].map((grounding) => ({
    present: grounding.value !== null,
    competitor: false,
    grounding,
  }));
  return [
    ...scalars,
    ...candidate.businessModels.map((grounding) => ({
      present: true,
      competitor: false,
      grounding,
    })),
    ...candidate.coreFeatures.map((grounding) => ({
      present: true,
      competitor: false,
      grounding,
    })),
    ...candidate.targetMarkets.map((grounding) => ({
      present: true,
      competitor: false,
      grounding,
    })),
    ...candidate.targetAudiences.map((grounding) => ({
      present: true,
      competitor: false,
      grounding,
    })),
    ...candidate.competitorCandidates.map((grounding) => ({
      present: true,
      competitor: true,
      grounding,
    })),
    ...candidate.conflicts.map((grounding) => ({
      present: true,
      competitor: false,
      grounding,
    })),
  ];
}

function validateSemanticCandidate(
  candidate: ProductProfileSemanticCandidateEnvelope,
  businessHint: string | null,
  pageEvidence: ReadonlyMap<string, string>,
): void {
  const domains = new Set<string>();
  for (const competitor of candidate.competitorCandidates) {
    const domain = ProductProfileCompetitorDomain.parse(competitor.domain);
    if (domains.has(domain)) {
      throw new TypeError(`duplicate competitor domain: ${domain}`);
    }
    domains.add(domain);
  }

  const unknownPaths = new Set<string>();
  for (const path of candidate.unknownPaths) {
    if (!semanticPathSet.has(path)) {
      throw new TypeError(`unknown semantic path: ${path}`);
    }
    if (unknownPaths.has(path)) {
      throw new TypeError(`duplicate unknown semantic path: ${path}`);
    }
    unknownPaths.add(path);
  }

  const conflictPaths = new Set<string>();
  for (const conflict of candidate.conflicts) {
    if (!semanticPathSet.has(conflict.path)) {
      throw new TypeError(`unknown conflict path: ${conflict.path}`);
    }
    if (conflictPaths.has(conflict.path)) {
      throw new TypeError(`duplicate conflict path: ${conflict.path}`);
    }
    if (unknownPaths.has(conflict.path)) {
      throw new TypeError(
        `semantic path cannot be both unknown and conflicting: ${conflict.path}`,
      );
    }
    conflictPaths.add(conflict.path);
  }

  for (const { present, competitor, grounding } of allGroundings(candidate)) {
    const sourceKeys = new Set<string>();
    for (const pageKey of grounding.sourcePageKeys) {
      if (sourceKeys.has(pageKey)) {
        throw new TypeError(`duplicate source page key: ${pageKey}`);
      }
      sourceKeys.add(pageKey);
      if (!pageEvidence.has(pageKey)) {
        throw new TypeError(`unknown page evidence key: ${pageKey}`);
      }
    }

    if (!present) {
      if (
        grounding.confidence !== "unknown" ||
        grounding.sourcePageKeys.length > 0 ||
        grounding.usesBusinessHint
      ) {
        throw new TypeError("empty semantic values cannot claim grounding");
      }
      continue;
    }
    if (grounding.confidence === "unknown") {
      throw new TypeError("nonempty semantic values require known confidence");
    }
    if (
      grounding.sourcePageKeys.length === 0 &&
      !grounding.usesBusinessHint
    ) {
      throw new TypeError("nonempty semantic values require evidence grounding");
    }
    if (grounding.usesBusinessHint && businessHint === null) {
      throw new TypeError("semantic value cites an unavailable business hint");
    }
    if (competitor && grounding.sourcePageKeys.length === 0) {
      throw new TypeError("competitor candidates require page evidence");
    }
  }
}

function evidenceRefId(path: string, kind: string, anchor: string): string {
  return deterministicUuidV8(
    stableStringify(["product-profile-evidence.0.3.0", path, kind, anchor]),
  );
}

function evidenceRefsFor(
  path: string,
  grounding: Grounding,
  analysisInvocationId: string,
  businessHint: string | null,
  pageEvidence: ReadonlyMap<string, string>,
): ProductProfileEvidenceRef[] {
  const refs: ProductProfileEvidenceRef[] = [
    {
      evidenceRefId: evidenceRefId(
        path,
        "analysisInvocation",
        analysisInvocationId,
      ),
      kind: "analysisInvocation",
      analysisInvocationId,
    },
  ];
  const pageSnapshotIds = [
    ...new Set(
      grounding.sourcePageKeys.map((pageKey) => pageEvidence.get(pageKey)!),
    ),
  ].sort(compareText);
  for (const pageSnapshotId of pageSnapshotIds) {
    refs.push({
      evidenceRefId: evidenceRefId(path, "pageSnapshot", pageSnapshotId),
      kind: "pageSnapshot",
      pageSnapshotId,
    });
  }
  if (grounding.usesBusinessHint) {
    refs.push({
      evidenceRefId: evidenceRefId(path, "declaredHint", businessHint!),
      kind: "declaredHint",
    });
  }
  return refs;
}

function generatedProvenance(
  path: string,
  grounding: Grounding,
  analysisInvocationId: string,
  generatedAt: string,
  businessHint: string | null,
  pageEvidence: ReadonlyMap<string, string>,
): ProductProfileFieldProvenance {
  return {
    path,
    derivation: "inferred",
    confidence: grounding.confidence,
    evidenceRefs: evidenceRefsFor(
      path,
      grounding,
      analysisInvocationId,
      businessHint,
      pageEvidence,
    ),
    limitation: null,
    observedAt: generatedAt,
  };
}

function sortedUniqueStrings<T extends string>(values: readonly T[]): T[] {
  return [...values].sort(compareText);
}

function audienceValue(
  audience: ProductProfileSemanticCandidateEnvelope["targetAudiences"][number],
): Omit<ProductProfileTargetAudience, "candidateId" | "reviewStatus"> {
  return {
    targetCompanyOrAudience: audience.targetCompanyOrAudience,
    buyerRoles: sortedUniqueStrings(audience.buyerRoles),
    userRoles: sortedUniqueStrings(audience.userRoles),
    useCases: sortedUniqueStrings(audience.useCases),
    triggers: sortedUniqueStrings(audience.triggers),
    pains: sortedUniqueStrings(audience.pains),
    jtbd: sortedUniqueStrings(audience.jtbd),
    outcomes: sortedUniqueStrings(audience.outcomes),
    barriers: sortedUniqueStrings(audience.barriers),
    qualificationSignals: sortedUniqueStrings(audience.qualificationSignals),
    disqualifiers: sortedUniqueStrings(audience.disqualifiers),
  };
}

function remapCompetitorProvenance(
  entry: ProductProfileFieldProvenance,
  previousIndex: number,
  nextIndex: number,
): ProductProfileFieldProvenance {
  const previousPrefix = `/competitorCandidates/${previousIndex}`;
  const nextPrefix = `/competitorCandidates/${nextIndex}`;
  return {
    ...entry,
    path: `${nextPrefix}${entry.path.slice(previousPrefix.length)}`,
  };
}

function dedupeEvidenceRefs(
  refs: readonly ProductProfileEvidenceRef[],
): ProductProfileEvidenceRef[] {
  const byId = new Map<string, ProductProfileEvidenceRef>();
  for (const ref of refs) byId.set(ref.evidenceRefId, ref);
  return [...byId.values()];
}

/**
 * Convert a bounded semantic LLM result into the canonical, append-only
 * Product Profile draft shape. Durable IDs and all provenance are authored by
 * this server-side boundary rather than accepted from the model.
 */
export function buildProductProfileDraft(
  input: BuildProductProfileDraftInput,
): ProductProfileDraft {
  const base = ProductProfileDraftSchema.parse(input.base);
  const sourceSnapshotId = Uuid.parse(input.sourceSnapshotId);
  const analysisInvocationId = Uuid.parse(input.analysisInvocationId);
  const generatedAt = IsoDateTime.parse(input.generatedAt);
  const pageEvidence = parsePageEvidence(input.pageEvidence);
  validateSemanticCandidate(input.candidate, base.businessHint, pageEvidence);

  const provenance = new Map<string, ProductProfileFieldProvenance>();
  const businessHintProvenance = base.fieldProvenance.find(
    (entry) => entry.path === "/businessHint",
  );
  if (businessHintProvenance) {
    provenance.set(businessHintProvenance.path, businessHintProvenance);
  }

  const isCustomerProtected = (path: SemanticPath): boolean =>
    base.fieldProvenance.some(
      (entry) => isWithinPath(entry.path, path) && hasUserEdit(entry),
    );
  const preserveSubtreeProvenance = (path: SemanticPath): void => {
    for (const entry of base.fieldProvenance) {
      if (isWithinPath(entry.path, path)) provenance.set(entry.path, entry);
    }
  };
  const infer = (path: string, grounding: Grounding): void => {
    provenance.set(
      path,
      generatedProvenance(
        path,
        grounding,
        analysisInvocationId,
        generatedAt,
        base.businessHint,
        pageEvidence,
      ),
    );
  };

  const scalar = <K extends
    | "productName"
    | "oneLiner"
    | "category"
    | "productType"
    | "valueProposition">(
    key: K,
    path: Extract<SemanticPath, `/${K}`>,
  ): ProductProfileDraft[K] => {
    if (isCustomerProtected(path)) {
      preserveSubtreeProvenance(path);
      return base[key];
    }
    const conclusion = input.candidate[key];
    if (conclusion.value !== null) infer(path, conclusion);
    return conclusion.value;
  };

  const productName = scalar("productName", "/productName");
  const oneLiner = scalar("oneLiner", "/oneLiner");
  const category = scalar("category", "/category");
  const productType = scalar("productType", "/productType");
  const valueProposition = scalar(
    "valueProposition",
    "/valueProposition",
  );

  let businessModels: string[];
  if (isCustomerProtected("/businessModels")) {
    businessModels = [...base.businessModels];
    preserveSubtreeProvenance("/businessModels");
  } else {
    const conclusions = [...input.candidate.businessModels].sort((left, right) =>
      compareText(left.value, right.value),
    );
    businessModels = conclusions.map((entry) => entry.value);
    conclusions.forEach((entry, index) =>
      infer(`/businessModels/${index}`, entry),
    );
  }

  let coreFeatures: string[];
  if (isCustomerProtected("/coreFeatures")) {
    coreFeatures = [...base.coreFeatures];
    preserveSubtreeProvenance("/coreFeatures");
  } else {
    const conclusions = [...input.candidate.coreFeatures].sort((left, right) =>
      compareText(left.value, right.value),
    );
    coreFeatures = conclusions.map((entry) => entry.value);
    conclusions.forEach((entry, index) =>
      infer(`/coreFeatures/${index}`, entry),
    );
  }

  let targetMarkets: ProductProfileDraft["targetMarkets"];
  if (isCustomerProtected("/targetMarkets")) {
    targetMarkets = [...base.targetMarkets];
    preserveSubtreeProvenance("/targetMarkets");
  } else {
    const conclusions = [...input.candidate.targetMarkets].sort(
      (left, right) =>
        compareText(left.priority, right.priority) ||
        compareText(left.marketCode, right.marketCode),
    );
    targetMarkets = conclusions.map(({ marketCode, priority }) => ({
      marketCode,
      priority,
    }));
    conclusions.forEach((entry, index) =>
      infer(`/targetMarkets/${index}`, entry),
    );
  }

  let targetAudiences: ProductProfileTargetAudience[];
  if (isCustomerProtected("/targetAudiences")) {
    targetAudiences = [...base.targetAudiences];
    preserveSubtreeProvenance("/targetAudiences");
  } else {
    const conclusions = input.candidate.targetAudiences
      .map((grounding) => ({
        grounding,
        value: audienceValue(grounding),
      }))
      .sort((left, right) =>
        compareText(stableStringify(left.value), stableStringify(right.value)),
      );
    targetAudiences = conclusions.map(({ value }, index) => ({
      candidateId: deterministicUuidV8(
        stableStringify([
          "product-profile-audience.0.3.0",
          stableStringify(value),
          index,
        ]),
      ),
      reviewStatus: "candidate",
      ...value,
    }));
    conclusions.forEach(({ grounding }, index) =>
      infer(`/targetAudiences/${index}`, grounding),
    );
  }

  const preserveAllCompetitors = base.fieldProvenance.some(
    (entry) => entry.path === "/competitorCandidates" && hasUserEdit(entry),
  );
  if (preserveAllCompetitors) {
    const topLevel = base.fieldProvenance.find(
      (entry) => entry.path === "/competitorCandidates",
    );
    if (topLevel) provenance.set(topLevel.path, topLevel);
  }
  const competitorCandidates: ProductProfileCompetitorCandidate[] = [];
  const preservedDomains = new Set<string>();
  base.competitorCandidates.forEach((competitor, previousIndex) => {
    const prefix = `/competitorCandidates/${previousIndex}`;
    const customerAuthored = base.fieldProvenance.some(
      (entry) => isWithinPath(entry.path, prefix) && hasUserEdit(entry),
    );
    const preserve =
      preserveAllCompetitors ||
      customerAuthored ||
      competitor.reviewStatus === "approved" ||
      competitor.reviewStatus === "excluded";
    if (!preserve) return;
    if (preservedDomains.has(competitor.domain)) {
      throw new TypeError(
        `duplicate preserved competitor domain: ${competitor.domain}`,
      );
    }
    preservedDomains.add(competitor.domain);
    const nextIndex = competitorCandidates.length;
    competitorCandidates.push(competitor);
    for (const entry of base.fieldProvenance) {
      if (isWithinPath(entry.path, prefix)) {
        const remapped = remapCompetitorProvenance(
          entry,
          previousIndex,
          nextIndex,
        );
        provenance.set(remapped.path, remapped);
      }
    }
  });

  const generatedCompetitors = [...input.candidate.competitorCandidates]
    .sort((left, right) => compareText(left.domain, right.domain))
    .filter((candidate) => !preservedDomains.has(candidate.domain));
  for (const candidate of generatedCompetitors) {
    const index = competitorCandidates.length;
    competitorCandidates.push({
      candidateId: deterministicUuidV8(
        stableStringify([
          "product-profile-competitor.0.3.0",
          candidate.domain,
        ]),
      ),
      name: candidate.name,
      domain: candidate.domain,
      relationship: candidate.relationship,
      analysisScope: sortedUniqueStrings(candidate.analysisScope),
      similarity: candidate.similarity,
      reason: candidate.reason,
      reviewStatus: "candidate",
      confidence: candidate.confidence,
    });
    infer(`/competitorCandidates/${index}`, candidate);
  }

  const conflicts = [...input.candidate.conflicts].sort((left, right) =>
    compareText(left.path, right.path),
  );
  for (const conflict of conflicts) {
    const existing = provenance.get(conflict.path);
    const conflictRefs = evidenceRefsFor(
      conflict.path,
      conflict,
      analysisInvocationId,
      base.businessHint,
      pageEvidence,
    );
    provenance.set(conflict.path, {
      path: conflict.path,
      derivation: "contradicted",
      confidence: conflict.confidence,
      evidenceRefs: dedupeEvidenceRefs([
        ...(existing?.evidenceRefs ?? []),
        ...conflictRefs,
      ]),
      limitation: conflict.explanation,
      observedAt: generatedAt,
    });
  }

  const semanticValues: Readonly<Record<SemanticPath, unknown>> = {
    "/productName": productName,
    "/oneLiner": oneLiner,
    "/category": category,
    "/productType": productType,
    "/businessModels": businessModels,
    "/valueProposition": valueProposition,
    "/coreFeatures": coreFeatures,
    "/targetMarkets": targetMarkets,
    "/targetAudiences": targetAudiences,
    "/competitorCandidates": competitorCandidates,
  };
  const isMissing = (path: SemanticPath): boolean => {
    const value = semanticValues[path];
    return value === null || (Array.isArray(value) && value.length === 0);
  };
  const conflictingFields = conflicts.map((conflict) => conflict.path);
  const conflictingSet = new Set<string>(conflictingFields);
  const missingFields = new Set<string>();
  for (const path of PRODUCT_PROFILE_SEMANTIC_PATHS) {
    if (isMissing(path)) missingFields.add(path);
  }
  for (const path of input.candidate.unknownPaths) {
    if (isMissing(path)) missingFields.add(path);
  }
  for (const path of conflictingSet) missingFields.delete(path);

  return ProductProfileDraftSchema.parse({
    profileSchemaVersion: base.profileSchemaVersion,
    sourceSiteId: base.sourceSiteId,
    sourcePageUrl: base.sourcePageUrl,
    sourceSnapshotId,
    analysisInvocationId,
    generatedAt,
    businessHint: base.businessHint,
    productName,
    oneLiner,
    category,
    productType,
    businessModels,
    valueProposition,
    coreFeatures,
    targetMarkets,
    targetAudiences,
    competitorCandidates,
    fieldProvenance: [...provenance.values()].sort((left, right) =>
      compareText(left.path, right.path),
    ),
    missingFields: [...missingFields].sort(compareText),
    conflictingFields: [...new Set(conflictingFields)].sort(compareText),
  });
}
