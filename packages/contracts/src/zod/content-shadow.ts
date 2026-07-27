import { z } from "zod";
import { Bcp47Locale, IsoDateTime, Uuid } from "./common.ts";

/**
 * SEO/GEO Content Shadow contracts (Slice 2).
 *
 * A Content Shadow run is a SHADOW-mode capability: it consumes an already
 * confirmed content brief revision and produces an internal English draft plus
 * a QA verdict. It never confirms anything a second time (no approval,
 * checkpoint or opportunity object), never recasts the brief, and never
 * performs an external CMS/publish write.
 */

export const CONTENT_SHADOW_CAPABILITY_CONTRACT_VERSION =
  "content-shadow.0.4.0" as const;

/** Server-fixed pinned Flow adapter version (decision R3). */
export const CONTENT_SHADOW_ADAPTER_CONTRACT_VERSION =
  "content-shadow-adapter.0.4.0" as const;

const MAX_COMPETITORS = 50;
const MAX_SEARCH_KEYWORDS = 500;
const MAX_GENERATIVE_QUERIES = 500;
const MAX_FIRST_PARTY_PAGE_SNAPSHOTS = 50;
const MAX_EXTERNAL_RESEARCH_TARGETS = 8;
const MAX_RESEARCH_EVIDENCE_REFS = 50;
const MAX_RESEARCH_SOURCE_EVIDENCE_REFS = 100;
const MAX_RESEARCH_SOURCES = 1200;
const MAX_CONTENT_POLICY_ITEMS = 100;
const MAX_ARTIFACT_REVISION_HISTORY = 1000;
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const HttpUrl = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine(
    (value) => {
      try {
        const parsed = new URL(value);
        return (
          (parsed.protocol === "http:" || parsed.protocol === "https:") &&
          parsed.username === "" &&
          parsed.password === ""
        );
      } catch {
        return false;
      }
    },
    {
      message:
        "Research URLs must use HTTP(S) and must not contain embedded credentials",
    },
  );
const BoundedText = z.string().trim().min(1).max(10_000);

const uniqueUuids = (max: number, min = 0) =>
  z
    .array(Uuid)
    .min(min)
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Entity ids must be unique",
    });

/**
 * The frozen SearchQuery cluster. Its keyword identities stay in their own
 * field: search demand and generative answer observation are never collapsed
 * into one set or one shared volume (invariant 8).
 */
export const ContentShadowSearchCluster = z
  .object({
    clusterKey: z.string().trim().min(1).max(200),
    keywordEntityIds: uniqueUuids(MAX_SEARCH_KEYWORDS, 1),
  })
  .strict();
export type ContentShadowSearchCluster = z.infer<
  typeof ContentShadowSearchCluster
>;

/**
 * Immutable input for one Content Shadow run. There is no confirmation field:
 * the Finding was already confirmed through the canonical Finding Review
 * transaction, and this command refuses to run unless that is still true.
 */
export const CreateContentShadowRunRequest = z
  .object({
    actionId: Uuid,
    /** Defaults to the brief's current revision when omitted. */
    contentBriefRevision: z.number().int().min(1).optional(),
    /** Accepted only as an explicit echo of the server-pinned adapter (R3). */
    flowAdapterVersion: z
      .literal(CONTENT_SHADOW_ADAPTER_CONTRACT_VERSION)
      .optional(),
    competitorEntityIds: uniqueUuids(MAX_COMPETITORS).default([]),
    searchCluster: ContentShadowSearchCluster,
    generativeQueryEntityIds: uniqueUuids(MAX_GENERATIVE_QUERIES).default([]),
    outputLocale: Bcp47Locale,
    capabilityContractVersion: z.literal(
      CONTENT_SHADOW_CAPABILITY_CONTRACT_VERSION,
    ),
  })
  .strict()
  .superRefine((body, ctx) => {
    const search = new Set(body.searchCluster.keywordEntityIds);
    const collapsed = body.generativeQueryEntityIds.filter((id) =>
      search.has(id),
    );
    if (collapsed.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["generativeQueryEntityIds"],
        message:
          "Search and generative observation must stay separate: an entity cannot be both",
      });
    }
  });
