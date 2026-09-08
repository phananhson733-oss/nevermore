// @input -- one v3 payload, the question set it may or may not have, and the observations behind it
// @output -- a thin deterministic frozen context: hashes, profile reference, role lineage and counts
// @pos -- server-side v3 context construction; v1/v2 contexts keep their own parsers and hashes

/**
 * The v3 context carries no facts, and that is the whole point of the version.
 *
 * v2 projected accepted facts into the context and demanded that each one have
 * a source URL, an observation time and, when crawled, an exact receipt. v3
 * admits two item kinds that can satisfy none of that: an owner declaration has
 * no URL, and a bulk-accepted model item has no receipt. Projecting them anyway
 * would write something untrue into the immutable record, so the facts now live
 * in exactly one place -- the published knowledge pack, where every item states
 * its own origin and decision -- and the context keeps only what binds a
 * version together: the hashes, the profile reference, the observations, the
 * role lineage and the per-origin counts.
 *
 * Nothing here is fetched or read from a store: the whole context is a
 * deterministic function of its input, so re-deriving it from a candidate is a
 * real check rather than a copy.
 */
import { z } from "zod";

import { normalizeAccountWebsiteUrl } from "../account-websites/contracts.ts";
import {
  geoReviewSchema,
  geoRoleEligibleForLayer,
  geoRoleSourceV2Schema,
  type GeoKbRoleV2,
} from "./kb-v2-contract.ts";
import { canonicalGeoV2Text, geoV2JsonbBytes } from "./kb-v2-json.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import {
  parseGeoQuestionSetV2,
  type GeoQuestionSetV2,
} from "./kb-question-set-v2.ts";
import {
  geoProfileRefSchema,
  parseGeoKbPayloadV3,
  type GeoKbPayloadV3,
  type GeoKnowledgeBodyV3,
  type GeoProfileRefV3,
} from "./kb-v3-contract.ts";

export const GEO_SNAPSHOT_CONTEXT_SCHEMA_V3 =
  "marketing-geo-snapshot-context.v3" as const;

/** Matches the per-version size ceiling the snapshot column installs for v3. */
export const GEO_CONTEXT_V3_MAX_BYTES = 262_144;
export const GEO_CONTEXT_V3_MAX_EVIDENCE_REFS = 32;

/**
 * The documented stand-in for "this version has no question set at all".
 *
 * It is the digest of the canonical text `null`, not the digest of any question
 * set: no real set can produce it, so a reader that compares hashes cannot
 * mistake an absent set for a present one. A publish is allowed to reach this
 * value -- the question step is optional in v3 -- and every consumer must treat
 * a context carrying it as a version whose question set does not exist, rather
 * than as one whose question set failed to load.
 */
export const GEO_ABSENT_QUESTION_SET_HASH = geoV2Digest(null);

const LAYERS = ["problem", "evaluation"] as const;
export type GeoContextLayerV3 = (typeof LAYERS)[number];

const hash = z.string().regex(/^[a-f0-9]{64}$/u);

// Deliberately not `z.uuid()` and not a `[1-5]` version nibble: the identities
// in this product are UUIDv8, and a version-pinning validator rejects all of
// them.
const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);

/**
 * Counts are decimal strings because a v3 payload, context and candidate must
 * contain no JSON number: numbers are the one JSON type whose text form is not
 * decided by the value alone, so two writers can serialise the same count
 * differently and break a digest that both sides believe they computed the same
 * way. Strings make the canonical text the only representation there is.
 */
const count = z.string().regex(/^(0|[1-9][0-9]{0,9})$/u);

const layerSchema = z.enum(LAYERS);

/**
 * One observation this version was built on: the observation's id and the hash
 * of what was observed. In S1 these are the source receipt refs; from S4 they
 * are rows of the website evidence observation log. Either way the context
 * points at the observation instead of copying it, so a later re-crawl can
 * never rewrite what an already-published version says it saw.
 */
export const geoContextEvidenceRefV3Schema = z
  .object({ sourceId: uuid, contentHash: hash })
  .strict();
