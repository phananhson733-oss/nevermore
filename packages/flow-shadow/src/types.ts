/**
 * Pure contracts for the pinned Content Shadow Flow adapter (Slice 2).
 *
 * Everything in this package is deterministic and I/O-free: no clock,
 * randomness, network, filesystem, database, or runtime import of the sibling
 * `gengrowth-flow-mvp` repository (Slice 2 red line D). Host ownership is
 * exact-host and dependency-free. The adapter's job is scaffolding +
 * verification, not generation: the English draft itself is minted by the
 * pinned markdown LLM envelope in `@sf/artifacts` (Slice 2 decision D1).
 */

/**
 * The immutable tuple a Content Shadow run pins. `content_hash` is INPUT
 * addressing over this tuple (Slice 2 red line C) — exactly like
 * `audit_runs`/`diagnostic_runs` frozen inputs. It is deliberately NOT a
 * byte-hash of the model's output: "reproducible" means the run is a
 * well-defined, auditable function of frozen inputs plus a pinned adapter and
 * prompt-set version, not that an LLM emits identical bytes.
 */
/**
 * The cluster's aggregated existing-page decision. Four values, because one
 * cluster's keywords can legitimately disagree and `mixed` / `unassigned` are
 * the honest answers (decision O-3).
 */
export type ContentShadowPageAssignment =
  | "existing_page"
  | "new_asset"
  | "mixed"
  | "unassigned";

/**
 * The structured extraction of the pinned `content_brief` revision that makes
 * the draft a CHILD of the brief instead of its sibling (Slice 2 Task 4b).
 *
 * Declared here as a pure structural type — this package never imports
 * `@sf/artifacts` (or anything else at runtime); `@sf/artifacts` owns the
 * extractor, this package only carries the value through the frozen tuple.
 *
 * `briefSections` is a COVERAGE CHECKLIST, not a document structure: the draft's
 * structure stays the fixed `CONTENT_SHADOW_OUTLINE` scaffold (decision O-6).
 */
export interface ContentShadowBriefOutline {
  readonly briefSections: readonly string[];
  readonly targetKeywords: readonly string[];
  readonly pageAssignment: ContentShadowPageAssignment;
}

/**
 * The customer's own identity on the web, frozen at accept time.
 *
 * Without it the research pack held no URL at all, so EVERY link in a draft
 * resolved to nothing — including the drafting scaffold's own call to action.
 * `passed` was therefore reachable only by a draft that linked nowhere, which
 * made a correctly written draft score worse than an incomplete one and
 * collapsed the verdict to two usable values.
 *
 * It is frozen rather than read live for the same reason every other input is:
 * the QA gate's replay comparison treats differing claims for one run as a
 * data-integrity error, so an origin that could move between a run and its
 * re-delivery would turn that guard into a flake. An origin that DOES move
 * inside the accept -> claim window changes the content address and fails the
 * run as input drift, which is red line C working, not a defect.
 */
export interface ContentShadowFirstPartyIdentity {
  /** `sites.origin` for the run's site, e.g. `https://acme.example`. */
  readonly siteOrigin: string;
  /**
   * `icp.primaryConversion.targetUrl` from the ICP profile the frozen
   * diagnostic run already pinned. `null` when the profile carries none — never
   * a placeholder, because a fabricated conversion target would resolve links
   * that nothing in our records supports.
   */
  readonly icpPrimaryConversionUrl: string | null;
}

/**
 * The append-only first-party page snapshot identity frozen into a Content
 * Shadow run. The body is deliberately not part of the manifest: these fields
 * are enough to prove which immutable snapshot a later bounded body came from,
 * while keeping the frozen tuple compact.
 */
export interface ContentShadowFirstPartyPageSnapshotIdentity {
  readonly pageSnapshotId: string;
  readonly dataSnapshotId: string;
  /**
   * Absolute http(s) URL on `firstParty.siteOrigin`'s exact hostname. The
   * manifest builder enforces this before hashing; a subdomain needs its own
   * verified site origin rather than implicit suffix ownership.
   */
  readonly url: string;
  readonly urlHash: string;
  readonly contentHash: string;
  readonly capturedAt: string;
}

