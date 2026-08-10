import { z } from "zod";
import { IsoDateTime, MarketCode, Uuid } from "./common.ts";

const Revision = z.number().int().nonnegative().max(2_147_483_647);
const IncrementableRevision = Revision.max(2_147_483_646);
const PositiveRevision = z.number().int().positive().max(2_147_483_647);
const Label = z.string().trim().min(1).max(500);
const ShortLabel = z.string().trim().min(1).max(100);
const Text = z.string().trim().min(1).max(2_000);
const SuggestionReason = z.string().trim().min(3).max(2_000);
const Hash = z.string().regex(/^[0-9a-f]{64}$/u);
const KeywordStatus = z.enum(["candidate", "approved", "excluded", "parked"]);
const MappingDecision = z.enum(["unassigned", "existing_page", "new_asset"]);
const CanonicalIntent = z.enum([
  "informational",
  "navigational",
  "commercial",
  "transactional",
]);
const unique = (values: readonly string[]) => new Set(values).size === values.length;

export const KEYWORD_GOVERNANCE_SUGGESTION_MANIFEST_FIELDS = [
  "schemaVersion", "generationVersion", "promptSetVersion", "workspaceId", "projectId",
  "marketCode", "languageTag", "confirmedProductProfile", "confirmedTopicModel",
  "topicAllowlist", "pageAllowlist", "candidates",
] as const;

export const KeywordGovernanceSuggestionVersion = z.literal(
  "keyword-governance-suggestion.v1",
);
export type KeywordGovernanceSuggestionVersion = z.infer<
  typeof KeywordGovernanceSuggestionVersion
>;

export const KeywordGovernanceSuggestionState = z.enum([
  "generating",
  "pending_ready",
  "pending_needs_review",
  "stale",
  "unavailable",
]);
export type KeywordGovernanceSuggestionState = z.infer<
  typeof KeywordGovernanceSuggestionState
>;

const Candidate = z.object({
  ordinal: z.number().int().positive().max(100),
  keywordKey: z.string().regex(/^keyword-[a-z0-9-]+$/u),
  keywordId: Uuid,
  queryKind: z.literal("search_query"),
  expectedGovernanceRevision: IncrementableRevision,
  displayKeyword: Label,
  normalizedKeyword: Label,
  deterministicEvidence: z.object({
    sourceOccurrenceIds: z.array(Uuid).min(1).max(100).refine(unique),
    providerSearchIntent: z.object({
      value: CanonicalIntent,
      snapshotId: Uuid,
      observationId: Uuid,
      observedAt: IsoDateTime,
    }).strict().nullable(),
    currentTopicKey: z.string().regex(/^topic-[a-z0-9-]+$/u).nullable(),
    currentPageKey: z.string().regex(/^page-[a-z0-9-]+$/u).nullable(),
  }).strict(),
}).strict();

export const KeywordGovernanceSuggestionInputManifest = z.object({
  schemaVersion: z.literal("keyword-governance-suggestion-input.v1"),
  generationVersion: z.literal("keyword-governance-suggestion-generation.v1"),
  promptSetVersion: z.literal("keyword-governance-suggestion.prompt.v1"),
  workspaceId: Uuid,
  projectId: Uuid,
  marketCode: MarketCode,
  languageTag: z.string().trim().min(2).max(35),
  confirmedProductProfile: z.object({
    productProfileId: Uuid, version: PositiveRevision, contentHash: Hash,
    facts: z.object({
      productName: Label, category: Label, valueProposition: Text,
      targetAudience: Text, buyerRoles: z.array(Label).max(100), pains: z.array(Label).max(100), outcomes: z.array(Label).max(100),
    }).strict(),
  }).strict(),
  confirmedTopicModel: z.object({ topicModelRevisionId: Uuid, revision: PositiveRevision, contentHash: Hash }).strict(),
  topicAllowlist: z.array(z.object({ topicKey: z.string().regex(/^topic-[a-z0-9-]+$/u), topicNodeId: Uuid, topicModelRevision: PositiveRevision, label: Label }).strict()).max(100).refine((items) => unique(items.map((item) => item.topicKey))),
  pageAllowlist: z.array(z.object({ pageKey: z.string().regex(/^page-[a-z0-9-]+$/u), sitePageId: Uuid, normalizedUrl: z.string().url().max(2048), title: Label }).strict()).max(100).refine((items) => unique(items.map((item) => item.pageKey))),
  candidates: z.array(Candidate).min(1).max(100),
}).strict().superRefine((manifest, ctx) => {
  const topicKeys = new Set(manifest.topicAllowlist.map((item) => item.topicKey));
  const pageKeys = new Set(manifest.pageAllowlist.map((item) => item.pageKey));
  const keys = new Set<string>();
  manifest.candidates.forEach((candidate, index) => {
    if (candidate.ordinal !== index + 1 || keys.has(candidate.keywordKey)) ctx.addIssue({ code: "custom", path: ["candidates", index], message: "Candidates must have unique, contiguous ordinals and keys" });
    keys.add(candidate.keywordKey);
    if (candidate.deterministicEvidence.currentTopicKey !== null && !topicKeys.has(candidate.deterministicEvidence.currentTopicKey)) ctx.addIssue({ code: "custom", path: ["candidates", index, "deterministicEvidence", "currentTopicKey"], message: "Current Topic key must resolve from the frozen allowlist" });
    if (candidate.deterministicEvidence.currentPageKey !== null && !pageKeys.has(candidate.deterministicEvidence.currentPageKey)) ctx.addIssue({ code: "custom", path: ["candidates", index, "deterministicEvidence", "currentPageKey"], message: "Current Page key must resolve from the frozen allowlist" });
  });
});
export type KeywordGovernanceSuggestionInputManifest = z.infer<typeof KeywordGovernanceSuggestionInputManifest>;