export type GeoContextEvidenceRefV3 = z.infer<
  typeof geoContextEvidenceRefV3Schema
>;

/**
 * The role rows, projected from the locked generation input. `source` is the v2
 * role lineage shape, kept verbatim so a v3 context answers the same lineage
 * question a v2 one does. v2's `userEdited` flag is not carried: roles in v3 are
 * locked before review and are never editable afterwards, so the field could
 * only ever be `false`, and a structurally constant field states nothing.
 */
const roleSchema = z
  .object({
    roleId: z.string().min(1).max(64),
    review: geoReviewSchema,
    source: geoRoleSourceV2Schema,
    eligibleLayers: z.array(layerSchema).max(2),
  })
  .strict();

/**
 * How many reviewable items the *draft's* knowledge body carried from each
 * origin. These are pre-review counts, and deliberately so: an exclusion or a
 * suppression removes an item from the published pack but not from this
 * summary, so a published version may contain fewer items than this says.
 *
 * `declared_owner` has no bucket, which is the same fact stated from the other
 * side: a correction is recorded in the review, and the generated item keeps
 * the origin it was generated with, so an owner declaration first exists in the
 * published pack and never in a draft's counts. A summary of what publishes
 * could therefore not be produced by filtering this one -- a corrected item
 * publishes as `declared_owner`, which has no bucket here -- so making this
 * field review-aware is a schema change, not a change of arithmetic.
 *
 * It is not made review-aware because the post-review truth is already frozen
 * beside this record and is lossless: every item in the published knowledge
 * pack carries its own `origin` and its own `decision`, so per-origin counts of
 * what was published can be walked out of the pack itself. A second, derived
 * copy here would be one more place for the immutable record to disagree with
 * itself. What this summary adds is the one thing the pack cannot answer: the
 * shape of the body the paid generation produced, before anyone reviewed it.
 */
const sourceSummarySchema = z
  .object({
    own: count,
    competitor: count,
    thirdParty: count,
    gsc: count,
    profile: count,
    model: count,
  })
  .strict();

const contextSchema = z
  .object({
    schemaVersion: z.literal(GEO_SNAPSHOT_CONTEXT_SCHEMA_V3),
    kbId: uuid,
    targetHost: z.string().max(255),
    payloadHash: hash,
    questionSetHash: hash,
    profileRef: geoProfileRefSchema,
    evidenceRefs: z
      .array(geoContextEvidenceRefV3Schema)
      .max(GEO_CONTEXT_V3_MAX_EVIDENCE_REFS),
    roles: z.array(roleSchema).max(5),
    sourceSummary: sourceSummarySchema,
    skippedLayers: z.array(layerSchema).max(2),
    contentHash: hash,
  })
  .strict();

export type GeoSnapshotContextV3 = z.infer<typeof contextSchema>;
export type GeoSnapshotContextBodyV3 = Omit<
  GeoSnapshotContextV3,
  "contentHash"
>;
export type GeoSourceSummaryV3 = z.infer<typeof sourceSummarySchema>;

export const GEO_SNAPSHOT_CONTEXT_SCHEMA_V3_SHAPE = contextSchema;

export interface BuildGeoSnapshotContextV3Input {
  readonly kbId: string;
  readonly payload: GeoKbPayloadV3;
  /** Null is a legitimate published state: v3 may publish knowledge without questions. */
  readonly questionSet: GeoQuestionSetV2 | null;
  readonly evidenceRefs: readonly GeoContextEvidenceRefV3[];
}

/** No JSON numbers anywhere: see the note on `count`. */
function assertNumberFree(value: unknown): void {
  if (typeof value === "number")
    throw new Error("GEO v3 context must not contain numbers");
  if (Array.isArray(value)) {
    for (const entry of value) assertNumberFree(entry);
    return;
  }
  if (value !== null && typeof value === "object")
    for (const entry of Object.values(value)) assertNumberFree(entry);
}

/**
 * Sorted by code point rather than by locale: a locale-aware comparison makes
 * the stored order -- and therefore the content hash -- depend on where the
 * writer ran.
 */