export type CreateContentShadowRunRequest = z.infer<
  typeof CreateContentShadowRunRequest
>;

/** Phase is DERIVED from which append-only child rows exist (decision R1). */
export const ContentShadowPhase = z.enum([
  "queued",
  "research",
  "draft",
  "qa",
  "complete",
  "failed",
]);
export type ContentShadowPhase = z.infer<typeof ContentShadowPhase>;

export const ContentShadowQaVerdict = z.enum([
  "passed",
  "needs_review",
  "blocked",
]);
export type ContentShadowQaVerdict = z.infer<typeof ContentShadowQaVerdict>;

/**
 * What one claim costs, reported so a reader never has to guess it.
 *
 * - `blocking` — the draft says something the frozen records cannot support.
 *   Exactly three checks hold it and the set is closed by product decision.
 * - `review` — a real quality or SEO defect a person has to look at.
 * - `advisory` — a style signal that never moves the verdict, not even to
 *   `needs_review`.
 *
 * It is reported rather than left to the reader because the alternative is a
 * copy of the gate's severity table in every consumer, and such a copy drifts
 * in the one direction that costs the most: a reader that believes a blocking
 * check is advisory presents a draft as safe to accept.
 */
export const ContentShadowQaSeverity = z.enum([
  "blocking",
  "review",
  "advisory",
]);
export type ContentShadowQaSeverity = z.infer<typeof ContentShadowQaSeverity>;

export const ContentShadowQaClaim = z
  .object({
    claimId: z.string().trim().min(1).max(200),
    kind: z.enum(["red_line", "structure", "citability", "coverage"]),
    severity: ContentShadowQaSeverity,
    /** `unevaluated` is honest missing judgement, never an implicit pass. */
    status: z.enum(["passed", "failed", "unevaluated"]),
    detail: z.string().trim().min(1).max(2000),
  })
  .strict();
export type ContentShadowQaClaim = z.infer<typeof ContentShadowQaClaim>;

/**
 * `first_party_site` / `first_party_conversion` are the customer's OWN web
 * identity. They are first-party records like every other pack source, so they
 * grade `A`, but they are never evidence for a claim: they only let the QA gate
 * tell a link to the customer's property apart from an outside citation.
 */
export const ContentShadowAuthoritySource = z
  .object({
    kind: z.enum([
      "content_brief",
      "search_query",
      "generative_query",
      "competitor",
      "first_party_site",
      "first_party_conversion",
      "first_party_page",
      "external_page",
    ]),
    ref: z.string().trim().min(1).max(500),
    label: z.string().trim().min(1).max(500),
    url: HttpUrl.nullable(),
    availability: z.enum(["available", "partial", "unavailable"]),
    authorityTier: z.enum(["A", "B", "C"]),
    capturedAt: IsoDateTime.nullable(),
    contentHash: Sha256.nullable(),
    contentHashMethod: z
      .enum(["sha256_canonical_extract", "sha256_normalized_text"])
      .nullable(),
    /**
     * True when the immutable body retained by the research adapter or pack is
     * only a bounded prefix. This remains customer-visible even though the
     * complete body itself is deliberately excluded from the wire contract.
     */
    contentTruncated: z.boolean(),
    excerpt: z.string().max(10_000).nullable(),
    /** True when the customer-readable excerpt is a bounded preview. */
    excerptTruncated: z.boolean(),
    metrics: z
      .object({
        status: z.number().int().min(100).max(599).nullable(),
        contentType: z.string().trim().min(1).max(200).nullable(),
        bodyBytes: z.number().int().min(0).nullable(),
        wordCount: z.number().int().min(0).nullable(),
        responseMs: z.number().int().min(0).nullable(),
        redirectChain: z.array(HttpUrl).max(10),
      })
      .strict()
      .nullable(),
    evidenceRefs: z
      .array(z.string().trim().min(1).max(500))
      .max(MAX_RESEARCH_SOURCE_EVIDENCE_REFS),
    limitation: z.string().trim().min(1).max(2000).nullable(),
  })
  .strict()
  .superRefine((source, ctx) => {
    if ((source.contentHash === null) !== (source.contentHashMethod === null)) {
      ctx.addIssue({
        code: "custom",
        path: ["contentHashMethod"],
        message:
          "contentHash and contentHashMethod must either both be present or both be null",
      });
    }
    if (
      source.contentTruncated &&
      (source.availability !== "partial" ||
        source.contentHash === null ||
        source.contentHashMethod === null)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["contentTruncated"],
        message:
          "A truncated body requires partial availability and an auditable content hash",
      });
    }
    if (
      source.excerptTruncated &&
      (source.excerpt === null || source.availability === "unavailable")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["excerptTruncated"],
        message:
          "A truncated excerpt requires a retained excerpt from an available or partial source",
      });
    }
  });