const StructuredSuggestion = z.object({
  keywordKey: z.string().regex(/^keyword-[a-z0-9-]+$/u), status: KeywordStatus,
  intent: CanonicalIntent.nullable(), buyerStage: ShortLabel.nullable(),
  topicKey: z.string().regex(/^topic-[a-z0-9-]+$/u).nullable(),
  mappingDecision: MappingDecision, pageKey: z.string().regex(/^page-[a-z0-9-]+$/u).nullable(), reason: SuggestionReason,
}).strict().superRefine((item, ctx) => {
  if ((item.mappingDecision === "existing_page") !== (item.pageKey !== null)) ctx.addIssue({ code: "custom", path: ["pageKey"], message: "Existing Page requires exactly one prompt-local Page key" });
  if (item.mappingDecision !== "unassigned" && item.topicKey === null) ctx.addIssue({ code: "custom", path: ["topicKey"], message: "A mapped suggestion requires exactly one prompt-local Topic key" });
  if (item.status === "excluded" && (item.topicKey !== null || item.pageKey !== null || item.mappingDecision !== "unassigned")) ctx.addIssue({ code: "custom", path: ["status"], message: "Excluded Keywords must not retain a Topic or Page assignment" });
});
export const KeywordGovernanceSuggestionStructuredOutput = z.object({ schemaVersion: z.literal("keyword-governance-suggestion-output.v1"), suggestions: z.array(StructuredSuggestion).min(1).max(100) }).strict();
export type KeywordGovernanceSuggestionStructuredOutput = z.infer<typeof KeywordGovernanceSuggestionStructuredOutput>;
export function parseKeywordGovernanceSuggestionStructuredOutput(value: unknown, manifestInput: unknown): KeywordGovernanceSuggestionStructuredOutput {
  const manifest = KeywordGovernanceSuggestionInputManifest.parse(manifestInput);
  const output = KeywordGovernanceSuggestionStructuredOutput.parse(value);
  const keywords = new Set(manifest.candidates.map((candidate) => candidate.keywordKey));
  const topics = new Set(manifest.topicAllowlist.map((item) => item.topicKey));
  const pages = new Set(manifest.pageAllowlist.map((item) => item.pageKey));
  if (output.suggestions.length !== keywords.size) throw new Error("Structured output must cover every frozen candidate exactly once");
  const seen = new Set<string>();
  for (const item of output.suggestions) {
    if (!keywords.has(item.keywordKey) || seen.has(item.keywordKey)) throw new Error("Structured output contains an unresolved or duplicate Keyword key");
    if (item.topicKey !== null && !topics.has(item.topicKey)) throw new Error("Structured output contains an unresolved Topic key");
    if (item.pageKey !== null && !pages.has(item.pageKey)) throw new Error("Structured output contains an unresolved Page key");
    const candidate = manifest.candidates.find((entry) => entry.keywordKey === item.keywordKey);
    if (candidate?.deterministicEvidence.providerSearchIntent !== null && item.intent !== null) throw new Error("Provider search intent is frozen authority and cannot be overridden by the model");
    seen.add(item.keywordKey);
  }
  return output;
}

