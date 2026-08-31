// @input -- frozen v2 page/PAA evidence and untrusted model research output
// @output -- independently validated source bindings and server-derived research fields
// @pos -- v2 research core; legacy v1 lexical parsing remains unchanged
import { canonicalize } from "./canonical.ts";
import {
  array, at, byteLength, identifier, invalid, literal, modelText, nullable, object, ok, oneOf, reference, tagged, timestamp,
  type Decoded, type Decoder, type ParseBriefFailure,
} from "./parse-brief-shape.ts";
import {
  RESEARCH_BUNDLE_MAX_BYTES, RESEARCH_HEADING_MAX_CHARS, RESEARCH_OUTLINE_MAX, RESEARCH_PAGE_UNITS_MAX,
  RESEARCH_PAA_MAX, RESEARCH_QUESTION_MAX, RESEARCH_QUESTION_MAX_CHARS, RESEARCH_SEGMENT_MAX_CHARS,
  RESEARCH_SEGMENTS_PER_PAGE, measureResearchLength,
  type ModelResearchOutput, type ResearchBundle, type ResearchOutlineItem, type ResearchPage,
  type ResearchPaaQuestion, type ResearchQuestion, type ResearchResult, type ResearchUnit,
} from "./v2-contract.ts";

const bool: Decoder<boolean> = (input, path) => typeof input === "boolean" ? ok(input) : invalid(path);
const count = (max = 1_000_000): Decoder<number> => (input, path) =>
  typeof input === "number" && Number.isSafeInteger(input) && input >= 0 && input <= max ? ok(input) : invalid(path);
const sourceText = (max: number): Decoder<string> => (input, path) =>
  typeof input === "string" && input.trim() !== "" &&
  Array.from(input).length <= max ? ok(input) : invalid(path);
const hash: Decoder<string> = (input, path) =>
  typeof input === "string" && /^[a-f0-9]{64}$/u.test(input) ? ok(input) : invalid(path);
const url: Decoder<string> = (input, path) => {
  if (typeof input !== "string" || input.length > 2048) return invalid(path);
  try {
    const parsed = new URL(input);
    return ["http:", "https:"].includes(parsed.protocol) && parsed.hostname !== "" &&
      parsed.username === "" && parsed.password === "" && parsed.href.length <= 2048 ? ok(input) : invalid(path);
  } catch { return invalid(path); }
};
const heading = nullable(object({ level: oneOf(["h2", "h3"] as const), text: sourceText(RESEARCH_HEADING_MAX_CHARS) }));
const pageShape: Decoder<ResearchPage> = object({
  id: sourceText(32), role: oneOf(["competitor", "owned"] as const), url, final_url: url, fetched_at: timestamp,
  content_hash: hash, body_complete: bool,
  research: object({
    segments: array(object({ heading, text: sourceText(RESEARCH_SEGMENT_MAX_CHARS), truncated: bool }), { max: RESEARCH_SEGMENTS_PER_PAGE }),
    segments_total: count(), omitted_segments: count(),
    length: object({ value: count(10_000_000), unit: oneOf(["words", "non_whitespace_characters"] as const), tokenizer: oneOf(["whitespace", "unicode_code_points"] as const) }),
  }),
});
const paaId: Decoder<string> = (input, path) =>
  typeof input === "string" && /^A(?:[1-9][0-9]?|100)$/u.test(input) ? ok(input) : invalid(path);
const paaShape: Decoder<ResearchPaaQuestion> = object({ id: paaId, question: sourceText(512), seed_question: nullable(sourceText(512)) });
const unitShape: Decoder<ResearchUnit> = tagged("kind", {
  page: object({ id: identifier("U"), kind: literal("page"), page_ref: sourceText(32), segment_index: count(RESEARCH_SEGMENTS_PER_PAGE - 1) }),
  paa: object({ id: identifier("U"), kind: literal("paa"), paa_ref: paaId }),
});
const bundleShape: Decoder<ResearchBundle> = object({
  pages: array(pageShape, { max: 13 }), paa: array(paaShape, { max: RESEARCH_PAA_MAX }),
  units: array(unitShape, { max: RESEARCH_PAGE_UNITS_MAX + RESEARCH_PAA_MAX }),
  budget: object({
    page_units_available: count(13_000_000), page_units_retained: count(RESEARCH_PAGE_UNITS_MAX), page_units_omitted: count(13_000_000),
    paa_available: count(100), paa_retained: count(RESEARCH_PAA_MAX), paa_duplicates: count(100), paa_omitted: count(100),
  }),
});

