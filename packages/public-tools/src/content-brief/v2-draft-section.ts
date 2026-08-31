// @input -- untrusted section text and its server-built v2 evidence scope
// @output -- exact confirmed H3 structure, claim annotations, supporting-page counts and truthful length
// @pos -- Draft v2 sentence boundary; PAA units never become factual evidence
import { canonicalize } from "./canonical.ts";
import { SECTION_BODY_MAX_BYTES, SECTION_MAX_SENTENCES, SENTENCE_MAX_CHARS } from "./constants.ts";
import type { ClaimState, ProfileFact } from "./contract.ts";
import {
  array, byteLength, invalid, isRecord, modelText, nullable, object, ok, oneOf, reference,
  type Decoded, type Decoder,
} from "./parse-brief-shape.ts";
import { RESEARCH_HEADING_MAX_CHARS, measureResearchLength, type ResearchLength } from "./v2-contract.ts";
import { briefV2PageKey } from "./v2-generation.ts";

/** Built only from an already parsed confirmed Brief, never from a request-provided map. */
export interface DraftV2SectionEvidence {
  readonly page_units: ReadonlyMap<string, { readonly page_ref: string; readonly final_url: string }>;
  readonly facts: ReadonlyMap<string, ProfileFact>;
  readonly stance_allowed: boolean;
  /** Exact effective confirmed H3 sequence; standalone validation defaults to no H3. */
  readonly allowed_h3?: readonly string[];
}

export interface DraftV2SectionBody {
  /** Sentence text only; confirmed H2/H3 headings are excluded from this measure. */
  readonly length: ResearchLength;
  readonly paragraphs: readonly { readonly heading: string | null; readonly sentences: readonly DraftV2Sentence[] }[];
}

export interface DraftV2Sentence {
  readonly text: string;
  readonly claim: ClaimState;
  /** U ids of scoped page excerpts or P ids of scoped profile facts; never PAA units. */
  readonly evidence_refs: readonly string[];
  /** Distinct observed supporting pages, including an owned rewrite target; not a competitor count. */
  readonly support_count: number;
}

const count: Decoder<number> = (input, path) =>
  typeof input === "number" && Number.isSafeInteger(input) && input >= 0 ? ok(input) : invalid(path);
const evidenceRef: Decoder<string> = (input, path) =>
  typeof input === "string" && /^(U|P)[1-9][0-9]*$/u.test(input) ? ok(input) : invalid(path);
const claim = oneOf(["bound", "gap", "no_claim", "stance"] as const);
const refs = array(evidenceRef, { max: 100, unique: true });
const normalizedText = (max: number): Decoder<string> => (input, path) => {
  if (typeof input !== "string") return invalid(path);
  return modelText(max)(input.replace(/\s+/gu, " ").trim(), path);
};
const modelParagraph = object({
  heading: nullable(normalizedText(RESEARCH_HEADING_MAX_CHARS)),
  sentences: array(object({ text: normalizedText(SENTENCE_MAX_CHARS), claim, evidence_refs: refs }), { min: 1, max: SECTION_MAX_SENTENCES }),
});
const modelBody = object({
  paragraphs: array((input, path) => modelParagraph(
    isRecord(input) && !Object.hasOwn(input, "heading") ? { ...input, heading: null } : input, path,
  ), { min: 1, max: SECTION_MAX_SENTENCES }),
});
const frozenBody = object({
  length: object({ value: count, unit: oneOf(["words", "non_whitespace_characters"] as const), tokenizer: oneOf(["whitespace", "unicode_code_points"] as const) }),
  paragraphs: array(object({
    heading: nullable(modelText(RESEARCH_HEADING_MAX_CHARS)),
    sentences: array(object({ text: modelText(SENTENCE_MAX_CHARS), claim, evidence_refs: refs, support_count: count }), { min: 1, max: SECTION_MAX_SENTENCES }),
  }), { min: 1, max: SECTION_MAX_SENTENCES }),
});
function fits(input: unknown): boolean {
  const bytes = byteLength(input);
  return bytes !== null && bytes <= SECTION_BODY_MAX_BYTES;
}

export function validateDraftV2Section(input: unknown, scope: DraftV2SectionEvidence, language: string): Decoded<DraftV2SectionBody> {
  if (!fits(input)) return invalid("body.bytes");
  const decoded = modelBody(input, "");
  if (!decoded.ok) return decoded;
  if (decoded.value.paragraphs.reduce((sum, paragraph) => sum + paragraph.sentences.length, 0) > SECTION_MAX_SENTENCES) return invalid("paragraphs");
  const headings = decoded.value.paragraphs.map((paragraph) => paragraph.heading).filter((heading) => heading !== null);
  const allowed = scope.allowed_h3 ?? [];
  if (headings.length !== allowed.length || headings.some((heading, index) => heading !== allowed[index])) return reference("paragraphs.heading");
  const paragraphs: { heading: string | null; sentences: DraftV2Sentence[] }[] = [];
  for (const [pIndex, paragraph] of decoded.value.paragraphs.entries()) {
    const sentences: DraftV2Sentence[] = [];
    for (const [sIndex, sentence] of paragraph.sentences.entries()) {
      const path = "paragraphs[" + pIndex + "].sentences[" + sIndex + "]";
      const pages = new Set<string>();
      for (const ref of sentence.evidence_refs) {
        const unit = scope.page_units.get(ref);
        if (unit !== undefined) {
          const identity = briefV2PageKey(unit.final_url);
          if (identity === null) return reference(path + ".evidence_refs");
          pages.add(identity);
        } else if (!scope.facts.has(ref)) return reference(path + ".evidence_refs");
      }
      if (sentence.claim === "bound") {
        if (sentence.evidence_refs.length === 0 || sentence.evidence_refs.some((ref) => scope.facts.get(ref)?.derivation === "inferred")) return reference(path + ".evidence_refs");
      } else if (sentence.claim === "stance") {
        if (!scope.stance_allowed || sentence.evidence_refs.length === 0 ||
            sentence.evidence_refs.some((ref) => !scope.facts.has(ref))) return reference(path + ".claim");
      } else if (sentence.evidence_refs.length !== 0) return reference(path + ".evidence_refs");
      sentences.push({ ...sentence, evidence_refs: [...sentence.evidence_refs], support_count: pages.size });
    }
    paragraphs.push({ heading: paragraph.heading, sentences });
  }
  const text = paragraphs.flatMap((paragraph) => paragraph.sentences.map((sentence) => sentence.text)).join(" ");
  const value = { paragraphs, length: measureResearchLength(text, language) };
  return fits(value) ? ok(value) : invalid("body.bytes");
}

/** Imported support counts and length are re-derived, not trusted after a new checksum. */
export function parseDraftV2SectionBody(input: unknown, scope: DraftV2SectionEvidence, language: string): Decoded<DraftV2SectionBody> {
  if (!fits(input)) return invalid("body.bytes");
  const decoded = frozenBody(input, "");
  if (!decoded.ok) return decoded;
  const rebuilt = validateDraftV2Section({
    paragraphs: decoded.value.paragraphs.map((paragraph) => ({
      heading: paragraph.heading,
      sentences: paragraph.sentences.map(({ support_count: _count, ...sentence }) => sentence),
    })),
  }, scope, language);
  if (!rebuilt.ok) return rebuilt;
  return canonicalize(rebuilt.value) === canonicalize(decoded.value) ? decoded : reference("body");
}