export type ContentShadowAuthoritySource = z.infer<
  typeof ContentShadowAuthoritySource
>;

const MAX_BRIEF_OUTLINE_SECTIONS = 12;
const MAX_BRIEF_OUTLINE_KEYWORDS = 50;

/**
 * The brief-derived COVERAGE CHECKLIST, not a document structure (Slice 2
 * decision O-6): "these topics must be covered", never "organise the draft
 * under these headings". The draft's structure stays the fixed drafting
 * scaffold, and the two are never asserted against each other.
 */
export const ContentShadowBriefOutline = z
  .object({
    briefSections: z
      .array(z.string().trim().min(1).max(120))
      .max(MAX_BRIEF_OUTLINE_SECTIONS),
    targetKeywords: z
      .array(z.string().trim().min(1).max(120))
      .max(MAX_BRIEF_OUTLINE_KEYWORDS),
    pageAssignment: z.enum([
      "existing_page",
      "new_asset",
      "mixed",
      "unassigned",
    ]),
  })
  .strict();
export type ContentShadowBriefOutline = z.infer<
  typeof ContentShadowBriefOutline
>;

/**
 * The project's own web identity, frozen at accept time. It is reported because
 * the QA gate's link judgement resolves against it: a reviewer told "this link
 * resolves" has to be able to see what it resolved against, and the research
 * pack that also carries it does not exist until the run reaches research.
 */
export const ContentShadowFirstPartyIdentity = z
  .object({
    siteOrigin: z.string().trim().min(1).max(2048),
    /** `null` when the frozen ICP profile carries no conversion target. */
    icpPrimaryConversionUrl: z.string().trim().min(1).max(2048).nullable(),
  })
  .strict();
export type ContentShadowFirstPartyIdentity = z.infer<
  typeof ContentShadowFirstPartyIdentity
>;

export const ContentShadowFirstPartyPageSnapshotIdentity = z
  .object({
    pageSnapshotId: Uuid,
    dataSnapshotId: Uuid,
    url: HttpUrl,
    urlHash: Sha256,
    contentHash: Sha256,
    capturedAt: IsoDateTime,
  })
  .strict();

export const ContentShadowKeywordMapping = z
  .object({
    decision: z.enum(["unassigned", "existing_page", "new_asset"]),
    mappedSitePageId: Uuid.nullable(),
    reviewState: z.enum(["unreviewed", "confirmed"]),
    revision: z.number().int().min(0),
  })
  .strict();

export const ContentShadowKeywordFact = z
  .object({
    id: Uuid,
    display: z.string().trim().min(1).max(500),
    market: z.string().trim().min(1).max(32),
    language: Bcp47Locale,
    intent: z.string().trim().min(1).max(100).nullable(),
    buyerStage: z.string().trim().min(1).max(100).nullable(),
    cluster: z.string().trim().min(1).max(200).nullable(),
    mapping: ContentShadowKeywordMapping,
    lastSeen: IsoDateTime,
    evidenceRefs: z
      .array(z.string().trim().min(1).max(500))
      .max(MAX_RESEARCH_EVIDENCE_REFS),
  })
  .strict();

export const ContentShadowCompetitorFact = z
  .object({
    id: Uuid,
    domain: z.string().trim().min(1).max(253),
    name: z.string().trim().min(1).max(160).nullable(),
    status: z.enum(["candidate", "approved", "excluded"]),
    relationship: z
      .enum(["direct", "indirect", "status_quo", "benchmark", "publisher"])
      .nullable(),
    scopes: z
      .array(
        z.enum([
          "positioning",
          "product_capability",
          "keyword_gap",
          "content",
          "serp_visibility",
        ]),
      )
      .max(5),
    revision: z.number().int().min(0),
  })
  .strict();