function checkPages(pages: readonly ResearchPage[]): ParseBriefFailure | null {
  const seen = new Set<string>();
  let competitors = 0;
  let owned = 0;
  for (const [index, page] of pages.entries()) {
    const path = `pages[${index}]`;
    const pattern = page.role === "owned" ? /^T[1-3]$/u : /^C(?:[1-9]|10)$/u;
    if (!pattern.test(page.id) || seen.has(page.id)) return reference(`${path}.id`);
    seen.add(page.id);
    if (page.role === "owned") owned += 1; else competitors += 1;
    const value = page.research;
    if (value.segments_total !== value.segments.length + value.omitted_segments) return reference(`${path}.research.omitted_segments`);
    if ((value.length.unit === "words") !== (value.length.tokenizer === "whitespace")) return reference(`${path}.research.length`);
    // The full observation is not reconstructable, but it cannot be shorter
    // than its retained disjoint excerpts or contradict a visible script.
    const retainedText = value.segments.map((segment) => segment.text).join(" ");
    const minimum = measureResearchLength(retainedText, value.length.unit === "words" ? "en" : "zh");
    const headingMeasure = measureResearchLength(value.segments.map((segment) => segment.heading?.text ?? "").join(" "), "en");
    if (minimum.unit !== value.length.unit || minimum.value > value.length.value ||
        (value.length.unit === "words" && headingMeasure.unit !== "words")) return reference(`${path}.research.length`);
  }
  return competitors > 10 || owned > 3 ? reference("pages") : null;
}

