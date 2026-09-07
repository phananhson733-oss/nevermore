// @input -- one exact durable manifest, evidence bundle and synthesis response
// @output -- a self-contained, hashed knowledge-generation result
// @pos -- succeeded-result persistence contract; no mutable payload or provider raw data
import { z } from "zod";

import {
  parseGeoKnowledgeEvidenceV1,
  type GeoKnowledgeEvidenceV1,
} from "./kb-knowledge-evidence.ts";
import {
  parseGeoKnowledgeNarrativeV1,
  parseGeoKnowledgeSynthesisInputV1,
  type GeoKnowledgeNarrativeV1,
  type GeoKnowledgeSynthesisInputV1,
} from "./kb-knowledge-synthesis-contract.ts";
import {
  GEO_KNOWLEDGE_GENERATION_INPUT_SCHEMA,
  type GeoKnowledgeGenerationInputManifest,
} from "./kb-prepared-contract.ts";
import { geoSourceReceiptRefSchema } from "./snapshot-context-v2.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { canonicalGeoV2Text, geoV2JsonbBytes } from "./kb-v2-json.ts";

export const GEO_KNOWLEDGE_GENERATION_RESULT_SCHEMA =
  "marketing-geo-knowledge-generation-result.v1" as const;
export const GEO_KNOWLEDGE_GENERATION_RESULT_MAX_BYTES = 2_097_152;

export interface GeoKnowledgeGenerationResultBodyV1 {
  readonly schemaVersion: typeof GEO_KNOWLEDGE_GENERATION_RESULT_SCHEMA;
  readonly generationId: string;
  readonly kbId: string;
  readonly manifest: GeoKnowledgeGenerationInputManifest;
  readonly evidence: GeoKnowledgeEvidenceV1;
  readonly synthesisInput: GeoKnowledgeSynthesisInputV1;
  readonly narrative: GeoKnowledgeNarrativeV1;
  readonly generatedAt: string;
}

export interface GeoKnowledgeGenerationResultV1
  extends GeoKnowledgeGenerationResultBodyV1 {
  readonly contentHash: string;
}

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const canonicalTimestamp = z.string().refine((value) =>
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
"Expected canonical timestamp");
const manifestSchema = z.object({
  schemaVersion: z.literal(GEO_KNOWLEDGE_GENERATION_INPUT_SCHEMA),
  kbId: z.string().uuid(),
  baseDraftVersion: z.string().regex(/^[1-9][0-9]{0,15}$/u)
    .refine((value) => Number.isSafeInteger(Number(value))),
  baseDraftHash: hash,
  profileCopyHash: hash,
  sourceReceiptRefs: z.array(geoSourceReceiptRefSchema).max(32),
  knowledgeSynthesisInput: z.unknown()
    .transform(parseGeoKnowledgeSynthesisInputV1),
}).strict().superRefine((manifest, ctx) => {
  const ids = manifest.sourceReceiptRefs.map(ref => ref.receiptId);
  if (ids.some(id => id !== id.toLocaleLowerCase("en"))) ctx.addIssue({ code: "custom", message: "Source receipt references must be canonical" });
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Duplicate source receipt reference" });
  if (ids.some((id, index) => index > 0 && ids[index - 1]!.localeCompare(id) >= 0)) ctx.addIssue({ code: "custom", message: "Source receipt references must be canonical" });
});
const bodySchema = z.object({
  schemaVersion: z.literal(GEO_KNOWLEDGE_GENERATION_RESULT_SCHEMA),
  generationId: z.string().uuid(),
  kbId: z.string().uuid(),
  manifest: manifestSchema,
  evidence: z.unknown().transform(parseGeoKnowledgeEvidenceV1),
  synthesisInput: z.unknown().transform(parseGeoKnowledgeSynthesisInputV1),
  narrative: z.unknown(),
  generatedAt: canonicalTimestamp,
}).strict();
const resultSchema = bodySchema.extend({ contentHash: hash }).strict();

function same(left: unknown, right: unknown): boolean {
  return canonicalGeoV2Text(left) === canonicalGeoV2Text(right);
}

function parseBody(value: unknown): GeoKnowledgeGenerationResultBodyV1 {
  const parsed = bodySchema.parse(value);
  const narrative = parseGeoKnowledgeNarrativeV1(
    parsed.narrative,
    parsed.synthesisInput,
  );
  const body: GeoKnowledgeGenerationResultBodyV1 = { ...parsed, narrative };
  if (body.manifest.kbId !== body.kbId) {
    throw new Error("Knowledge generation kb scope mismatch");
  }
  if (!same(body.manifest.knowledgeSynthesisInput, body.synthesisInput)) {
    throw new Error("Knowledge generation manifest/synthesis mismatch");
  }
  if (body.synthesisInput.evidenceContentHash !== body.evidence.contentHash) {
    throw new Error("Knowledge generation evidence hash mismatch");
  }
  if (body.synthesisInput.targetUrl !== body.evidence.targetUrl) {
    throw new Error("Knowledge generation evidence target mismatch");
  }
  if (!same(
    body.synthesisInput.confirmedCompetitors,
    body.evidence.confirmedCompetitors,
  )) {
    throw new Error("Knowledge generation competitor evidence mismatch");
  }
  const usableSources = body.evidence.sourceCatalogue.filter(
    (source) => source.availability !== "unavailable",
  );
  if (!same(body.synthesisInput.sourceCatalogue, usableSources)) {
    throw new Error("Knowledge generation evidence source projection mismatch");
  }
  if (Date.parse(body.generatedAt) < Date.parse(body.evidence.collectedAt)) {
    throw new Error("Knowledge generation predates collected evidence");
  }
  return body;
}

export function geoKnowledgeGenerationResultHash(
  body: unknown,
): string {
  return geoV2Digest(body);
}

export function parseGeoKnowledgeGenerationResultV1(
  value: unknown,
): GeoKnowledgeGenerationResultV1 {
  if (geoV2JsonbBytes(value) > GEO_KNOWLEDGE_GENERATION_RESULT_MAX_BYTES) {
    throw new Error("Knowledge generation result exceeds byte limit");
  }
  const parsed = resultSchema.parse(value);
  const { contentHash, ...rawBody } = parsed;
  const body = parseBody(rawBody);
  if (geoKnowledgeGenerationResultHash(body) !== contentHash) {
    throw new Error("Knowledge generation result hash mismatch");
  }
  return { ...body, contentHash };
}

export function buildGeoKnowledgeGenerationResultV1(
  value: unknown,
): GeoKnowledgeGenerationResultV1 {
  const body = parseBody(value);
  return parseGeoKnowledgeGenerationResultV1({
    ...body,
    contentHash: geoKnowledgeGenerationResultHash(body),
  });
}