export const ContentShadowExternalResearchTarget = z
  .object({
    ref: z.string().trim().min(1).max(500),
    kind: z.string().trim().min(1).max(100),
    url: HttpUrl,
    label: z.string().trim().min(1).max(500),
  })
  .strict();

export const ContentShadowContentPolicy = z
  .object({
    brandConstraints: z.array(BoundedText).max(MAX_CONTENT_POLICY_ITEMS),
    complianceConstraints: z.array(BoundedText).max(MAX_CONTENT_POLICY_ITEMS),
    prohibitedTerms: z.array(BoundedText).max(MAX_CONTENT_POLICY_ITEMS),
    claimRestrictions: z.array(BoundedText).max(MAX_CONTENT_POLICY_ITEMS),
  })
  .strict();

export const ContentShadowResearchContext = z
  .object({
    firstPartyPageSnapshots: z
      .array(ContentShadowFirstPartyPageSnapshotIdentity)
      .max(MAX_FIRST_PARTY_PAGE_SNAPSHOTS),
    searchKeywordFacts: z
      .array(ContentShadowKeywordFact)
      .min(1)
      .max(MAX_SEARCH_KEYWORDS),
    generativeKeywordFacts: z
      .array(ContentShadowKeywordFact)
      .max(MAX_GENERATIVE_QUERIES),
    competitorFacts: z.array(ContentShadowCompetitorFact).max(MAX_COMPETITORS),
    externalTargets: z
      .array(ContentShadowExternalResearchTarget)
      .max(MAX_EXTERNAL_RESEARCH_TARGETS),
    contentPolicy: ContentShadowContentPolicy,
  })
  .strict()
  .superRefine((context, ctx) => {
    const identityLists = [
      {
        path: ["firstPartyPageSnapshots"] as const,
        values: context.firstPartyPageSnapshots.map(
          (snapshot) => snapshot.pageSnapshotId,
        ),
      },
      {
        path: ["searchKeywordFacts"] as const,
        values: context.searchKeywordFacts.map((fact) => fact.id),
      },
      {
        path: ["generativeKeywordFacts"] as const,
        values: context.generativeKeywordFacts.map((fact) => fact.id),
      },
      {
        path: ["competitorFacts"] as const,
        values: context.competitorFacts.map((fact) => fact.id),
      },
      {
        path: ["externalTargets"] as const,
        values: context.externalTargets.map((target) => target.ref),
      },
    ];
    for (const identity of identityLists) {
      if (new Set(identity.values).size !== identity.values.length) {
        ctx.addIssue({
          code: "custom",
          path: [...identity.path],
          message: "Frozen research identities must be unique",
        });
      }
    }
  });
export type ContentShadowResearchContext = z.infer<
  typeof ContentShadowResearchContext
>;

export const ContentShadowFrozenInputs = z
  .object({
    primaryFindingId: Uuid,
    sourceDiagnosticRunId: Uuid,
    competitorEntityIds: uniqueUuids(MAX_COMPETITORS),
    searchCluster: z
      .object({
        clusterKey: z.string().trim().min(1).max(200),
        keywordEntityIds: uniqueUuids(MAX_SEARCH_KEYWORDS, 1),
      })
      .strict(),
    generativeQueryEntityIds: uniqueUuids(MAX_GENERATIVE_QUERIES),
    firstParty: ContentShadowFirstPartyIdentity,
    contentBriefOutline: ContentShadowBriefOutline,
    researchContext: ContentShadowResearchContext,
  })
  .strict()
  .superRefine((inputs, ctx) => {
    const exactSet = (left: readonly string[], right: readonly string[]) =>
      JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
    const identities = [
      {
        path: ["researchContext", "searchKeywordFacts"] as const,
        label: "search keyword",
        expected: inputs.searchCluster.keywordEntityIds,
        actual: inputs.researchContext.searchKeywordFacts.map((fact) => fact.id),
      },
      {
        path: ["researchContext", "generativeKeywordFacts"] as const,
        label: "generative keyword",
        expected: inputs.generativeQueryEntityIds,
        actual: inputs.researchContext.generativeKeywordFacts.map(
          (fact) => fact.id,
        ),
      },
      {
        path: ["researchContext", "competitorFacts"] as const,
        label: "competitor",
        expected: inputs.competitorEntityIds,
        actual: inputs.researchContext.competitorFacts.map((fact) => fact.id),
      },
    ];
    for (const identity of identities) {
      if (!exactSet(identity.expected, identity.actual)) {
        ctx.addIssue({
          code: "custom",
          path: [...identity.path],
          message: `Frozen ${identity.label} facts must match the frozen identity set`,
        });
      }
    }
  });
