// @input -- exact semantic/registry questions and server-bound evidence catalogs
// @output -- v2 questions retaining provenance; semantic wording never gains calibration
// @pos -- versioned question contract; historical v1 wording is never regenerated
import { z } from "zod";
import type { GeoQuestion, GeoQuestionSet } from "./kb-questions.ts";
import { geoEvidenceRefSchema } from "./kb-v2-contract.ts";
import { canonicalGeoV2Text, geoV2JsonbBytes } from "./kb-v2-json.ts";

export const GEO_QUESTION_SET_SCHEMA_VERSION_V2 = "marketing-geo-question-set.v2" as const;
export const GEO_QUESTION_SET_V2_MAX_BYTES = 262_144;
export const geoQuestionEntityKindSchema = z.enum(["brand", "category", "role_pain", "role_criterion", "role_vocabulary", "role_alternative", "fact", "competitor"]);
export interface GeoQuestionEntityV2 { readonly id: string; readonly text: string; readonly kind: z.infer<typeof geoQuestionEntityKindSchema>; readonly roleId: string | null; readonly evidenceRefs: readonly string[] }
export interface GeoQuestionV2 extends GeoQuestion { readonly provenance: { readonly kind: "semantic" | "registry"; readonly generatorVersion: string; readonly evidenceRefs: readonly string[]; readonly entityRefs: readonly string[] } }
export interface GeoQuestionSetV2 extends Omit<GeoQuestionSet, "schemaVersion" | "questions"> {
  readonly schemaVersion: typeof GEO_QUESTION_SET_SCHEMA_VERSION_V2;
  readonly methodVersion: string; readonly evidenceRefs: readonly string[];
  readonly entityCatalog: readonly GeoQuestionEntityV2[];
  readonly questions: readonly GeoQuestionV2[];
}
export type AnyGeoQuestionSet = GeoQuestionSet | GeoQuestionSetV2;

const uniqueRefs = (max: number) => z.array(geoEvidenceRefSchema).max(max).refine(values => new Set(values).size === values.length);
const entity = z.object({ id: geoEvidenceRefSchema, text: z.string().min(1).max(200), kind: geoQuestionEntityKindSchema, roleId: z.string().min(1).max(64).nullable(), evidenceRefs: uniqueRefs(32).min(1) }).strict();
const question = z.object({ id: z.string().min(1).max(128), text: z.string().min(1).max(300), layer: z.enum(["problem", "discovery", "comparison", "evaluation", "branded"]), mode: z.enum(["retrieval", "demand"]), roleId: z.string().min(1).max(64).nullable(), requiredEntities: z.array(z.string().min(1).max(200)).max(32), templateId: z.string().min(1).max(128).nullable(), calibrated: z.boolean(), provenance: z.object({ kind: z.enum(["semantic", "registry"]), generatorVersion: z.string().min(1).max(128), evidenceRefs: uniqueRefs(32), entityRefs: uniqueRefs(32) }).strict() }).strict();
const schema = z.object({ schemaVersion: z.literal(GEO_QUESTION_SET_SCHEMA_VERSION_V2), registryVersion: z.string().min(1).max(128), methodVersion: z.string().min(1).max(128), language: z.string().regex(/^[a-z]{2}(-[a-z]{2})?$/u), country: z.string().regex(/^[A-Z]{2}$/u), evidenceRefs: uniqueRefs(256), entityCatalog: z.array(entity).max(256), questions: z.array(question).min(1).max(200) }).strict();
export function parseGeoQuestionSetV2(value: unknown): GeoQuestionSetV2 {
  if (geoV2JsonbBytes(value) > GEO_QUESTION_SET_V2_MAX_BYTES) throw new Error("Question set exceeds byte limit");
  const parsed = schema.parse(value);
  const evidence = new Set(parsed.evidenceRefs), entities = new Map(parsed.entityCatalog.map(item => [item.id, item]));
  if (entities.size !== parsed.entityCatalog.length || new Set(parsed.questions.map(item => item.id)).size !== parsed.questions.length) throw new Error("Duplicate question/entity identity");
  for (const item of parsed.entityCatalog) {
    if (item.evidenceRefs.some(ref => !evidence.has(ref)) || (item.kind.startsWith("role_") && item.roleId === null)) throw new Error("Entity evidence/role mismatch");
  }
  for (const q of parsed.questions) {
    if (q.provenance.kind === "semantic" ? q.mode !== "demand" || q.calibrated || q.templateId !== null || q.provenance.evidenceRefs.length === 0 || q.provenance.generatorVersion !== parsed.methodVersion : !q.calibrated || q.templateId === null || parsed.registryVersion === "none" || q.provenance.generatorVersion !== parsed.registryVersion) throw new Error("Invalid calibration authority");
    if (q.provenance.evidenceRefs.some(ref => !evidence.has(ref))) throw new Error("Unknown question evidence");
    const selected = q.provenance.entityRefs.map(ref => entities.get(ref));
    if (selected.some(item => item === undefined || (item.roleId !== null && item.roleId !== q.roleId))) throw new Error("Unknown or foreign role entity");
    if (canonicalGeoV2Text(q.requiredEntities) !== canonicalGeoV2Text(selected.map(item => item!.text))) throw new Error("Required entities differ from source catalog");
  }
  return parsed;
}
/** Prepare-time admission only. Never regenerate templates in a historical read. */
export function assertRegistryQuestionsMatch(set: GeoQuestionSetV2, registry: GeoQuestionSet): void {
  for (const q of set.questions.filter(item => item.provenance.kind === "registry")) {
    const { provenance, ...common } = q;
    const original = registry.questions.find(item => item.id === q.id);
    if (set.registryVersion !== registry.registryVersion || provenance.generatorVersion !== registry.registryVersion || original === undefined || canonicalGeoV2Text(original) !== canonicalGeoV2Text(common)) throw new Error("Question is not the exact calibrated registry rendering");
  }
}
