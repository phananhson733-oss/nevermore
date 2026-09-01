// @input -- bounded source catalogues and untrusted role/question model replies
// @output -- semantic candidates with checked IDs, source refs and coverage
// @pos -- no model output becomes observed evidence, review approval or calibration
import { z } from "zod";
import { isBoundedModelText } from "@sf/public-tools/content-brief/text";
export interface GeoSynthesisSource {
  readonly id: string;
  readonly kind: "profile" | "gsc" | "crawl" | "manual";
  readonly text: string;
}
export interface GeoSynthesisRole {
  readonly id: string;
  readonly label: string;
  readonly questionLabel: string;
  readonly segment: string;
  readonly painPoints: readonly string[];
  readonly alternatives: readonly string[];
  readonly decisionCriteria: readonly string[];
  readonly vocabulary: readonly string[];
  readonly evidenceRefs: readonly string[];
}
export interface GeoRoleSynthesisInput {
  readonly officialName: string;
  readonly displayLocale: "en" | "zh";
  readonly questionLanguage: string;
  readonly sources: readonly GeoSynthesisSource[];
}
export interface GeoRoleSynthesis {
  readonly roles: readonly GeoSynthesisRole[];
  readonly categoryTerms: readonly { readonly text: string; readonly evidenceRefs: readonly string[] }[];
}
export interface GeoSynthesisEntity {
  readonly id: string;
  readonly text: string;
  readonly kind: "brand" | "category" | "competitor" | "role_pain" | "role_alternative" | "role_criterion" | "role_vocabulary" | "fact";
  readonly roleId: string | null;
  readonly evidenceRefs: readonly string[];
}
export interface GeoQuestionSynthesisInput {
  readonly officialName: string;
  readonly aliases: readonly string[];
  readonly language: string;
  readonly roles: readonly (Omit<GeoSynthesisRole, "evidenceRefs"> & { readonly evidenceRefs?: readonly string[] })[];
  readonly entities: readonly GeoSynthesisEntity[];
  readonly evidenceSources: readonly GeoSynthesisSource[];
}
export interface GeoQuestionSynthesis {
  readonly entities: readonly { readonly id: string; readonly text: string }[];
  readonly questions: readonly {
    readonly id: string;
    readonly text: string;
    readonly layer: "problem" | "discovery" | "comparison" | "evaluation" | "branded";
    readonly roleId: string | null;
    readonly entityRefs: readonly string[];
    readonly evidenceRefs: readonly string[];
  }[];
}
export type GeoSynthesisParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: "schema_invalid" | "insufficient_basis"; readonly path: string };
export const GEO_SYNTHESIS_LIMITS = { roles: 5, categoryTerms: 8, questions: 30, entities: 120, sources: 256, sourceChars: 32_768, promptBytes: 196_608, responseBytes: 262_144 } as const;

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/u);
const text = (maximum: number) => z.string().max(maximum).refine(value => isBoundedModelText(value, maximum));
const normalized = (value: string) => value.normalize("NFC").toLocaleLowerCase("en").replace(/\s+/gu, " ").trim();
const unique = (values: readonly string[]) => new Set(values.map(normalized)).size === values.length;
const refs = z.array(id).min(1).max(12).refine(unique);
const list = (maximum: number) => z.array(text(80)).max(maximum).refine(unique);
const roleFields = { id: id.max(64), label: text(200), questionLabel: text(120), segment: text(200), painPoints: list(8), alternatives: list(8), decisionCriteria: list(8), vocabulary: list(12) };
const sourceSchema = z.object({ id, kind: z.enum(["profile", "gsc", "crawl", "manual"]), text: z.string().min(1).max(GEO_SYNTHESIS_LIMITS.sourceChars) }).strict();
const sources = z.array(sourceSchema).min(1).max(GEO_SYNTHESIS_LIMITS.sources).refine(rows => unique(rows.map(row => row.id)));
const roleInput = z.object({ officialName: text(200), displayLocale: z.enum(["en", "zh"]), questionLanguage: text(32), sources }).strict();
const roleOutput = z.object({ roles: z.array(z.object({ ...roleFields, evidenceRefs: refs }).strict()).max(5), categoryTerms: z.array(z.object({ text: text(80), evidenceRefs: refs }).strict()).max(8) }).strict();
const entityKind = z.enum(["brand", "category", "competitor", "role_pain", "role_alternative", "role_criterion", "role_vocabulary", "fact"]);
const questionInput = z.object({
  officialName: text(200), aliases: z.array(text(80)).max(12), language: text(32),
  roles: z.array(z.object({ ...roleFields, segment: z.union([z.literal(""), text(200)]), evidenceRefs: refs.optional() }).strict()).max(5),
  entities: z.array(z.object({ id, text: text(200), kind: entityKind, roleId: id.max(64).nullable(), evidenceRefs: refs }).strict()).min(1).max(120),
  evidenceSources: sources,
}).strict();
const questionOutput = z.object({
  entities: z.array(z.object({ id, text: text(200) }).strict()).min(1).max(120),
  questions: z.array(z.object({ id, text: text(300), layer: z.enum(["problem", "discovery", "comparison", "evaluation", "branded"]), roleId: id.max(64).nullable(), entityRefs: refs, evidenceRefs: refs }).strict()).min(2).max(30),
}).strict();
const invalid = (path: string): GeoSynthesisParseResult<never> => ({ ok: false, reason: "schema_invalid", path });
const issuePath = (error: z.ZodError) => error.issues[0]?.path.join(".") ?? "";
const knownRefs = (references: readonly string[], catalogue: ReadonlyMap<string, unknown>) => references.every(reference => catalogue.has(reference));
const numericLiterals = (value: string) => value.match(/[+-]?(?:[$€£¥]\s*)?\p{N}+(?:[.,:/-]\p{N}+)*(?:\s*[%％])?/gu) ?? [];
const numbersSupported = (values: readonly string[], evidence: readonly string[]) => {
  const allowed = new Set(evidence.flatMap(numericLiterals));
  return values.flatMap(numericLiterals).every(literal => allowed.has(literal));
};
const looksEnglish = (value: string) => /[A-Za-z]/u.test(value);
const clusterLabel = (value: string) => /^(?:queries?\s+about\b|search[- ]query\s+cluster\b|关于.+的查询|.+查询聚类)/iu.test(value);
const ROLE_ANCHOR_FUNCTION_WORDS = new Set(["a", "an", "the", "of", "to", "for"]);
function roleAnchorTokens(value: string): readonly string[] {
  return (value.normalize("NFC").toLocaleLowerCase("en").match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter(token => !ROLE_ANCHOR_FUNCTION_WORDS.has(token));
}
/** Deterministic English phrasing tolerance, not fuzzy semantic matching.
 * Content tokens must remain exact, ordered and contiguous after only the
 * fixed function words above are removed. Non-English/empty content retains
 * the historical exact normalized substring rule. */
function containsRoleAnchor(question: string, phrase: string): boolean {
  const expected = roleAnchorTokens(phrase);
  if (expected.length === 0 || !/[A-Za-z]/u.test(phrase)) return normalized(question).includes(normalized(phrase));
  const actual = roleAnchorTokens(question);
  return actual.some((_token, start) => expected.every((token, offset) => actual[start + offset] === token));
}

export function parseGeoRoleSynthesisInput(value: unknown): GeoSynthesisParseResult<GeoRoleSynthesisInput> {
  const parsed = roleInput.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data } : invalid(issuePath(parsed.error));
}

