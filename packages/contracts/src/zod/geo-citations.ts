import { z } from "zod";
import {
  IsoDateTime,
  MarketCode,
  Uuid,
} from "./common.ts";
import { PublicationHttpUrl } from "./delivery-connections.ts";
import { GrowthMapLibraryLanguageTag } from "./growth-map.ts";
import { MeasurementWindowInterval } from "./measurement.ts";

const BoundedQuery = z.string().trim().min(1).max(500);
const BoundedIdentity = z.string().trim().min(1).max(500);
const BoundedLimitation = z.string().trim().min(1).max(2_000);
const BoundedEvidenceExcerpt = z.string().trim().min(1).max(1_000);
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const AuditedProviderKey = z
  .string()
  .trim()
  .min(2)
  .max(100)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u);

export const GeoKnownPlatform = z.enum([
  "chatgpt",
  "perplexity",
  "google_ai_overview",
  "gemini",
  "claude",
  "copilot",
]);
export type GeoKnownPlatform = z.infer<typeof GeoKnownPlatform>;

export const GeoCitationPlatform = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("known"),
      key: GeoKnownPlatform,
    })
    .strict(),
  z
    .object({
      kind: z.literal("other"),
      providerKey: AuditedProviderKey,
    })
    .strict(),
]);
export type GeoCitationPlatform = z.infer<
  typeof GeoCitationPlatform
>;

export const GeoCitationCollector = z
  .object({
    kind: z.enum([
      "vendor_api",
      "browser_probe",
      "manual_verified",
    ]),
    providerKey: AuditedProviderKey,
    version: BoundedIdentity,
  })
  .strict();
export type GeoCitationCollector = z.infer<
  typeof GeoCitationCollector
>;

export const GeoBoundedEvidence = z
  .object({
    excerpt: BoundedEvidenceExcerpt,
    contentHash: Sha256,
    selector: BoundedIdentity,
  })
  .strict();
export type GeoBoundedEvidence = z.infer<
  typeof GeoBoundedEvidence
>;

/**
 * Optional structural comparisons remain explicitly non-causal. A caller may
 * submit only a bounded statement tied to bounded evidence. There is no
 * free-form "reason" or causal-attribution field in this authority contract.
 */
export const GeoEvidenceStatement = z
  .object({
    classification: z.enum(["observation", "inference"]),
    statement: z.string().trim().min(1).max(1_000),
    evidence: GeoBoundedEvidence,
    limitation: BoundedLimitation.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.classification === "inference" &&
      value.limitation === null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["limitation"],
        message:
          "A GEO inference requires an explicit non-causal limitation",
      });
    }
  });
export type GeoEvidenceStatement = z.infer<
  typeof GeoEvidenceStatement
>;

export const GeoCitationOccurrenceInput = z
  .object({
    citationUrl: PublicationHttpUrl,
    citationOrdinal: z.number().int().positive().max(1_000),
    answerEvidenceExcerpt: BoundedEvidenceExcerpt,
    citedPageExcerpt: BoundedEvidenceExcerpt,
    citedPageContentHash: Sha256,
    citedParagraphHash: Sha256,
    citedParagraphSelector: BoundedIdentity,
    citedParagraphIndex: z
      .number()
      .int()
      .nonnegative()
      .max(1_000_000)
      .nullable(),
    evidenceClassification: z.literal("direct_observation"),
  })
  .strict();
export type GeoCitationOccurrenceInput = z.infer<
  typeof GeoCitationOccurrenceInput
>;

export const GeoCitationState = z.enum([
  "cited",
  "mentioned",
  "unseen",
  "unavailable",
]);
export type GeoCitationState = z.infer<typeof GeoCitationState>;

export const GeoCitationQueryInput = z
  .object({
    sitePageId: Uuid,
    canonicalUrl: PublicationHttpUrl,
    query: BoundedQuery,
    platform: GeoCitationPlatform,
    model: BoundedIdentity,
    collector: GeoCitationCollector,
    collectedAt: IsoDateTime,
    citationState: GeoCitationState,
    answerEvidence: GeoBoundedEvidence.nullable(),
    limitation: BoundedLimitation.nullable(),
    citations: z.array(GeoCitationOccurrenceInput).max(100),
    evidenceStatements: z.array(GeoEvidenceStatement).max(20).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.citationState === "cited" &&
      value.citations.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["citations"],
        message: "A cited GEO answer requires direct citation evidence",
      });
    }
    if (
      value.citationState !== "cited" &&
      value.citations.length > 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["citations"],
        message:
          "Only a directly cited GEO answer may carry citation occurrences",
      });
    }
    if (
      value.citationState === "unavailable" &&
      (value.answerEvidence !== null || value.limitation === null)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["answerEvidence"],
        message:
          "An unavailable GEO probe requires null answer evidence and an explicit limitation",
      });
    }
    if (
      value.citationState !== "unavailable" &&
      value.answerEvidence === null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["answerEvidence"],
        message:
          "An observed GEO answer requires bounded answer evidence",
      });
    }
    const ordinals = new Set<number>();
    value.citations.forEach((citation, index) => {
      if (citation.citationUrl !== value.canonicalUrl) {
        ctx.addIssue({
          code: "custom",
          path: ["citations", index, "citationUrl"],
          message:
            "A GEO page observation may count only citations to its exact canonical URL",
        });
      }
      if (ordinals.has(citation.citationOrdinal)) {
        ctx.addIssue({
          code: "custom",
          path: ["citations", index, "citationOrdinal"],
          message:
            "Citation ordinals must be unique within one answer observation",
        });
      }
      ordinals.add(citation.citationOrdinal);
    });
  });
