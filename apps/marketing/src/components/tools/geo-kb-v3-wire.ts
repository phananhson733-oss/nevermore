// @input  -- the request bodies the review card sends and the JSON the two free v3 routes return
// @output -- one schema per direction, shared verbatim by the browser and the handlers
// @pos    -- client-safe: zod plus the v3 contract; no digest, no store, no server module
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * The request schema is the enforcement, not a convenience.
 *
 * A v3 draft has two halves on different clocks: `generationInput` and
 * `knowledge` are what a billed run produced and are locked for the life of the
 * review, and `review` is what the owner decides. The obvious way to save a
 * review is to POST the whole payload back, the way the v2 editor does -- and
 * that is exactly what makes "generationInput is read-only" a rule somebody has
 * to remember to check. Here the request cannot express a change to either
 * locked half: it carries the owner's gestures and the version they were made
 * against, and the server applies them to the payload it already holds. An edit
 * therefore cannot change the identity of a paid generation, because there is no
 * field in which to say so.
 *
 * `expectedGenerationInputHash` is the other half of that: it does not permit a
 * change, it detects one. If a run relocked the inputs while the card was open,
 * the save is refused rather than being recorded against inputs the owner never
 * read.
 */
import { z } from "zod";

import {
  geoOverrideSchema,
  geoReviewSchemaV3,
  type GeoDecision,
  type GeoKbPayloadV3,
  type GeoReviewV3,
} from "../../lib/geo-tools/kb-v3-contract.ts";
import type { GeoV3ReviewAction } from "../../lib/geo-tools/kb-v3-review.ts";
import type { GeoQuestionSetUnavailableReason } from "../../lib/geo-tools/kb-prepared-v3-contract.ts";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
// Deliberately not `z.uuid()`: these identities are UUIDv8.
const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
const timestamp = z
  .string()
  .refine(
    (value) => Number.isFinite(Date.parse(value)),
    "Expected a timestamp",
  );
const version = z.number().int().positive().refine(Number.isSafeInteger);
const count = z.number().int().nonnegative().refine(Number.isSafeInteger);

/**
 * How many gestures one save may carry. A review is bounded at 512 decisions,
 * and an "accept all" over the largest possible knowledge body is one action,
 * so this is generous for a person and closed for a loop.
 */
export const GEO_KB_V3_MAX_ACTIONS = 256;
export const GEO_KB_V3_MAX_BULK_KEYS = 512;

export const geoV3ReviewActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("accept"), itemKey: hash }).strict(),
  z
    .object({
      kind: z.literal("correct"),
      itemKey: hash,
      override: geoOverrideSchema,
    })
    .strict(),
  z.object({ kind: z.literal("exclude"), itemKey: hash }).strict(),
  z.object({ kind: z.literal("revert"), itemKey: hash }).strict(),
  z
    .object({
      kind: z.literal("accept_all"),
      itemKeys: z.array(hash).min(1).max(GEO_KB_V3_MAX_BULK_KEYS),
    })
    .strict(),
]);

export const geoV3ReviewRequestSchema = z
  .object({
    kbId: uuid,
    /** Compare-and-swap: the draft version the gestures were made against. */
    baseVersion: version,
    /** Fail-closed detection of a run that relocked the inputs mid-review. */
    expectedGenerationInputHash: hash,
    actions: z.array(geoV3ReviewActionSchema).min(1).max(GEO_KB_V3_MAX_ACTIONS),
  })
  .strict();
export type GeoV3ReviewRequest = z.infer<typeof geoV3ReviewRequestSchema>;

export const geoV3PublishRequestSchema = z
  .object({
    kbId: uuid,
    baseVersion: version,
    /** The exact draft the owner reviewed; a run that wrote under them fails this. */
    draftHash: hash,
  })
  .strict();
export type GeoV3PublishRequest = z.infer<typeof geoV3PublishRequestSchema>;

const countsSchema = z
  .object({
    total: count,
    accepted: count,
    acceptedInBulk: count,
    excluded: count,
    pending: count,
    corrected: count,
  })
  .strict();
export type GeoV3ReviewCountsWire = z.infer<typeof countsSchema>;

const reviewSaveSchema = z
  .object({
    draftVersion: version,
    contentHash: hash,
    updatedAt: timestamp,
    review: geoReviewSchemaV3,
    counts: countsSchema,
  })
  .strict();
export type GeoKbReviewSaveV3 = z.infer<typeof reviewSaveSchema>;

export function parseGeoKbReviewSaveV3(
  value: unknown,
): GeoKbReviewSaveV3 | null {
  const parsed = reviewSaveSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Publishing reports the draft it left behind as well as the version it made.
 * The two agree afterwards by construction -- the remaining pending items are
 * written back into the draft before the version is assembled -- and saying so
 * is how the card can stop offering to publish something it just published.
 */
const publishSchema = z
  .object({
    snapshotId: uuid,
    revision: version,
    contentHash: hash,
    frozenAt: timestamp,
    reusedExisting: z.boolean(),
    draftVersion: version,
    draftHash: hash,
    /** Items that were still pending and published as accepted in bulk. */
    bulkAccepted: count,
    counts: countsSchema,
    questionSet: z.discriminatedUnion("status", [
      z.object({ status: z.literal("available") }).strict(),
      z
        .object({
          status: z.literal("unavailable"),
          reason: z.string().min(1).max(64),
        })
        .strict(),
    ]),
  })
  .strict();
export type GeoKbPublishV3 = z.infer<typeof publishSchema>;

export function parseGeoKbPublishV3(value: unknown): GeoKbPublishV3 | null {
  const parsed = publishSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * What the card needs in order to draw a v3 draft and act on it. It is handed
 * in by whatever loaded the draft rather than fetched here: this file is the
 * wire, and a review surface that could re-read the knowledge would be a second
 * place where the locked half of a draft is decided.
 */
export interface GeoKbEditorViewV3 {
  readonly kbId: string;
  readonly host: string;
  readonly draftVersion: number;
  readonly draftHash: string;
  /** The locked generation output plus the review as the server last stored it. */
  readonly payload: GeoKbPayloadV3;
  /**
   * The published version this draft would supersede, when there is one.
   *
   * `decisions` is what the publish box compares against to say "N changes
   * compared with kb@vN". It has to come from the published version itself: a
   * count of what changed since the page loaded answers a different question in
   * the same sentence, and reads as zero for a draft whose every decision
   * predates this session. A key the published version does not carry reads as
   * `pending`, so an item that is new since then counts as one change.
   */
  readonly published: {
    readonly revision: number;
    readonly frozenAt: string;
    readonly contentHash: string;
    readonly decisions: Readonly<Record<string, GeoDecision>>;
  } | null;
  /** True while a run holds the draft; every automatic write is held. */
  readonly runInProgress?: boolean;
}

export type { GeoReviewV3, GeoV3ReviewAction, GeoQuestionSetUnavailableReason };