/** IDs and actual source membership are checked before model work as well. */
export function parseGeoQuestionSynthesisInput(value: unknown): GeoSynthesisParseResult<GeoQuestionSynthesisInput> {
  const parsed = questionInput.safeParse(value);
  if (!parsed.success) return invalid(issuePath(parsed.error));
  const input = parsed.data;
  if (!unique(input.roles.map(role => role.id)) || !unique(input.entities.map(entity => entity.id))) return invalid("input.ids");
  const sourceMap = new Map(input.evidenceSources.map(source => [source.id, source]));
  const roleMap = new Map(input.roles.map(role => [role.id, role]));
  for (const role of input.roles) if (role.evidenceRefs && !knownRefs(role.evidenceRefs, sourceMap)) return invalid("input.roles.evidenceRefs");
  const roleField = { role_pain: "painPoints", role_alternative: "alternatives", role_criterion: "decisionCriteria", role_vocabulary: "vocabulary" } as const;
  for (const entity of input.entities) {
    if (!knownRefs(entity.evidenceRefs, sourceMap) || (entity.roleId !== null && !roleMap.has(entity.roleId))) return invalid("input.entities.references");
    if (entity.kind in roleField) {
      const role = entity.roleId === null ? undefined : roleMap.get(entity.roleId);
      const field = roleField[entity.kind as keyof typeof roleField];
      if (!role || !role[field].some(value => normalized(value) === normalized(entity.text))) return invalid("input.entities.role");
    }
    if (entity.kind === "brand" && ![input.officialName, ...input.aliases].includes(entity.text)) return invalid("input.entities.brand");
  }
  if (!input.entities.some(entity => entity.kind === "brand") || !input.entities.some(entity => entity.kind === "category")) return invalid("input.entities.coverage");
  for (const role of input.roles) for (const [kind, field] of Object.entries(roleField)) {
    if (role[field].length && !input.entities.some(entity => entity.kind === kind && entity.roleId === role.id)) return invalid("input.entities.role_coverage");
  }
  return { ok: true, value: input };
}