function canonicalEvidenceRefs(
  refs: readonly GeoContextEvidenceRefV3[],
): GeoContextEvidenceRefV3[] {
  const parsed = z
    .array(geoContextEvidenceRefV3Schema)
    .max(GEO_CONTEXT_V3_MAX_EVIDENCE_REFS)
    .parse(refs);
  const canonical = parsed
    .map((ref) => ({ sourceId: ref.sourceId, contentHash: ref.contentHash }))
    .sort((left, right) =>
      left.sourceId < right.sourceId
        ? -1
        : left.sourceId > right.sourceId
          ? 1
          : 0,
    );
  assertCanonicalEvidenceRefs(canonical);
  return canonical;
}

function assertCanonicalEvidenceRefs(
  refs: readonly GeoContextEvidenceRefV3[],
): void {
  if (refs.some((ref) => ref.sourceId !== ref.sourceId.toLowerCase()))
    throw new Error("Evidence reference must be canonical");
  if (new Set(refs.map((ref) => ref.sourceId)).size !== refs.length)
    throw new Error("Duplicate evidence reference");
  for (let index = 1; index < refs.length; index += 1) {
    if (!(refs[index - 1]!.sourceId < refs[index]!.sourceId))
      throw new Error("Evidence references must be sorted by source id");
  }
}

const ORIGIN_BUCKET = {
  observed_own: "own",
  observed_competitor: "competitor",
  observed_third_party: "thirdParty",
  observed_gsc: "gsc",
  declared_profile: "profile",
  synthesized: "model",
} as const satisfies Record<string, keyof GeoSourceSummaryV3>;

function moduleValue<T>(module: {
  readonly status: string;
  readonly value?: T;
}): T | null {
  return "value" in module ? (module.value ?? null) : null;
}

/**
 * The origin of every reviewable item in the knowledge body, in the same walk
 * order `geoV3ItemKeys` uses. Modules without per-item provenance (evidence,
 * machine, coverage) are not counted here: they describe what was looked at,
 * not what is being claimed.
 */
export function geoV3ItemOrigins(
  knowledge: GeoKnowledgeBodyV3 | null,
): readonly string[] {
  if (knowledge === null) return [];
  const origins: string[] = [];
  const entity = moduleValue(knowledge.entity);
  if (entity) for (const field of entity.fields) origins.push(field.origin);
  for (const fact of moduleValue(knowledge.facts) ?? [])
    origins.push(fact.origin);
  for (const item of moduleValue(knowledge.qa) ?? []) origins.push(item.origin);
  for (const comparison of moduleValue(knowledge.comparisons) ?? [])
    for (const row of comparison.rows) origins.push(row.origin);
  const scope = moduleValue(knowledge.scope);
  if (scope)
    for (const items of Object.values(scope))
      for (const item of items) origins.push(item.origin);
  return origins;
}

/**
 * The draft's per-origin counts. It takes the knowledge body and nothing else,
 * which is the signature saying what it is: the review cannot reach it, so no
 * exclusion, suppression or correction changes what it returns. See the note on
 * `sourceSummarySchema` for why that is the intended meaning.
 */
export function geoV3SourceSummary(
  knowledge: GeoKnowledgeBodyV3 | null,
): GeoSourceSummaryV3 {
  const totals: Record<keyof GeoSourceSummaryV3, number> = {
    own: 0,
    competitor: 0,
    thirdParty: 0,
    gsc: 0,
    profile: 0,
    model: 0,
  };
  for (const origin of geoV3ItemOrigins(knowledge)) {
    const bucket = ORIGIN_BUCKET[origin as keyof typeof ORIGIN_BUCKET];
    if (bucket === undefined) throw new Error("Unknown item origin");
    totals[bucket] += 1;
  }
  return {
    own: String(totals.own),
    competitor: String(totals.competitor),
    thirdParty: String(totals.thirdParty),
    gsc: String(totals.gsc),
    profile: String(totals.profile),
    model: String(totals.model),
  };
}