function paaKey(question: string): string {
  return question.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function compareSourceId(a: { readonly id: string }, b: { readonly id: string }): number {
  const prefix = a.id.charCodeAt(0) - b.id.charCodeAt(0);
  return prefix || Number(a.id.slice(1)) - Number(b.id.slice(1));
}

/** A prefix of each page is sampled round-robin, not all of page one first. */
function pageUnits(pages: readonly ResearchPage[], limit: number): ResearchUnit[] {
  const units: ResearchUnit[] = [];
  for (let segment = 0; segment < RESEARCH_SEGMENTS_PER_PAGE; segment += 1) {
    for (const page of pages) {
      if (units.length >= limit) return units;
      if (segment < page.research.segments.length) {
        units.push({ id: `U${units.length + 1}`, kind: "page", page_ref: page.id, segment_index: segment });
      }
    }
  }
  return units;
}

/** A pure projection, with all retained text stored exactly once in pages/PAA. */
function projectBundle(pages: readonly ResearchPage[], paa: readonly ResearchPaaQuestion[], duplicates: number, availablePaa: number, pageLimit: number): ResearchBundle {
  const units = pageUnits(pages, pageLimit);
  const retainedCounts = new Map<string, number>();
  for (const unit of units) if (unit.kind === "page") retainedCounts.set(unit.page_ref, (retainedCounts.get(unit.page_ref) ?? 0) + 1);
  const retainedPages = pages.map((page) => {
    const kept = retainedCounts.get(page.id) ?? 0;
    return { ...page, research: { ...page.research, segments: page.research.segments.slice(0, kept), omitted_segments: page.research.segments_total - kept } };
  });
  const pageCount = units.length;
  const availablePages = pages.reduce((sum, page) => sum + page.research.segments_total, 0);
  for (const question of paa) units.push({ id: `U${units.length + 1}`, kind: "paa", paa_ref: question.id });
  return {
    pages: retainedPages, paa, units,
    budget: {
      page_units_available: availablePages, page_units_retained: pageCount, page_units_omitted: availablePages - pageCount,
      paa_available: availablePaa, paa_retained: paa.length, paa_duplicates: duplicates, paa_omitted: availablePaa - duplicates - paa.length,
    },
  };
}

export function buildResearchBundle(pages: readonly ResearchPage[], paa: readonly ResearchPaaQuestion[]): Decoded<ResearchBundle> {
  const decoded = object({ pages: array(pageShape, { max: 13 }), paa: array(paaShape, { max: 100 }) })({ pages, paa }, "");
  if (!decoded.ok) return decoded;
  const pageError = checkPages(decoded.value.pages);
  if (pageError !== null) return pageError;
  const orderedPages = [...decoded.value.pages].sort(compareSourceId);
  const orderedPaa = [...decoded.value.paa].sort(compareSourceId);
  const keys = new Set<string>();
  const ids = new Set<string>();
  const unique: ResearchPaaQuestion[] = [];
  let duplicates = 0;
  for (const [index, item] of orderedPaa.entries()) {
    if (ids.has(item.id)) return reference(`paa[${index}].id`);
    ids.add(item.id);
    const key = paaKey(item.question);
    if (keys.has(key)) { duplicates += 1; continue; }
    keys.add(key);
    if (unique.length < RESEARCH_PAA_MAX) unique.push(item);
  }
  // If long multilingual text/URLs hit the byte budget, omit the final sampled
  // page unit, updating every counter. Never truncate a source string mid-code-point.
  for (let limit = RESEARCH_PAGE_UNITS_MAX; limit >= 0; limit -= 1) {
    const value = projectBundle(orderedPages, unique, duplicates, decoded.value.paa.length, limit);
    const bytes = byteLength(value);
    if (bytes !== null && bytes <= RESEARCH_BUNDLE_MAX_BYTES) return parseResearchBundle(value);
  }
  return invalid("research.bytes");
}

export function parseResearchBundle(input: unknown): Decoded<ResearchBundle> {
  const bytes = byteLength(input);
  if (bytes === null || bytes > RESEARCH_BUNDLE_MAX_BYTES) return invalid("research.bytes");
  const decoded = bundleShape(input, "");
  if (!decoded.ok) return decoded;
  const value = decoded.value;
  const error = checkPages(value.pages);
  if (error !== null) return error;
  if (value.pages.some((page, index) => index > 0 && compareSourceId(value.pages[index - 1]!, page) >= 0)) return reference("pages");
  if (value.paa.some((item, index) => index > 0 && compareSourceId(value.paa[index - 1]!, item) >= 0)) return reference("paa");
  if (new Set(value.paa.map((item) => item.id)).size !== value.paa.length ||
      new Set(value.paa.map((item) => paaKey(item.question))).size !== value.paa.length) return reference("paa");
  const budget = value.budget;
  if (budget.paa_available !== value.paa.length + budget.paa_duplicates + budget.paa_omitted) return reference("budget.paa_available");
  const expected = projectBundle(value.pages, value.paa, budget.paa_duplicates, budget.paa_available, RESEARCH_PAGE_UNITS_MAX);
  if (canonicalize(expected.units) !== canonicalize(value.units)) return reference("units");
  if (canonicalize(expected.budget) !== canonicalize(budget)) return reference("budget");
  if (value.pages.reduce((sum, page) => sum + page.research.segments.length, 0) !== budget.page_units_retained) return reference("pages");
  return decoded;
}

const modelShape: Decoder<ModelResearchOutput> = object({
  questions: array(object({ anchor: identifier("U"), q: modelText(RESEARCH_QUESTION_MAX_CHARS), sources: array(identifier("U"), { min: 1, max: RESEARCH_PAGE_UNITS_MAX + RESEARCH_PAA_MAX, unique: true }) }), { max: RESEARCH_QUESTION_MAX }),
  outline: array(object({ h2: modelText(RESEARCH_HEADING_MAX_CHARS), h3: array(modelText(RESEARCH_HEADING_MAX_CHARS), { max: 3 }), answers: array(identifier("U"), { min: 1, max: RESEARCH_QUESTION_MAX, unique: true }) }), { max: RESEARCH_OUTLINE_MAX }),
});

function finalPageKey(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

export function validateResearchOutput(input: unknown, bundle: ResearchBundle): Decoded<ResearchResult> {
  const checked = parseResearchBundle(bundle);
  if (!checked.ok) return checked;
  const decoded = modelShape(input, "");
  if (!decoded.ok) return decoded;
  const units = new Map(checked.value.units.map((unit) => [unit.id, unit]));
  const pages = new Map(checked.value.pages.map((page) => [page.id, page]));
  const anchors = new Map<string, string>();
  const questions: ResearchQuestion[] = [];
  for (const [index, question] of decoded.value.questions.entries()) {
    if (anchors.has(question.anchor) || !question.sources.includes(question.anchor)) return reference(`questions[${index}].anchor`);
    const coveredPages = new Set<string>();
    const paaRefs: string[] = [];
    for (const ref of question.sources) {
      const unit = units.get(ref);
      if (unit === undefined) return reference(`questions[${index}].sources`);
      if (unit.kind === "paa") paaRefs.push(unit.paa_ref);
      else {
        const page = pages.get(unit.page_ref);
        if (page?.role === "competitor") coveredPages.add(finalPageKey(page.final_url));
      }
    }
    const id = `Q${index + 1}`;
    anchors.set(question.anchor, id);
    questions.push({ id, anchor: question.anchor, q: question.q, source_refs: [...question.sources], covered_by: coveredPages.size, paa_refs: paaRefs });
  }
  const answered = new Set<string>();
  const outline: ResearchOutlineItem[] = [];
  for (const [index, section] of decoded.value.outline.entries()) {
    const answers: string[] = [];
    for (const anchor of section.answers) {
      const id = anchors.get(anchor);
      if (id === undefined || answered.has(id)) return reference(`outline[${index}].answers`);
      answered.add(id);
      answers.push(id);
    }
    outline.push({ id: `O${index + 1}`, h2: section.h2, h3: [...section.h3], answers });
  }
  if (answered.size !== questions.length) return reference("outline");
  return ok({ questions, outline });
}

const resultShape: Decoder<ResearchResult> = object({
  questions: array(object({
    id: identifier("Q"), anchor: identifier("U"), q: modelText(RESEARCH_QUESTION_MAX_CHARS),
    source_refs: array(identifier("U"), { min: 1, max: RESEARCH_PAGE_UNITS_MAX + RESEARCH_PAA_MAX, unique: true }),
    covered_by: count(10), paa_refs: array(paaId, { max: RESEARCH_PAA_MAX, unique: true }),
  }), { max: RESEARCH_QUESTION_MAX }),
  outline: array(object({ id: identifier("O"), h2: modelText(RESEARCH_HEADING_MAX_CHARS), h3: array(modelText(RESEARCH_HEADING_MAX_CHARS), { max: 3 }), answers: array(identifier("Q"), { min: 1, max: RESEARCH_QUESTION_MAX, unique: true }) }), { max: RESEARCH_OUTLINE_MAX }),
});

/** Recompute all public question ids, outline mappings and coverage from source refs. */
export function parseResearchResult(input: unknown, bundle: ResearchBundle): Decoded<ResearchResult> {
  const decoded = resultShape(input, "");
  if (!decoded.ok) return decoded;
  const value = decoded.value;
  const anchors = new Map(value.questions.map((question) => [question.id, question.anchor]));
  const model = {
    questions: value.questions.map((question) => ({ anchor: question.anchor, q: question.q, sources: question.source_refs })),
    outline: value.outline.map((section) => ({ h2: section.h2, h3: section.h3, answers: section.answers.map((answer) => anchors.get(answer) ?? "invalid") })),
  };
  const rebuilt = validateResearchOutput(model, bundle);
  if (!rebuilt.ok) return rebuilt;
  for (const key of ["questions", "outline"] as const) {
    if (canonicalize(rebuilt.value[key]) !== canonicalize(value[key])) return reference(at("", key));
  }
  return decoded;
}
