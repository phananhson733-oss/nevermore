import { expect, it } from "vitest";
import { geoBriefFixture, geoDraftFixture } from "./geo-fixtures.ts";
import { assembleDraftResult } from "./draft-assemble.ts";
import { parseDraftResult, sectionEvidenceFor } from "./parse-draft.ts";
import { deriveGeoReadiness, geoFingerprint, parseGeoContentBrief } from "./parse-geo-brief.ts";
import { validateSectionOutput } from "./validate-section.ts";
import { CONTENT_BRIEF_HANDOFF_MAX_BYTES, type DraftSection } from "./contract.ts";
import { DRAFT_RESULT_MAX_BYTES, SECTION_BODY_MAX_BYTES, SECTION_MAX_SENTENCES, SECTION_REQUEST_MAX_BYTES, SENTENCE_MAX_CHARS } from "./constants.ts";
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

it("roundtrips ten maximum-body GEO sections and reserves full Brief provenance within existing byte limits", async () => {
  const brief = await geoBriefFixture();
  if (brief.outline.status !== "available") throw new Error("fixture");
  const first = brief.outline.items[0];
  brief.outline.items = [first, ...Array.from({ length: 9 }, (_, index) => ({ ...first, id: `O${index + 2}`, h2: `Supplementary section ${String.fromCharCode(65 + index)}`, answers: index === 0 ? ["Q2"] : [] }))];
  brief.draft_readiness = deriveGeoReadiness(brief); brief.run.fingerprint = await geoFingerprint(brief);
  expect((await parseGeoContentBrief(brief)).ok).toBe(true);
  const seed = await geoDraftFixture(brief);
  const sections: DraftSection[] = seed.sections.map(section => {
    let previous: DraftSection | null = null;
    for (let count = 1; count <= SECTION_MAX_SENTENCES; count++) {
      const checked = validateSectionOutput({ paragraphs: [{ sentences: Array.from({ length: count }, (_, index) => ({ text: `${"a".repeat(SENTENCE_MAX_CHARS - 4)} ${String.fromCharCode(97 + index % 26).repeat(3)}`, claim: "gap" as const, evidence_refs: [] })) }] }, sectionEvidenceFor(brief, section.id, seed.settings));
      if (!checked.ok) throw new Error(checked.rule);
      const candidate: DraftSection = { id: section.id, h2: section.h2, answers: section.answers, status: "ok", body: { word_count: checked.word_count, paragraphs: checked.paragraphs }, llm: { attempts: 1, input_tokens: 10, output_tokens: 10 } };
      if (bytes(candidate) > SECTION_BODY_MAX_BYTES) break;
      previous = candidate;
    }
    if (!previous) throw new Error("fixture section does not fit"); return previous;
  });
  const result = await assembleDraftResult({ run: seed.run, brief, settings: seed.settings, sections, coverage: seed.coverage, llmSections: seed.run.reads.llm_sections, llmCoverage: seed.run.reads.llm_coverage });
  expect((await parseDraftResult(result, brief)).ok).toBe(true);
  expect(result.sections).toHaveLength(10);
  // Reserve an entire maximum-size Brief for the carried provenance, even
  // though only its origin/evidence subset is retained in the real result.
  const withMaximumProvenance = bytes(result) - bytes(result.brief_ref) + CONTENT_BRIEF_HANDOFF_MAX_BYTES;
  expect(withMaximumProvenance).toBeLessThan(DRAFT_RESULT_MAX_BYTES);
  expect(withMaximumProvenance + CONTENT_BRIEF_HANDOFF_MAX_BYTES + 16 * 1024).toBeLessThan(SECTION_REQUEST_MAX_BYTES);
});
