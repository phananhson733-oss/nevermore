import type {
  ProductProfileCompetitorAnalysisScope,
  ProductProfileCompetitorRelationship,
  ProductProfileCompetitorReviewStatus,
  ProductProfileDraft,
  ProductProfileTargetAudience,
  ProductProfileTargetMarket,
  UpdateProductProfileDraftRequest,
} from "@sf/contracts";

export const PRODUCT_TYPES = [
  "B2B SaaS",
  "B2C SaaS",
  "E-commerce",
  "Marketplace",
  "Professional Services",
  "Developer Tool",
  "Content / Media",
] as const;

export const BUSINESS_MODELS = [
  "Subscription",
  "Transaction",
  "Freemium",
  "Marketplace",
  "Services",
  "Advertising",
] as const;

export interface EditorState {
  readonly businessHint: string;
  readonly productName: string;
  readonly oneLiner: string;
  readonly category: string;
  readonly productType: string;
  readonly customProductType: string;
  readonly businessModels: readonly string[];
  readonly otherBusinessModels: string;
  readonly valueProposition: string;
  readonly coreFeatures: string;
  readonly primaryMarket: string;
  readonly secondaryMarkets: readonly string[];
  readonly primaryAudienceId: string;
  readonly targetCompanyOrAudience: string;
  readonly buyerRoles: string;
  readonly userRoles: string;
  readonly useCases: string;
  readonly triggers: string;
  readonly pains: string;
  readonly jtbd: string;
  readonly outcomes: string;
  readonly barriers: string;
  readonly qualificationSignals: string;
  readonly disqualifiers: string;
}