export type ContentShadowKeywordMappingDecision = Exclude<
  ContentShadowPageAssignment,
  "mixed"
>;
export type ContentShadowKeywordMappingReviewState =
  | "unreviewed"
  | "confirmed";

/**
 * The exact mapping state that shaped a keyword fact at accept time. Keeping
 * revision and review state beside the decision prevents a later operator edit
 * from silently changing the research supplied to a replayed run.
 */
export interface ContentShadowKeywordMapping {
  readonly decision: ContentShadowKeywordMappingDecision;
  readonly mappedSitePageId: string | null;
  readonly reviewState: ContentShadowKeywordMappingReviewState;
  readonly revision: number;
}

/**
 * One frozen SearchQuery or GenerativeQuery fact. Search and generative facts
 * live in distinct collections in `ContentShadowResearchContext`; they are
 * never merged into a synthetic demand metric.
 */
export interface ContentShadowKeywordFact {
  readonly id: string;
  readonly display: string;
  readonly market: string;
  readonly language: string;
  readonly intent: string | null;
  readonly buyerStage: string | null;
  readonly cluster: string | null;
  readonly mapping: ContentShadowKeywordMapping;
  readonly lastSeen: string;
  readonly evidenceRefs: readonly string[];
}

export type ContentShadowCompetitorStatus =
  | "candidate"
  | "approved"
  | "excluded";
export type ContentShadowCompetitorRelationship =
  | "direct"
  | "indirect"
  | "status_quo"
  | "benchmark"
  | "publisher";
export type ContentShadowCompetitorScope =
  | "positioning"
  | "product_capability"
  | "keyword_gap"
  | "content"
  | "serp_visibility";

/** Frozen competitor fact and public-web targeting identity. */
export interface ContentShadowCompetitorFact {
  readonly id: string;
  readonly domain: string;
  readonly name: string | null;
  readonly status: ContentShadowCompetitorStatus;
  readonly relationship: ContentShadowCompetitorRelationship | null;
  readonly scopes: readonly ContentShadowCompetitorScope[];
  readonly revision: number;
}

/**
 * A public URL explicitly approved as research input. `ref` is a caller-stable
 * identity (not an array index), so target order cannot change the hash or
 * detach a retrieved page from the target that authorized it.
 */
export interface ContentShadowExternalResearchTarget {
  readonly ref: string;
  readonly kind: string;
  readonly url: string;
  readonly label: string;
}

/** Frozen brand, compliance and claim boundaries supplied to drafting + QA. */
export interface ContentShadowContentPolicy {
  readonly brandConstraints: readonly string[];
  readonly complianceConstraints: readonly string[];
  readonly prohibitedTerms: readonly string[];
  readonly claimRestrictions: readonly string[];
}

/**
 * Deterministic research facts frozen into the run's input address. Every
 * collection is canonicalized (stable sort + de-duplication) by the manifest
 * builder before hashing.
 */
export interface ContentShadowResearchContext {
  readonly firstPartyPageSnapshots: readonly ContentShadowFirstPartyPageSnapshotIdentity[];
  readonly searchKeywordFacts: readonly ContentShadowKeywordFact[];
  readonly generativeKeywordFacts: readonly ContentShadowKeywordFact[];
  readonly competitorFacts: readonly ContentShadowCompetitorFact[];
  readonly externalTargets: readonly ContentShadowExternalResearchTarget[];
  readonly contentPolicy: ContentShadowContentPolicy;
}