export function parseGeoRoleSynthesis(raw: unknown, input: GeoRoleSynthesisInput): GeoSynthesisParseResult<GeoRoleSynthesis> {
  if (!parseGeoRoleSynthesisInput(input).ok) return invalid("input");
  const parsed = roleOutput.safeParse(raw);
  if (!parsed.success) return invalid(issuePath(parsed.error));
  const value = parsed.data;
  if (!value.roles.length || !value.categoryTerms.length) return { ok: false, reason: "insufficient_basis", path: !value.roles.length ? "roles" : "categoryTerms" };
  if (!unique(value.roles.map(role => role.id)) || !unique(value.roles.map(role => role.questionLabel)) || !unique(value.categoryTerms.map(term => term.text))) return invalid("duplicate");
  const sourceMap = new Map(input.sources.map(source => [source.id, source]));
  for (const role of value.roles) {
    if (!knownRefs(role.evidenceRefs, sourceMap)) return invalid("roles.evidenceRefs");
    if (!looksEnglish(role.questionLabel) || clusterLabel(role.questionLabel) || clusterLabel(role.label)) return invalid("roles.questionLabel");
    if (role.alternatives.some(alternative => /^(?:hypothesis\s*:|假设\s*[:：])/iu.test(alternative))) return invalid("roles.alternatives");
    const words = [role.label, role.questionLabel, role.segment, ...role.painPoints, ...role.alternatives, ...role.decisionCriteria, ...role.vocabulary];
    if (!numbersSupported(words, [input.officialName, ...role.evidenceRefs.map(ref => sourceMap.get(ref)!.text)])) return invalid("roles.numeric_claim");
  }
  for (const term of value.categoryTerms) {
    if (!knownRefs(term.evidenceRefs, sourceMap) || !looksEnglish(term.text)) return invalid("categoryTerms.evidenceRefs");
    if (!numbersSupported([term.text], [input.officialName, ...term.evidenceRefs.map(ref => sourceMap.get(ref)!.text)])) return invalid("categoryTerms.numeric_claim");
  }
  return { ok: true, value };
}