export function lines(value: string): string[] {
  return [
    ...new Set(
      value
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export function lineValue(value: readonly string[]): string {
  return value.join("\n");
}

export function audienceFields(
  audience: ProductProfileTargetAudience | null,
): Pick<
  EditorState,
  | "targetCompanyOrAudience"
  | "buyerRoles"
  | "userRoles"
  | "useCases"
  | "triggers"
  | "pains"
  | "jtbd"
  | "outcomes"
  | "barriers"
  | "qualificationSignals"
  | "disqualifiers"
> {
  return {
    targetCompanyOrAudience: audience?.targetCompanyOrAudience ?? "",
    buyerRoles: lineValue(audience?.buyerRoles ?? []),
    userRoles: lineValue(audience?.userRoles ?? []),
    useCases: lineValue(audience?.useCases ?? []),
    triggers: lineValue(audience?.triggers ?? []),
    pains: lineValue(audience?.pains ?? []),
    jtbd: lineValue(audience?.jtbd ?? []),
    outcomes: lineValue(audience?.outcomes ?? []),
    barriers: lineValue(audience?.barriers ?? []),
    qualificationSignals: lineValue(audience?.qualificationSignals ?? []),
    disqualifiers: lineValue(audience?.disqualifiers ?? []),
  };
}

export function initialEditorState(profile: ProductProfileDraft): EditorState {
  const primary =
    profile.targetAudiences.find(
      (audience) => audience.reviewStatus === "primary",
    ) ?? null;
  const knownModels = profile.businessModels.filter((model) =>
    BUSINESS_MODELS.includes(model as (typeof BUSINESS_MODELS)[number]),
  );
  const otherModels = profile.businessModels.filter(
    (model) =>
      !BUSINESS_MODELS.includes(model as (typeof BUSINESS_MODELS)[number]),
  );
  const knownProductType = PRODUCT_TYPES.includes(
    profile.productType as (typeof PRODUCT_TYPES)[number],
  );

  return {
    businessHint: profile.businessHint ?? "",
    productName: profile.productName ?? "",
    oneLiner: profile.oneLiner ?? "",
    category: profile.category ?? "",
    productType: knownProductType ? (profile.productType ?? "") : "__custom__",
    customProductType: knownProductType ? "" : (profile.productType ?? ""),
    businessModels: knownModels,
    otherBusinessModels: lineValue(otherModels),
    valueProposition: profile.valueProposition ?? "",
    coreFeatures: lineValue(profile.coreFeatures),
    primaryMarket:
      profile.targetMarkets.find((market) => market.priority === "primary")
        ?.marketCode ?? "",
    secondaryMarkets: profile.targetMarkets
      .filter((market) => market.priority === "secondary")
      .map((market) => market.marketCode),
    primaryAudienceId: primary?.candidateId ?? "",
    ...audienceFields(primary),
  };
}

function nullableText(value: string): string | null {
  return value.trim() || null;
}

function selectedProductType(state: EditorState): string | null {
  return nullableText(
    state.productType === "__custom__"
      ? state.customProductType
      : state.productType,
  );
}

function selectedBusinessModels(state: EditorState): string[] {
  return [
    ...new Set([
      ...state.businessModels,
      ...lines(state.otherBusinessModels),
    ]),
  ];
}

function buildMarkets(state: EditorState): ProductProfileTargetMarket[] {
  const markets: ProductProfileTargetMarket[] = [];
  if (state.primaryMarket) {
    markets.push({
      marketCode: state.primaryMarket,
      priority: "primary",
    });
  }
  for (const marketCode of state.secondaryMarkets) {
    if (marketCode !== state.primaryMarket) {
      markets.push({ marketCode, priority: "secondary" });
    }
  }
  return markets;
}

function buildPrimaryAudience(
  candidateId: string,
  state: EditorState,
): ProductProfileTargetAudience {
  return {
    candidateId,
    reviewStatus: "primary",
    targetCompanyOrAudience: nullableText(state.targetCompanyOrAudience),
    buyerRoles: lines(state.buyerRoles),
    userRoles: lines(state.userRoles),
    useCases: lines(state.useCases),
    triggers: lines(state.triggers),
    pains: lines(state.pains),
    jtbd: lines(state.jtbd),
    outcomes: lines(state.outcomes),
    barriers: lines(state.barriers),
    qualificationSignals: lines(state.qualificationSignals),
    disqualifiers: lines(state.disqualifiers),
  };
}

function buildAudiences(
  profile: ProductProfileDraft,
  state: EditorState,
): ProductProfileTargetAudience[] {
  let audiences = profile.targetAudiences.map((audience) =>
    audience.reviewStatus === "primary"
      ? { ...audience, reviewStatus: "secondary" as const }
      : audience,
  );

  if (!state.primaryAudienceId) return audiences;

  const selectedAudience =
    state.primaryAudienceId === "__new__"
      ? null
      : profile.targetAudiences.find(
          (audience) => audience.candidateId === state.primaryAudienceId,
        ) ?? null;
  const candidateId =
    selectedAudience?.candidateId ?? globalThis.crypto.randomUUID();
  const primary = buildPrimaryAudience(candidateId, state);

  audiences = selectedAudience
    ? audiences.map((audience) =>
        audience.candidateId === selectedAudience.candidateId
          ? primary
          : audience,
      )
    : [...audiences, primary];

  return audiences;
}

function stringSetSignature(values: readonly string[]): string {
  return JSON.stringify([...new Set(values)].sort());
}

function marketSignature(markets: readonly ProductProfileTargetMarket[]): string {
  return JSON.stringify(
    markets
      .map((market) => `${market.marketCode}:${market.priority}`)
      .sort(),
  );
}

function audienceSignature(
  audiences: readonly ProductProfileTargetAudience[],
): string {
  return JSON.stringify(
    audiences.map((audience) => ({
      candidateId: audience.candidateId,
      reviewStatus: audience.reviewStatus,
      targetCompanyOrAudience: audience.targetCompanyOrAudience,
      buyerRoles: audience.buyerRoles,
      userRoles: audience.userRoles,
      useCases: audience.useCases,
      triggers: audience.triggers,
      pains: audience.pains,
      jtbd: audience.jtbd,
      outcomes: audience.outcomes,
      barriers: audience.barriers,
      qualificationSignals: audience.qualificationSignals,
      disqualifiers: audience.disqualifiers,
    })),
  );
}

/**
 * Produces the narrowest contract-valid PATCH possible. Unchanged roots stay
 * absent so generated or observed provenance is never mislabeled as userEdit.
 */
export function buildEditorPatch(
  profile: ProductProfileDraft,
  state: EditorState,
): UpdateProductProfileDraftRequest["patch"] {
  const patch: UpdateProductProfileDraftRequest["patch"] = {};
  const businessHint = nullableText(state.businessHint);
  const productName = nullableText(state.productName);
  const oneLiner = nullableText(state.oneLiner);
  const category = nullableText(state.category);
  const productType = selectedProductType(state);
  const businessModels = selectedBusinessModels(state);
  const valueProposition = nullableText(state.valueProposition);
  const coreFeatures = lines(state.coreFeatures);
  const targetMarkets = buildMarkets(state);
  const targetAudiences = buildAudiences(profile, state);

  if (businessHint !== profile.businessHint) patch.businessHint = businessHint;
  if (productName !== profile.productName) patch.productName = productName;
  if (oneLiner !== profile.oneLiner) patch.oneLiner = oneLiner;
  if (category !== profile.category) patch.category = category;
  if (productType !== profile.productType) patch.productType = productType;
  if (
    stringSetSignature(businessModels) !==
    stringSetSignature(profile.businessModels)
  ) {
    patch.businessModels = businessModels;
  }
  if (valueProposition !== profile.valueProposition) {
    patch.valueProposition = valueProposition;
  }
  if (JSON.stringify(coreFeatures) !== JSON.stringify(profile.coreFeatures)) {
    patch.coreFeatures = coreFeatures;
  }
  if (marketSignature(targetMarkets) !== marketSignature(profile.targetMarkets)) {
    patch.targetMarkets = targetMarkets;
  }
  if (
    audienceSignature(targetAudiences) !==
    audienceSignature(profile.targetAudiences)
  ) {
    patch.targetAudiences = targetAudiences;
  }

  return patch;
}

/** Normalized form signature for a truthful unsaved-changes indicator. */
export function editorStateSignature(state: EditorState): string {
  return JSON.stringify({
    businessHint: nullableText(state.businessHint),
    productName: nullableText(state.productName),
    oneLiner: nullableText(state.oneLiner),
    category: nullableText(state.category),
    productType: selectedProductType(state),
    businessModels: [...selectedBusinessModels(state)].sort(),
    valueProposition: nullableText(state.valueProposition),
    coreFeatures: lines(state.coreFeatures),
    markets: buildMarkets(state)
      .map((market) => `${market.marketCode}:${market.priority}`)
      .sort(),
    primaryAudienceId: state.primaryAudienceId,
    primaryAudience:
      state.primaryAudienceId === ""
        ? null
        : {
            targetCompanyOrAudience: nullableText(
              state.targetCompanyOrAudience,
            ),
            buyerRoles: lines(state.buyerRoles),
            userRoles: lines(state.userRoles),
            useCases: lines(state.useCases),
            triggers: lines(state.triggers),
            pains: lines(state.pains),
            jtbd: lines(state.jtbd),
            outcomes: lines(state.outcomes),
            barriers: lines(state.barriers),
            qualificationSignals: lines(state.qualificationSignals),
            disqualifiers: lines(state.disqualifiers),
          },
  });
}

export function isCompetitorReviewReady(state: {
  readonly name: string;
  readonly domain: string;
  readonly reviewStatus: ProductProfileCompetitorReviewStatus;
  readonly relationship: ProductProfileCompetitorRelationship | "";
  readonly analysisScope: readonly ProductProfileCompetitorAnalysisScope[];
}): boolean {
  const hasIdentity =
    state.name.trim().length > 0 && state.domain.trim().length > 0;
  const hasApprovedClassification =
    state.relationship !== "" && state.analysisScope.length > 0;

  return (
    hasIdentity &&
    (state.reviewStatus !== "approved" || hasApprovedClassification)
  );
}