export interface ContentShadowFrozenInput {
  readonly primaryFindingId: string;
  readonly sourceActionId: string;
  readonly sourceDiagnosticRunId: string;
  readonly contentBriefArtifactId: string;
  readonly contentBriefRevision: number;
  readonly competitorEntityIds: readonly string[];
  readonly searchCluster: FrozenSearchCluster;
  readonly generativeQueryEntityIds: readonly string[];
  /**
   * Frozen because the gate resolves the draft's links against it. Both values
   * come from rows the run already pins: the site the frozen diagnosis ran
   * against, and the immutable `icp_profiles` version that diagnosis froze.
   */
  readonly firstParty: ContentShadowFirstPartyIdentity;
  /**
   * Frozen because it is what actually shapes the draft: an auditor must be
   * able to see what the model was told about the brief WITHOUT re-running the
   * extractor, and a mapping decision that moves between accept and claim is a
   * real input change that the existing hash guard must catch (decision O-2).
   */
  readonly contentBriefOutline: ContentShadowBriefOutline;
  /**
   * Frozen research facts, snapshot identities, explicit external targets and
   * content-policy boundaries. This is part of the content-hash tuple.
   */
  readonly researchContext: ContentShadowResearchContext;
  readonly flowAdapterVersion: string;
  readonly promptSetVersion: string;
  readonly projectionVersion: string;
  readonly outputLocale: string;
}

/**
 * The frozen SearchQuery cluster. Search observation keeps its own shape and
 * its own identity set; it is never merged with generative observation into a
 * shared "volume" (invariant 8).
 */
export interface FrozenSearchCluster {
  readonly clusterKey: string;
  readonly keywordEntityIds: readonly string[];
}

/**
 * The canonical, `undefined`-free manifest persisted as
 * `flow_shadow_runs.frozen_input_manifest` and hashed into `content_hash`.
 * Identity collections are sorted and de-duplicated so an equivalent request
 * always produces the identical hash.
 */
export interface ContentShadowInputManifest {
  readonly primaryFindingId: string;
  readonly sourceActionId: string;
  readonly sourceDiagnosticRunId: string;
  readonly contentBriefArtifactId: string;
  readonly contentBriefRevision: number;
  readonly competitorEntityIds: readonly string[];
  readonly searchCluster: {
    readonly clusterKey: string;
    readonly keywordEntityIds: readonly string[];
  };
  readonly generativeQueryEntityIds: readonly string[];
  readonly firstParty: ContentShadowFirstPartyIdentity;
  readonly contentBriefOutline: ContentShadowBriefOutline;
  readonly researchContext: ContentShadowResearchContext;
  readonly flowAdapterVersion: string;
  readonly promptSetVersion: string;
  readonly projectionVersion: string;
  readonly outputLocale: string;
}

/**
 * Disclosure counts for the brief-outline projection. Deliberately NOT part of
 * the frozen manifest: `mapping_review_state` does not shape the draft, so it
 * must not be able to fail an already queued run — it only has to be visible.
 */
export interface BriefOutlineProjectionStats {
  /**
   * DISTINCT `## ` section labels the pinned brief carried, before the outline
   * cap. Without it the section channel could truncate in silence while the
   * keyword channel disclosed its own truncation — a partial break of the
   * brief -> draft causal chain that read as a clean pass.
   */
  readonly briefSectionCount: number;
  /** Section labels that survived the outline cap and reached the prompt. */
  readonly projectedSectionCount: number;
  readonly clusterKeywordCount: number;
  readonly projectedKeywordCount: number;
  readonly unconfirmedMappingCount: number;
}

/**
 * Authority grading. `A`/`B`/`C` are IDENTICAL to the existing `EvidenceGrade`
 * (`@sf/db`), which the 0012 triggers pin from provider + origin — reusing them
 * keeps one authoritative definition of "how good is this source" instead of
 * two that drift apart under the same letters.
 *
 * `D` is ASYMMETRIC and the asymmetry is deliberate (Slice 2 decision Q1):
 * `A`/`B`/`C` describe where a source came from, while `D` is not a source
 * property at all — it is the QA gate's OUTPUT for "this reference in the draft
 * resolves to no source we hold". A research pack must therefore never emit `D`:
 * it is assembled only from database rows, and a row with no provenance has
 * nowhere to have come from. If pack assembly ever produces `D`, that is a bug
 * meaning it invented a source, not a new tier to support.
 *
 * The governed research pack emits `A` for confirmed project identities and
 * `B` for auditable public page captures. `C` remains available for
 * user-provided/generated provenance, but `D` is statically excluded from
 * `ResearchSource`.
 */
export type AuthorityTier = "A" | "B" | "C" | "D";
/** A pack source can only carry a real, provenance-backed evidence grade. */
export type ResearchAuthorityTier = Exclude<AuthorityTier, "D">;

