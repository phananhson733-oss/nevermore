// @input  -- one section the model wrote, and the evidence ledger it was allowed to cite
// @output -- the section's sentences with server-derived support counts, or the first rule it broke
// @pos    -- the only claim/reference validator; nothing here rewrites a claim (Owner ruling 6)
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { SECTION_MAX_SENTENCES, SENTENCE_MAX_CHARS } from "./constants.ts";
import type { ClaimState, ModelSectionOutput, ProfileFact, Sentence } from "./contract.ts";
import type { GeoFactEvidence } from "./geo-contract.ts";
import { checkGeoFactSupport, type GeoFactSupportFailure, type GeoMissingFact } from "./geo-fact-support.ts";
import { boundedModelText } from "./text.ts";

/**
 * Why validation fails the whole section instead of fixing a sentence.
 *
 * A claim state is the model's assertion about its own evidence. Downgrading
 * a `bound` sentence to `gap` because its references were bad would be the
 * server rewriting what the model claimed, and the page would then present a
 * corrected claim as if the model had made it. The contract forbids that; the
 * handler retries once and otherwise reports the section as failed.
 */

export interface SectionEvidence {
  /** CrawlObservation ids that carried at least one excerpt — the only C* a bound claim may cite. */
  readonly citableCrawlIds: ReadonlySet<string>;
  readonly profileFacts: ReadonlyMap<string, ProfileFact>;
  /** True only for the section that received the gap angle; a `stance` anywhere else is refused. */
  readonly stanceAllowed: boolean;
  readonly geoFacts?: ReadonlyMap<string, GeoFactEvidence>;
  readonly geoMissingFacts?: readonly GeoMissingFact[];
}

export type SectionValidation =
  | { readonly ok: true; readonly paragraphs: { sentences: Sentence[] }[]; readonly word_count: number }
  | { readonly ok: false; readonly path: string; readonly rule: SectionRule };

export type SectionRule =
  | GeoFactSupportFailure
  | "empty_section"
  | "too_many_sentences"
  | "sentence_text"
  | "claim_unknown"
  | "bound_without_refs"
  | "refs_must_be_empty"
  | "ref_unknown"
  | "ref_not_citable"
  | "ref_repeated"
  | "stance_needs_profile_fact"
  | "stance_outside_gap_angle"
  | "bound_cannot_cite_inferred";

const CLAIMS: ReadonlySet<string> = new Set<ClaimState>(["bound", "gap", "no_claim", "stance"]);

function fail(path: string, rule: SectionRule): SectionValidation {
  return { ok: false, path, rule };
}

/** Whitespace tokenizer, the same one LengthField uses. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

export function validateSectionOutput(
  output: ModelSectionOutput,
  evidence: SectionEvidence,
): SectionValidation {
  const paragraphs: { sentences: Sentence[] }[] = [];
  let sentenceCount = 0;
  let wordCount = 0;
  for (const [pIndex, paragraph] of output.paragraphs.entries()) {
    const sentences: Sentence[] = [];
    for (const [sIndex, raw] of paragraph.sentences.entries()) {
      const path = `paragraphs[${pIndex}].sentences[${sIndex}]`;
      sentenceCount += 1;
      if (sentenceCount > SECTION_MAX_SENTENCES) return fail(path, "too_many_sentences");
      const text = boundedModelText(raw.text, SENTENCE_MAX_CHARS);
      if (!text.ok) return fail(`${path}.text`, "sentence_text");
      if (!CLAIMS.has(raw.claim)) return fail(`${path}.claim`, "claim_unknown");
      const refs = raw.evidence_refs;
      const seen = new Set<string>();
      for (const [rIndex, ref] of refs.entries()) {
        const refPath = `${path}.evidence_refs[${rIndex}]`;
        if (seen.has(ref)) return fail(refPath, "ref_repeated");
        seen.add(ref);
        if (evidence.geoFacts !== undefined) {
          if (!evidence.geoFacts.has(ref)) return fail(refPath, "ref_not_citable");
          continue;
        }
        const isCrawl = ref.startsWith("C");
        const isFact = ref.startsWith("P");
        if (isCrawl) {
          if (!evidence.citableCrawlIds.has(ref)) return fail(refPath, "ref_not_citable");
        } else if (isFact) {
          if (!evidence.profileFacts.has(ref)) return fail(refPath, "ref_unknown");
        } else {
          return fail(refPath, "ref_unknown");
        }
      }
      switch (raw.claim) {
        case "bound": {
          if (refs.length === 0) return fail(`${path}.evidence_refs`, "bound_without_refs");
          for (const [rIndex, ref] of refs.entries()) {
            const fact = evidence.profileFacts.get(ref);
            if (fact !== undefined && fact.derivation === "inferred") {
              return fail(`${path}.evidence_refs[${rIndex}]`, "bound_cannot_cite_inferred");
            }
          }
          break;
        }
        case "stance": {
          if (!evidence.stanceAllowed) return fail(`${path}.claim`, "stance_outside_gap_angle");
          if (refs.length === 0 || refs.some((ref) => !ref.startsWith("P"))) {
            return fail(`${path}.evidence_refs`, "stance_needs_profile_fact");
          }
          break;
        }
        case "gap":
        case "no_claim": {
          if (refs.length > 0) return fail(`${path}.evidence_refs`, "refs_must_be_empty");
          break;
        }
        default:
          return fail(`${path}.claim`, "claim_unknown");
      }
      if (evidence.geoFacts !== undefined) { const support = checkGeoFactSupport({ ...raw, text: text.value }, evidence.geoFacts, evidence.geoMissingFacts); if (support !== null) return fail(`${path}.text`, support); }
      const supportCount = refs.filter((ref) => ref.startsWith("C")).length;
      wordCount += countWords(text.value);
      const sources: Sentence["sources"] = refs.length === 0 ? ["model"] : [...new Set(refs.map(ref => evidence.geoFacts?.get(ref)?.source ?? "model"))];
      sentences.push({ text: text.value, claim: raw.claim, evidence_refs: [...refs], support_count: supportCount, ...(evidence.geoFacts === undefined ? {} : { sources }) });
    }
    if (sentences.length > 0) paragraphs.push({ sentences });
  }
  if (sentenceCount === 0) return fail("paragraphs", "empty_section");
  return { ok: true, paragraphs, word_count: wordCount };
}