const LlmLineage = z.object({ generationVersion: z.literal("keyword-governance-suggestion-generation.v1"), promptSetVersion: z.literal("keyword-governance-suggestion.prompt.v1"), authority: z.literal("llm_generated"), analysisInvocationId: Uuid }).strict();
const IntentLineage = z.discriminatedUnion("authority", [
  z.object({ authority: z.literal("provider_observed"), snapshotId: Uuid, observationId: Uuid, analysisInvocationId: z.null(), observedAt: IsoDateTime }).strict(),
  z.object({ authority: z.literal("llm_generated"), snapshotId: z.null(), observationId: z.null(), analysisInvocationId: Uuid, observedAt: z.null() }).strict(),
  z.object({ authority: z.literal("unavailable"), snapshotId: z.null(), observationId: z.null(), analysisInvocationId: z.null(), observedAt: z.null() }).strict(),
]);
export const KeywordGovernancePendingSuggestion = z.object({
  suggestionId: Uuid, suggestionVersion: KeywordGovernanceSuggestionVersion, state: KeywordGovernanceSuggestionState,
  expectedGovernanceRevision: IncrementableRevision, status: KeywordStatus.nullable(), intent: CanonicalIntent.nullable(), buyerStage: ShortLabel.nullable(),
  topicNodeId: Uuid.nullable(), topicModelRevision: PositiveRevision.nullable(), topicLabel: Label.nullable(), mappingDecision: MappingDecision.nullable(),
  mappedSitePageId: Uuid.nullable(), mappedSitePageTitle: Label.nullable(), reason: SuggestionReason.nullable(),
  readinessReason: z.enum(["all_authorities_confirmed", "generation_in_progress", "insufficient_authority", "governance_revision_changed", "authority_unavailable"]), limitation: Text.nullable(),
  lineage: LlmLineage.nullable(), intentLineage: IntentLineage.nullable(), createdAt: IsoDateTime,
}).strict().superRefine((item, ctx) => {
  const ready = item.state === "pending_ready";
  const readinessByState = {
    pending_ready: "all_authorities_confirmed",
    generating: "generation_in_progress",
    pending_needs_review: "insufficient_authority",
    stale: "governance_revision_changed",
    unavailable: "authority_unavailable",
  } as const;
  const empty = item.status === null && item.intent === null && item.buyerStage === null && item.topicNodeId === null && item.topicModelRevision === null && item.topicLabel === null && item.mappingDecision === null && item.mappedSitePageId === null && item.mappedSitePageTitle === null && item.reason === null && item.lineage === null && item.intentLineage === null;
  if (ready && (item.limitation !== null || item.lineage === null || item.intentLineage === null || item.status === null || item.mappingDecision === null || item.reason === null)) ctx.addIssue({ code: "custom", path: ["state"], message: "A ready suggestion requires complete generated governance and provenance" });
  if (item.readinessReason !== readinessByState[item.state]) ctx.addIssue({ code: "custom", path: ["readinessReason"], message: "State and readinessReason must remain the documented deterministic pair" });
  if (!ready && item.limitation === null) ctx.addIssue({ code: "custom", path: ["limitation"], message: "A non-ready suggestion requires an explicit limitation" });
  if ((item.topicNodeId === null) !== (item.topicModelRevision === null) || (item.topicNodeId === null) !== (item.topicLabel === null)) ctx.addIssue({ code: "custom", path: ["topicNodeId"], message: "Suggested Topic identity, revision, and label must agree" });
  if (item.mappingDecision !== null && item.mappingDecision !== "unassigned" && item.topicNodeId === null) ctx.addIssue({ code: "custom", path: ["topicNodeId"], message: "A mapped suggestion requires complete Topic identity" });
  if ((item.mappedSitePageId === null) !== (item.mappedSitePageTitle === null) || (item.mappingDecision === "existing_page") !== (item.mappedSitePageId !== null)) ctx.addIssue({ code: "custom", path: ["mappedSitePageId"], message: "Suggested Page identity and mapping decision must agree" });
  if (item.status === "excluded" && (item.topicNodeId !== null || item.topicModelRevision !== null || item.topicLabel !== null || item.mappingDecision !== "unassigned" || item.mappedSitePageId !== null || item.mappedSitePageTitle !== null)) ctx.addIssue({ code: "custom", path: ["status"], message: "An excluded suggestion must not retain a Topic or Page assignment" });
  if (!ready && !empty && item.state === "generating") ctx.addIssue({ code: "custom", path: ["state"], message: "Generating suggestions cannot expose partial governance" });
});
export type KeywordGovernancePendingSuggestion = z.infer<typeof KeywordGovernancePendingSuggestion>;
export const ApproveKeywordReviewSuggestionRequest = z.object({ expectedGovernanceRevision: IncrementableRevision, suggestionVersion: KeywordGovernanceSuggestionVersion }).strict();
export type ApproveKeywordReviewSuggestionRequest = z.infer<typeof ApproveKeywordReviewSuggestionRequest>;

// Compatibility names retained for consumers during the contract split.
export const KeywordGovernanceSuggestion = KeywordGovernancePendingSuggestion;
export type KeywordGovernanceSuggestion = KeywordGovernancePendingSuggestion;
export const ApproveKeywordGovernanceSuggestionRequest = ApproveKeywordReviewSuggestionRequest;
export type ApproveKeywordGovernanceSuggestionRequest = ApproveKeywordReviewSuggestionRequest;