/**
 * `first_party_site`, `first_party_conversion` and `first_party_page` describe
 * the customer's own web identity. They are deliberately distinct from
 * `external_page`: a draft cannot cite the customer's own site as proof of an
 * outside claim, even when a frozen page body is useful for supported product
 * facts and duplicate checks.
 */
export type ResearchSourceKind =
  | "content_brief"
  | "search_query"
  | "generative_query"
  | "competitor"
  | "first_party_site"
  | "first_party_conversion"
  | "first_party_page"
  | "external_page";

export type ResearchSourceAvailability =
  | "available"
  | "partial"
  | "unavailable";

/**
 * The method names are explicit because a content hash without its
 * normalization algorithm cannot be independently reproduced.
 */
export type ResearchContentHashMethod =
  | "sha256_canonical_extract"
  | "sha256_normalized_text";

/** Bounded transport/retrieval measurements; never a merged demand metric. */
export interface ResearchSourceMetrics {
  readonly status: number | null;
  readonly contentType: string | null;
  readonly bodyBytes: number | null;
  readonly wordCount: number | null;
  readonly responseMs: number | null;
  /** Redirect order is causal and is therefore preserved, not sorted. */
  readonly redirectChain: readonly string[];
}

/**
 * A body already retrieved by an outer adapter or loaded from an immutable
 * first-party PageSnapshot. `buildResearchPack` consumes this value as data; it
 * never performs retrieval itself.
 */
export interface RetrievedResearchSnapshot {
  /** PageSnapshot id for first party; frozen external target ref otherwise. */
  readonly ref: string;
  readonly kind: "first_party_page" | "external_page";
  readonly label: string;
  /** The URL whose retrieval was authorized by the frozen manifest. */
  readonly requestedUrl: string;
  /** Terminal URL after safe redirects, or the first-party snapshot URL. */
  readonly url: string | null;
  readonly availability: ResearchSourceAvailability;
  readonly capturedAt: string | null;
  readonly urlHash: string | null;
  readonly contentHash: string | null;
  readonly contentHashMethod: ResearchContentHashMethod | null;
  readonly contentText: string | null;
  /**
   * True when the retrieval adapter retained only a bounded prefix of the
   * normalized body. This is distinct from `excerptTruncated`: a bounded
   * preview does not mean the auditable body projection is incomplete.
   */
  readonly contentTruncated: boolean;
  readonly excerpt: string | null;
  /** True when `excerpt` is only a bounded preview of a longer body. */
  readonly excerptTruncated: boolean;
  readonly metrics: ResearchSourceMetrics | null;
  readonly evidenceRefs: readonly string[];
  readonly limitation: string | null;
}

export interface ResearchSource {
  readonly kind: ResearchSourceKind;
  /** Canonical project id, PageSnapshot id or frozen external target ref. */
  readonly ref: string;
  readonly authorityTier: ResearchAuthorityTier;
  readonly label: string;
  readonly url: string | null;
  /**
   * Adapter availability, downgraded from `available` to `partial` only when
   * the pack itself truncates the retained body projection.
   */
  readonly availability: ResearchSourceAvailability;
  readonly capturedAt: string | null;
  readonly urlHash: string | null;
  readonly contentHash: string | null;
  readonly contentHashMethod: ResearchContentHashMethod | null;
  /**
   * Bounded, immutable research text supplied to drafting and duplicate checks.
   * Null means no body was supplied; it never means an empty page was observed.
   */
  readonly contentText: string | null;
  /**
   * True when the retained body was truncated by either the retrieval adapter
   * or this pack's deterministic body-text bounds.
   */
  readonly contentTruncated: boolean;
  readonly excerpt: string | null;
  /**
   * True when the retained excerpt is only a bounded preview. This does not by
   * itself increment `ResearchRetrievalSummary.truncatedSourceCount`.
   */
  readonly excerptTruncated: boolean;
  readonly metrics: ResearchSourceMetrics | null;
  readonly evidenceRefs: readonly string[];
  /** Honest statement of what this source does NOT yet prove; never null-padded. */
  readonly limitation: string | null;
}

