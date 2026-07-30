// @input  -- V1.3 §11.6 Intent / Funnel / Buyer Journey
// @output -- BaseIntent / FunnelStage / BuyerJourneyStage / PageIntent + 双向映射
// @pos    -- types/ 拆分，KeywordUniverseItem.intent / KeywordCluster 共用

// =====================================================
// V1.3 §11.6 Intent / Funnel / Buyer Journey
// =====================================================

export const ALL_BASE_INTENTS = [
  "informational",
  "navigational",
  "commercial_investigation",
  "transactional",
  "problem_aware",
  "solution_aware",
  "competitor_aware",
] as const;
export type BaseIntent = (typeof ALL_BASE_INTENTS)[number];

export const ALL_FUNNEL_STAGES = ["TOFU", "MOFU", "BOFU"] as const;
export type FunnelStage = (typeof ALL_FUNNEL_STAGES)[number];

export const ALL_BUYER_JOURNEY_STAGES = [
  "awareness",
  "research",
  "shortlist",
  "evaluation",
  "procurement",
  "implementation",
  "expansion",
] as const;
export type BuyerJourneyStage = (typeof ALL_BUYER_JOURNEY_STAGES)[number];

export const ALL_PAGE_INTENTS = [
  "learn",
  "compare",
  "choose",
  "implement",
  "calculate",
  "migrate",
  "integrate",
  "buy",
] as const;
export type PageIntent = (typeof ALL_PAGE_INTENTS)[number];

// V1.3 §11.6 双向映射
export const FUNNEL_TO_JOURNEY: Record<
  FunnelStage,
  readonly BuyerJourneyStage[]
> = {
  TOFU: ["awareness", "research"],
  MOFU: ["shortlist", "evaluation"],
  BOFU: ["procurement", "implementation", "expansion"],
};

export const JOURNEY_TO_FUNNEL: Record<BuyerJourneyStage, FunnelStage> = {
  awareness: "TOFU",
  research: "TOFU",
  shortlist: "MOFU",
  evaluation: "MOFU",
  procurement: "BOFU",
  implementation: "BOFU",
  expansion: "BOFU",
};