export type ContentShadowFrozenInputs = z.infer<
  typeof ContentShadowFrozenInputs
>;

export const ContentShadowResearch = z
  .object({
    packId: Uuid,
    sources: z.array(ContentShadowAuthoritySource).max(MAX_RESEARCH_SOURCES),
    limitations: z.array(z.string().trim().min(1).max(2000)).max(100),
    generatedAt: IsoDateTime,
  })
  .strict();
export type ContentShadowResearch = z.infer<typeof ContentShadowResearch>;

export const ContentShadowDraft = z
  .object({
    artifactId: Uuid,
    /**
     * The shadow draft's own lifecycle never reaches a published state: this is
     * an internal artifact and Slice 2 performs zero external writes.
     */
    status: z.enum(["generating", "draft", "ready", "failed", "archived"]),
    currentRevision: z.number().int().min(0),
    contentText: z.string().nullable(),
    revisionHistory: z
      .array(
        z
          .object({
            revision: z.number().int().min(1),
            contentHash: Sha256,
            generatedBy: z.string().trim().min(1).max(100),
            editorId: Uuid.nullable(),
            note: z.string().trim().min(1).max(2000).nullable(),
            validationErrorCount: z.number().int().min(0),
            createdAt: IsoDateTime,
          })
          .strict(),
      )
      .max(MAX_ARTIFACT_REVISION_HISTORY),
  })
  .strict()
  .superRefine((draft, ctx) => {
    for (let index = 1; index < draft.revisionHistory.length; index += 1) {
      if (
        draft.revisionHistory[index - 1]!.revision !==
        draft.revisionHistory[index]!.revision + 1
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["revisionHistory", index, "revision"],
          message:
            "Revision history must be contiguous, complete and newest-first",
        });
      }
    }
    const oldestRevision = draft.revisionHistory.at(-1);
    if (oldestRevision !== undefined && oldestRevision.revision !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["revisionHistory", draft.revisionHistory.length - 1, "revision"],
        message: "A complete revision history must include revision 1",
      });
    }
    if (
      draft.currentRevision > 0 &&
      !draft.revisionHistory.some(
        (revision) => revision.revision === draft.currentRevision,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["revisionHistory"],
        message: "Revision history must include the run's projected revision",
      });
    }
  });
export type ContentShadowDraft = z.infer<typeof ContentShadowDraft>;

export const ContentShadowQaGate = z
  .object({
    gateId: Uuid,
    verdict: ContentShadowQaVerdict,
    evaluatedArtifactId: Uuid,
    evaluatedRevision: z.number().int().min(1),
    claims: z.array(ContentShadowQaClaim).max(500),
    evaluatedAt: IsoDateTime,
  })
  .strict();
export type ContentShadowQaGate = z.infer<typeof ContentShadowQaGate>;

/**
 * Read-only Content Shadow projection. Run status comes from the canonical
 * async run; the shadow rows own no second lifecycle.
 */
export const ContentShadowRunResponse = z
  .object({
    flowShadowRunId: Uuid,
    projectId: Uuid,
    siteId: Uuid,
    asyncRunId: Uuid,
    status: z.enum([
      "queued",
      "running",
      "completed",
      "partial",
      "failed",
      "cancelled",
    ]),
    phase: ContentShadowPhase,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    projectionVersion: z.string().trim().min(1).max(200),
    flowAdapterVersion: z.string().trim().min(1).max(200),
    outputLocale: Bcp47Locale,
    createdAt: IsoDateTime,
    source: z
      .object({
        findingId: Uuid,
        actionId: Uuid,
        contentBriefArtifactId: Uuid,
        contentBriefRevision: z.number().int().min(1),
      })
      .strict(),
    frozenInputs: ContentShadowFrozenInputs,
    research: ContentShadowResearch.nullable(),
    draft: ContentShadowDraft.nullable(),
    qa: ContentShadowQaGate.nullable(),
  })
  .strict();