/**
 * Search observation for the frozen cluster. Search and generative observation
 * stay in two separate shapes (invariant 8); neither shape invents a shared
 * volume or citation metric.
 */
export interface ResearchSearchObservation {
  readonly clusterKey: string;
  readonly keywordEntityIds: readonly string[];
  readonly keywordFacts: readonly ContentShadowKeywordFact[];
}

/** Generative (AI answer) observation for the frozen query set. */
export interface ResearchGenerativeObservation {
  readonly generativeQueryEntityIds: readonly string[];
  readonly keywordFacts: readonly ContentShadowKeywordFact[];
}

/** Counts derived only from frozen targets and supplied snapshot values. */
export interface ResearchRetrievalSummary {
  readonly targetCount: number;
  readonly suppliedSnapshotCount: number;
  readonly availableSourceCount: number;
  readonly partialSourceCount: number;
  readonly unavailableSourceCount: number;
  readonly firstPartyPageCount: number;
  readonly externalPageCount: number;
  readonly contentSourceCount: number;
  readonly contentCharacterCount: number;
  /**
   * Sources whose BODY projection was truncated by the retrieval adapter or
   * by the pack. Preview-only (`excerptTruncated`) sources are not counted.
   */
  readonly truncatedSourceCount: number;
}

/** The deterministic research pack persisted in `flow_shadow_research_packs`. */
export interface ResearchPack {
  readonly adapterVersion: string;
  readonly projectionVersion: string;
  readonly outputLocale: string;
  readonly brief: {
    readonly artifactId: string;
    readonly revision: number;
  };
  /** Deterministic drafting scaffold; the model fills it, the adapter fixes it. */
  readonly outline: readonly string[];
  /**
   * The brief-derived COVERAGE CHECKLIST. Distinct from `outline` above, which
   * is the fixed document scaffold — the two are orthogonal on purpose
   * (decision O-6) and must never be asserted against each other.
   */
  readonly briefOutline: ContentShadowBriefOutline;
  readonly searchObservation: ResearchSearchObservation;
  readonly generativeObservation: ResearchGenerativeObservation;
  readonly competitorEntityIds: readonly string[];
  readonly competitorFacts: readonly ContentShadowCompetitorFact[];
  readonly policy: ContentShadowContentPolicy;
  readonly retrievalSummary: ResearchRetrievalSummary;
  readonly sources: readonly ResearchSource[];
  readonly limitations: readonly string[];
}

/** SEO/GEO + factual review verdict for one evaluated draft revision. */
export type QaVerdict = "passed" | "needs_review" | "blocked";

export type QaClaimKind = "red_line" | "structure" | "citability" | "coverage";

/**
 * `unevaluated` is an honest third state: the check exists in the contract but
 * has not been implemented yet. It is never rendered as a pass.
 */
export type QaClaimStatus = "passed" | "failed" | "unevaluated";

export interface QaClaim {
  readonly claimId: string;
  readonly kind: QaClaimKind;
  readonly status: QaClaimStatus;
  readonly detail: string;
}

export interface QaEvaluation {
  readonly verdict: QaVerdict;
  readonly claims: readonly QaClaim[];
}

export interface QaEvaluationInput {
  readonly draftMarkdown: string;
  /**
   * The pinned content brief revision's body.
   *
   * Every QA input is drawn from something frozen or immutable — the evaluated
   * artifact revision, the hash-verified manifest projection, and this pinned
   * revision — because the QA gate's replay comparison treats differing claims
   * for the same run as a data-integrity error. An input that could move
   * between a run and its re-delivery would turn that guard into a flake.
   *
   * The brief body never enters the draft PROMPT (only the extracted coverage
   * checklist does); it is read here purely to detect a draft that restates it.
   */
  readonly briefMarkdown: string;
  readonly pack: ResearchPack;
  /**
   * Required, not optional: the QA claim is where a reviewer reads what the
   * brief contributed, so a caller that cannot supply the projection counts
   * must fail to compile rather than quietly emit a claim that reports only
   * the survivors of the cap.
   */
  readonly briefOutlineStats: BriefOutlineProjectionStats;
}