function projectRoles(
  roles: readonly GeoKbRoleV2[],
): GeoSnapshotContextV3["roles"] {
  return roles.map((role) => ({
    roleId: role.id,
    review: role.review,
    source: {
      kind: role.source.kind,
      generationId: role.source.generationId,
      itemId: role.source.itemId,
      evidenceRefs: [...role.source.evidenceRefs],
    },
    // Same rule as v2: only an accepted role may carry a layer, because an
    // unreviewed role must not be able to justify a question.
    eligibleLayers: LAYERS.filter((layer) =>
      geoRoleEligibleForLayer(role, layer),
    ),
  }));
}

export function parseGeoSnapshotContextV3(
  value: unknown,
): GeoSnapshotContextV3 {
  if (geoV2JsonbBytes(value) > GEO_CONTEXT_V3_MAX_BYTES)
    throw new Error("Context exceeds byte limit");
  assertNumberFree(value);
  const parsed = contextSchema.parse(value);
  if (
    normalizeAccountWebsiteUrl(`https://${parsed.targetHost}`)?.host !==
    parsed.targetHost
  )
    throw new Error("Context site mismatch");
  assertCanonicalEvidenceRefs(parsed.evidenceRefs);
  if (
    new Set(parsed.roles.map((role) => role.roleId)).size !==
    parsed.roles.length
  )
    throw new Error("Duplicate context identity");
  for (const role of parsed.roles) {
    if (role.review !== "accepted" && role.eligibleLayers.length > 0)
      throw new Error("Invalid role policy/lineage");
    if (new Set(role.eligibleLayers).size !== role.eligibleLayers.length)
      throw new Error("Invalid role policy/lineage");
  }
  const skipped = LAYERS.filter(
    (layer) =>
      !parsed.roles.some((role) => role.eligibleLayers.includes(layer)),
  );
  if (canonicalGeoV2Text(skipped) !== canonicalGeoV2Text(parsed.skippedLayers))
    throw new Error("Invalid skipped-layer policy");
  const { contentHash, ...body } = parsed;
  if (geoV2Digest(body) !== contentHash)
    throw new Error("Context hash mismatch");
  return parsed;
}

/**
 * Deterministic and pure: given the same payload, question set, evidence refs
 * and kb id, this returns byte-identical content. Publishing rebuilds the
 * context rather than reusing the one the run produced, because the run's
 * context was bound to a payload the owner has since reviewed.
 */
export function buildGeoSnapshotContextV3(
  input: BuildGeoSnapshotContextV3Input,
): GeoSnapshotContextV3 {
  const payload = parseGeoKbPayloadV3(input.payload);
  const questionSet =
    input.questionSet === null
      ? null
      : parseGeoQuestionSetV2(input.questionSet);
  const targetHost = normalizeAccountWebsiteUrl(
    payload.generationInput.identity.targetUrl,
  )?.host;
  if (targetHost === undefined) throw new Error("Context site mismatch");
  const roles = projectRoles(payload.generationInput.roles);
  const body: GeoSnapshotContextBodyV3 = {
    schemaVersion: GEO_SNAPSHOT_CONTEXT_SCHEMA_V3,
    kbId: input.kbId,
    targetHost,
    payloadHash: geoV2Digest(payload),
    questionSetHash:
      questionSet === null
        ? GEO_ABSENT_QUESTION_SET_HASH
        : geoV2Digest(questionSet),
    // Copied, not re-derived: the frozen version must keep answering with the
    // Profile revision it was generated from, whatever the Profile says later.
    profileRef: payload.generationInput.profileRef satisfies GeoProfileRefV3,
    evidenceRefs: canonicalEvidenceRefs(input.evidenceRefs),
    roles,
    sourceSummary: geoV3SourceSummary(payload.knowledge),
    skippedLayers: LAYERS.filter(
      (layer) => !roles.some((role) => role.eligibleLayers.includes(layer)),
    ),
  };
  return parseGeoSnapshotContextV3({ ...body, contentHash: geoV2Digest(body) });
}

export function isGeoSnapshotContextV3(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    "schemaVersion" in value &&
    (value as { schemaVersion?: unknown }).schemaVersion ===
      GEO_SNAPSHOT_CONTEXT_SCHEMA_V3
  );
}