export type ContentShadowRunResponse = z.infer<typeof ContentShadowRunResponse>;

/**
 * One row of the Content Shadow run index.
 *
 * The Execution screen can only read a run it can name, and the only place a
 * run id was ever handed out was the 202 that created it — so a reload lost
 * the research pack, the QA verdict and every honesty disclosure with it, and
 * what a customer saw depended on whether they had refreshed the page. This
 * index is what makes those readable again after a reload and on a second
 * device.
 *
 * It is DELIBERATELY state-free. Everything here is a column of the run's own
 * immutable row (plus the frozen manifest's locale), so a page of this list can
 * never report a phase, a verdict or a pack it did not read. Run state, the
 * research pack, the draft and the QA gate all come from
 * `getContentShadowRun`, which reads the append-only child rows that own them.
 */
/**
 * Record that a person reviewed one Content Shadow draft revision.
 *
 * There is exactly one recordable outcome in this stage, and it is deliberately
 * not spelled as a `decision` field. The artifact lifecycle's manual edges are
 * `generating → draft → ready` and `draft | ready → archived`; the only way back
 * from `ready` is to edit, which appends a revision and returns the deliverable
 * to `draft` on its own. So "send it back" already has a real mechanism and
 * needs no command, while a second decision value would have to be stored
 * somewhere no table exists for — and a control that writes nothing while
 * looking like it decided something is the failure mode this whole slice is
 * written against.
 *
 * `baseRevision` is what makes a review a review of something: it names the
 * revision the person actually read. If the deliverable has moved on, the
 * command is refused rather than re-aimed at the newest text.
 */
export const ReviewContentShadowRevisionRequest = z
  .object({
    baseRevision: z.number().int().min(1),
    /**
     * The reviewer's explicit statement that they read every finding needing
     * human confirmation. Required to be `true` when the automated verdict is
     * `needs_review`; a one-click pass would make that verdict decorative.
     */
    acknowledgeFindings: z.boolean().default(false),
  })
  .strict();
export type ReviewContentShadowRevisionRequest = z.infer<
  typeof ReviewContentShadowRevisionRequest
>;

/**
 * What the review actually did, as facts that can be checked against the record.
 *
 * `externalPublishingWrite` is a constant, and that is the point: the strongest
 * form of "nothing was published" is a field in the receipt that can only ever
 * read `none`, rather than a sentence in the interface that a later change
 * could quietly stop being true.
 */
export const ContentShadowReviewReceipt = z
  .object({
    flowShadowRunId: Uuid,
    artifactId: Uuid,
    reviewedRevision: z.number().int().min(1),
    artifactStatus: z.enum([
      "generating",
      "draft",
      "ready",
      "failed",
      "archived",
    ]),
    verdict: ContentShadowQaVerdict,
    claimCounts: z
      .object({
        passed: z.number().int().min(0),
        failed: z.number().int().min(0),
        unevaluated: z.number().int().min(0),
      })
      .strict(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    reviewedAt: IsoDateTime,
    externalPublishingWrite: z.literal("none"),
  })
  .strict();
export type ContentShadowReviewReceipt = z.infer<
  typeof ContentShadowReviewReceipt
>;

export const ContentShadowRunSummary = z
  .object({
    flowShadowRunId: Uuid,
    projectId: Uuid,
    siteId: Uuid,
    asyncRunId: Uuid,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    projectionVersion: z.string().trim().min(1).max(200),
    flowAdapterVersion: z.string().trim().min(1).max(200),
    outputLocale: Bcp47Locale,
    createdAt: IsoDateTime,
    source: z
      .object({
        findingId: Uuid,
        actionId: Uuid,
        contentBriefArtifactId: Uuid,
        contentBriefRevision: z.number().int().min(1),
      })
      .strict(),
  })
  .strict();
export type ContentShadowRunSummary = z.infer<typeof ContentShadowRunSummary>;