export function parseGeoQuestionSynthesis(raw: unknown, input: GeoQuestionSynthesisInput): GeoSynthesisParseResult<GeoQuestionSynthesis> {
  if (!parseGeoQuestionSynthesisInput(input).ok) return invalid("input");
  const parsed = questionOutput.safeParse(raw);
  if (!parsed.success) return invalid(issuePath(parsed.error));
  const value = parsed.data;
  if (!unique(value.entities.map(entity => entity.id)) || !unique(value.questions.map(question => question.id)) || !unique(value.questions.map(question => question.text))) return invalid("duplicate");
  const known = new Map(input.entities.map(entity => [entity.id, entity]));
  const returned = new Map(value.entities.map(entity => [entity.id, entity]));
  const sourcesById = new Map(input.evidenceSources.map(source => [source.id, source]));
  const rolesById = new Map(input.roles.map(role => [role.id, role]));
  for (const entity of value.entities) {
    const original = known.get(entity.id);
    if (!original) return invalid("entities.id");
    if ((original.kind === "brand" || original.kind === "competitor" || (original.kind === "fact" && numericLiterals(original.text).length > 0)) && entity.text !== original.text) return invalid("entities.literal");
    if (!numbersSupported([entity.text], [original.text, ...original.evidenceRefs.map(ref => sourcesById.get(ref)!.text)])) return invalid("entities.numeric_claim");
  }
  const uses = (question: GeoQuestionSynthesis["questions"][number], kind: GeoSynthesisEntity["kind"]) => question.entityRefs.some(ref => {
    const original = known.get(ref), translated = returned.get(ref);
    if (original?.kind !== kind || translated === undefined) return false;
    return ["role_pain", "role_criterion", "role_alternative"].includes(kind)
      ? containsRoleAnchor(question.text, translated.text)
      : normalized(question.text).includes(normalized(translated.text));
  });
  for (const question of value.questions) {
    if (!looksEnglish(question.text) || !knownRefs(question.entityRefs, returned) || !knownRefs(question.evidenceRefs, sourcesById)) return invalid("questions.references");
    if (question.roleId !== null && !rolesById.has(question.roleId)) return invalid("questions.roleId");
    for (const ref of question.entityRefs) {
      const entity = known.get(ref)!;
      if ((entity.roleId !== null && entity.roleId !== question.roleId) || !entity.evidenceRefs.every(source => question.evidenceRefs.includes(source))) return invalid("questions.entity_scope");
    }
    if (!numbersSupported([question.text], [...question.entityRefs.map(ref => returned.get(ref)!.text), ...question.evidenceRefs.map(ref => sourcesById.get(ref)!.text)])) return invalid("questions.numeric_claim");
    const role = question.roleId === null ? undefined : rolesById.get(question.roleId);
    if (question.layer === "problem" && (!role?.painPoints.length || !uses(question, "role_pain"))) return invalid("questions.pain_anchor");
    if (question.layer === "evaluation" && (!role?.decisionCriteria.length || !uses(question, "role_criterion"))) return invalid("questions.criterion_anchor");
    if (question.layer === "discovery" && !uses(question, "category")) return invalid("questions.category_anchor");
    if (question.layer === "branded" && !uses(question, "brand")) return invalid("questions.brand_anchor");
    if (question.layer === "comparison" && !uses(question, "role_alternative") && !uses(question, "competitor")) return invalid("questions.comparison_anchor");
  }
  if (!["discovery", "branded"].every(layer => value.questions.some(question => question.layer === layer && question.roleId === null))) return invalid("questions.global_coverage");
  for (const role of input.roles) {
    if (role.painPoints.length && !value.questions.some(question => question.roleId === role.id && question.layer === "problem" && uses(question, "role_pain"))) return invalid("questions.role_pain_coverage");
    if (role.decisionCriteria.length && !value.questions.some(question => question.roleId === role.id && question.layer === "evaluation" && uses(question, "role_criterion"))) return invalid("questions.role_criterion_coverage");
    if (role.alternatives.length && !value.questions.some(question => question.roleId === role.id && question.layer === "comparison" && uses(question, "role_alternative"))) return invalid("questions.role_alternative_coverage");
  }
  if (input.entities.some(entity => entity.kind === "competitor") && !value.questions.some(question => question.layer === "comparison" && uses(question, "competitor"))) return invalid("questions.competitor_coverage");
  return { ok: true, value };
}