export type GeoCitationQueryInput = z.infer<
  typeof GeoCitationQueryInput
>;

export const GeoCitationCollectionBatch = z
  .object({
    projectId: Uuid,
    siteId: Uuid,
    sourceConnectionId: Uuid,
    collectionRunId: Uuid,
    capturedAt: IsoDateTime,
    coveredWindow: MeasurementWindowInterval,
    marketCode: MarketCode,
    languageTag: GrowthMapLibraryLanguageTag,
    limitation: BoundedLimitation,
    queries: z.array(GeoCitationQueryInput).min(1).max(10_000),
  })
  .strict()
  .superRefine((value, ctx) => {
    const start = Date.parse(value.coveredWindow.startAt);
    const end = Date.parse(value.coveredWindow.endAt);
    if (Date.parse(value.capturedAt) < end) {
      ctx.addIssue({
        code: "custom",
        path: ["capturedAt"],
        message:
          "GEO snapshot capture time cannot predate its covered window",
      });
    }

    const identities = new Set<string>();
    const canonicalCollector = JSON.stringify(
      value.queries[0]?.collector ?? null,
    );
    value.queries.forEach((query, index) => {
      const collectedAt = Date.parse(query.collectedAt);
      if (collectedAt < start || collectedAt >= end) {
        ctx.addIssue({
          code: "custom",
          path: ["queries", index, "collectedAt"],
          message:
            "GEO query collection time must fall inside the covered window",
        });
      }
      const platformKey =
        query.platform.kind === "known"
          ? query.platform.key
          : `other:${query.platform.providerKey}`;
      const identity = [
        query.sitePageId,
        query.query,
        platformKey,
        query.model,
        query.collector.providerKey,
      ].join("\u0000");
      if (identities.has(identity)) {
        ctx.addIssue({
          code: "custom",
          path: ["queries", index],
          message:
            "A GEO batch cannot contain duplicate target/query/platform/model/collector observations",
        });
      }
      identities.add(identity);
      if (JSON.stringify(query.collector) !== canonicalCollector) {
        ctx.addIssue({
          code: "custom",
          path: ["queries", index, "collector"],
          message:
            "One immutable GEO snapshot must use one collector identity and version",
        });
      }
    });
  });
export type GeoCitationCollectionBatch = z.infer<
  typeof GeoCitationCollectionBatch
>;

export const GeoCitationOccurrenceEvidence =
  GeoCitationOccurrenceInput.extend({
    id: Uuid,
  }).strict();
export type GeoCitationOccurrenceEvidence = z.infer<
  typeof GeoCitationOccurrenceEvidence
>;

export const GeoCitationQueryEvidence = z
  .object({
    id: Uuid,
    query: BoundedQuery,
    platform: GeoCitationPlatform,
    model: BoundedIdentity,
    collector: GeoCitationCollector,
    collectedAt: IsoDateTime,
    marketCode: MarketCode,
    languageTag: GrowthMapLibraryLanguageTag,
    citationState: GeoCitationState,
    answerEvidence: GeoBoundedEvidence.nullable(),
    limitation: BoundedLimitation.nullable(),
    citations: z.array(GeoCitationOccurrenceEvidence).max(100),
    evidenceStatements: z.array(GeoEvidenceStatement).max(20).optional(),
  })
  .strict();
export type GeoCitationQueryEvidence = z.infer<
  typeof GeoCitationQueryEvidence
>;

export const GeoCitationEvidencePhase = z
  .object({
    sourceConnectionId: Uuid,
    snapshotId: Uuid,
    normalizedObservationId: Uuid,
    queries: z.array(GeoCitationQueryEvidence).max(10_000),
  })
  .strict();
export type GeoCitationEvidencePhase = z.infer<
  typeof GeoCitationEvidencePhase
>;

export const GeoCitationEvidenceResponse = z
  .object({
    projectId: Uuid,
    siteId: Uuid,
    measurementWindowId: Uuid,
    sitePageId: Uuid,
    canonicalUrl: PublicationHttpUrl,
    interpretation: z.literal("observational_non_causal"),
    phases: z
      .object({
        baseline: GeoCitationEvidencePhase.nullable(),
        outcome: GeoCitationEvidencePhase.nullable(),
      })
      .strict(),
    limitation: BoundedLimitation.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.phases.baseline === null &&
      value.phases.outcome === null &&
      value.limitation === null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["limitation"],
        message:
          "Missing GEO evidence requires an explicit limitation",
      });
    }
    if (
      (value.phases.baseline === null) !==
        (value.phases.outcome === null) &&
      value.limitation === null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["limitation"],
        message:
          "A one-sided GEO comparison requires an explicit limitation",
      });
    }
  });
export type GeoCitationEvidenceResponse = z.infer<
  typeof GeoCitationEvidenceResponse
>;
