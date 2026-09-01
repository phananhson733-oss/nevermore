// @input -- frozen v2/v3 context and untrusted model or exported generation
// @output -- exact source-bound whole writing plan
// @pos -- v2 generation validation; legacy v1 remains unchanged
import { canonicalizeUrl } from "@sf/sources/canonical-url";
import { keywordCoverageProperty } from "../keyword-opportunity/property.ts";
import { canonicalize } from "./canonical.ts";
import { buildSerpObservations } from "./assemble.ts";
import { SERP_DEPTH, SUPPORTING_KEYWORDS_MAX } from "./constants.ts";
import type { ProfileFact } from "./contract.ts";
import {
  array, at, finite, identifier, invalid, isRecord, literal, modelText, nullable, object, ok, oneOf, reference,
  serpObservationShape, serpReadMeta, tagged, text,
  type Decoded, type Decoder,
} from "./parse-brief-shape.ts";
import {
  RESEARCH_HEADING_MAX_CHARS, RESEARCH_OUTLINE_MAX, RESEARCH_PAGE_UNITS_MAX, RESEARCH_PAA_MAX,
  RESEARCH_QUESTION_MAX, RESEARCH_QUESTION_MAX_CHARS, type ModelResearchOutput, type ResearchResult,
} from "./v2-contract.ts";
import { parseResearchBundle, parseResearchResult, validateResearchOutput } from "./v2-research.ts";
import type {
  BriefV2Context, BriefV2Generated, BriefV2PlanStep, BriefV2WritingPlan, ModelBriefV2Output,
} from "./v2-generation-contract.ts";

const TEXT_MAX = 400;
const UNIT_MAX = RESEARCH_PAGE_UNITS_MAX + RESEARCH_PAA_MAX;
const sourceText = (max: number): Decoder<string> => (input, path) =>
  typeof input === "string" && input.trim() !== "" && Array.from(input).length <= max ? ok(input) : invalid(path);
const count: Decoder<number> = (input, path) =>
  typeof input === "number" && Number.isSafeInteger(input) && input >= 0 ? ok(input) : invalid(path);
const positive: Decoder<number> = (input, path) =>
  typeof input === "number" && Number.isFinite(input) && input > 0 ? ok(input) : invalid(path);
const revision: Decoder<number> = (input, path) =>
  typeof input === "number" && Number.isSafeInteger(input) && input > 0 ? ok(input) : invalid(path);
const hash: Decoder<string> = (input, path) =>
  typeof input === "string" && /^[a-f0-9]{64}$/u.test(input) ? ok(input) : invalid(path);
const date: Decoder<string> = (input, path) => {
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(input)) return invalid(path);
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === input ? ok(input) : invalid(path);
};
const url: Decoder<string> = (input, path) => {
  if (typeof input !== "string" || input.length > 2048) return invalid(path);
  try {
    const parsed = new URL(input);
    return ["http:", "https:"].includes(parsed.protocol) && parsed.hostname !== "" &&
      parsed.username === "" && parsed.password === "" && parsed.href.length <= 2048 ? ok(input) : invalid(path);
  } catch { return invalid(path); }
};
const phrase = (value: string) => value.trim().replace(/\s+/gu, " ");
const queryKey = (value: string) => phrase(value.normalize("NFKC")).toLowerCase();
const keyword: Decoder<string> = (input, path) => {
  const parsed = sourceText(200)(input, path);
  return parsed.ok && phrase(parsed.value) !== parsed.value ? invalid(path) : parsed;
};
function pageKey(value: string): string {
  const parsed = new URL(value);
  parsed.hash = "";
  return parsed.href;
}

/** Stable page identity for candidate selection and bindings, never a replacement for raw source URLs. */
export function briefV2PageKey(value: string): string | null {
  return url(value, "").ok ? canonicalizeUrl(value)?.subjectUrl ?? null : null;
}

/** Browser-safe page identity; transport separately enforces public DNS, ports and every redirect hop. */
export function sameBriefV2OwnedPage(submittedUrl: string, destination: string): boolean {
  if (!url(submittedUrl, "").ok || !url(destination, "").ok) return false;
  const submitted = new URL(submittedUrl);
  const target = new URL(destination);
  if (submitted.protocol === "https:" && target.protocol !== "https:") return false;
  const fromHost = submitted.hostname;
  const toHost = target.hostname;
  if (fromHost.replace(/^www\./u, "") !== toHost.replace(/^www\./u, "")) return false;
  if (fromHost !== toHost && fromHost !== `www.${toHost}` && toHost !== `www.${fromHost}`) return false;
  const rebased = canonicalizeUrl(`${target.origin}${submitted.pathname}${submitted.search}`);
  return rebased !== null && rebased.subjectUrl === canonicalizeUrl(destination)?.subjectUrl;
}

function nested<T>(result: Decoded<T>, path: string): Decoded<T> {
  return result.ok ? result : { ...result, path: at(path, result.path) };
}

const factBase = { id: identifier("P"), field: sourceText(2000), text: sourceText(300) };
const firstHandFact = (derivation: "declared" | "observed" | "computed") => object({
  ...factBase, derivation: literal(derivation), provenance: object({ method: literal("observed"), origin: literal("product_profile") }),
});
const fact: Decoder<ProfileFact> = tagged("derivation", {
  declared: firstHandFact("declared"), observed: firstHandFact("observed"), computed: firstHandFact("computed"),
  inferred: object({ ...factBase, derivation: literal("inferred"), provenance: object({
    method: literal("model"), derived_from: (input, path) =>
      Array.isArray(input) && input.length === 1 && input[0] === "product_profile" ? ok<["product_profile"]>(["product_profile"]) : invalid(path),
  }) }),
});
const candidateId = oneOf(["T1", "T2", "T3"] as const);
type SerpSnapshot = NonNullable<BriefV2Context["serp"]>;
const serpSnapshotShape = object({ rows: array(serpObservationShape(text(2048)), { max: SERP_DEPTH }), read: serpReadMeta });
const serpSnapshot: Decoder<SerpSnapshot> = (input, path) => {
  const parsed = serpSnapshotShape(input, path);
  if (!parsed.ok) return parsed;
  const { rows, read } = parsed.value;
  if (read.status === "unavailable") {
    if (rows.length !== 0 || (read.attempted !== null && !Number.isSafeInteger(read.attempted))) return reference(path);
  } else {
    if (![read.requested, read.returned, read.unresolved].every(Number.isSafeInteger) || read.requested > SERP_DEPTH ||
        read.returned < 1 || read.returned > read.requested || rows.length !== read.returned ||
        (read.status === "partial") !== (read.returned < read.requested || read.unresolved > 0)) return reference(at(path, "read"));
  }
  if (new Set(rows.map((row) => row.rank)).size !== rows.length || rows.some((row) => !Number.isSafeInteger(row.rank))) return reference(at(path, "rows"));
  const rebuilt = buildSerpObservations(rows);
  return canonicalize(rebuilt) === canonicalize(rows) ? parsed : reference(at(path, "rows"));
};
const contextFields = {
  input: object({ primary: keyword, supporting: array(keyword, { max: SUPPORTING_KEYWORDS_MAX }), market: sourceText(64), language: sourceText(64) }),
  research: (input: unknown, path: string) => nested(parseResearchBundle(input), path),
  facts: array(fact, { max: 32 }),
  profile_snapshot: nullable(object({ website_id: sourceText(128), revision, hash })),
  gsc: object({
    status: oneOf(["complete", "partial", "unavailable"] as const), property: nullable(sourceText(2048)),
    window: nullable(object({ start: date, end: date, lookback_days: literal(28) })),
    reason: nullable(oneOf(["not_requested", "not_connected", "timeout", "provider_error"] as const)), omitted_matches: count,
    matches: array(object({
      id: identifier("G"), query: sourceText(2000), keyword, scope: oneOf(["primary", "supporting"] as const),
      page: url, clicks: finite(0), impressions: finite(0), position: nullable(positive),
    }), { max: 30 }),
  }),
  candidates: array(object({
    id: candidateId, url, match_refs: array(identifier("G"), { max: 30, unique: true }), read: oneOf(["observed", "unavailable", "redirected"] as const),
  }), { max: 3 }),
};
const contextShape: Decoder<BriefV2Context> = object(contextFields);
const contextWithSerpShape: Decoder<BriefV2Context> = object({ ...contextFields, serp: serpSnapshot });

/** The source ledger is immutable observed data, not a source-authenticity signature. */
export function parseBriefV2Context(input: unknown): Decoded<BriefV2Context> {
  const parsed = isRecord(input) && Object.hasOwn(input, "serp") ? contextWithSerpShape(input, "") : contextShape(input, "");
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  const primary = queryKey(value.input.primary);
  const supporting = new Set(value.input.supporting.map(queryKey));
  if (supporting.size !== value.input.supporting.length || supporting.has(primary)) return reference("input.supporting");
  if (new Set(value.facts.map((item) => item.id)).size !== value.facts.length) return reference("facts");
  if (value.facts.length > 0 && value.profile_snapshot === null) return reference("profile_snapshot");
  const gsc = value.gsc;
  if (gsc.property !== null) {
    const probe = gsc.property.startsWith("sc-domain:") ? `https://${gsc.property.slice("sc-domain:".length)}` : gsc.property;
    if (keywordCoverageProperty(probe, [gsc.property]) !== gsc.property) return reference("gsc.property");
  } else if (value.candidates.length > 0 || value.research.pages.some((item) => item.role === "owned")) return reference("gsc.property");
  const ownedByProperty = (page: string) => gsc.property !== null && keywordCoverageProperty(page, [gsc.property]) === gsc.property;
  for (const [index, page] of value.research.pages.entries()) {
    if (page.role === "owned" ? !ownedByProperty(page.url) || !ownedByProperty(page.final_url)
      : ownedByProperty(page.url) || ownedByProperty(page.final_url)) return reference(`research.pages[${index}].role`);
    if (value.serp !== undefined && page.role === "competitor") {
      const row = value.serp.rows.find((item) => item.id === page.id.replace(/^C/u, "S"));
      if (row === undefined || row.url !== page.url) return reference(`research.pages[${index}].url`);
    }
  }
  if (gsc.window !== null && Date.parse(gsc.window.end) - Date.parse(gsc.window.start) !== 27 * 86400_000) return reference("gsc.window");
  if (gsc.status === "unavailable") {
    if (gsc.reason === null || gsc.matches.length !== 0 || gsc.omitted_matches !== 0) return reference("gsc");
    if (gsc.reason === "not_requested" && (gsc.property !== null || gsc.window !== null)) return reference("gsc");
    if (["timeout", "provider_error"].includes(gsc.reason) && gsc.property === null) return reference("gsc.property");
  } else if (gsc.reason !== null || gsc.property === null || gsc.window === null || (gsc.omitted_matches > 0 && gsc.status !== "partial")) return reference("gsc");
  const seenMatches = new Set<string>();
  for (const [index, match] of gsc.matches.entries()) {
    const path = `gsc.matches[${index}]`;
    if (match.id !== `G${index + 1}`) return reference(`${path}.id`);
    if (!ownedByProperty(match.page)) return reference(`${path}.page`);
    const key = queryKey(match.query);
    if (key !== queryKey(match.keyword) || (match.scope === "primary" ? key !== primary : !supporting.has(key))) return reference(`${path}.scope`);
    const identity = JSON.stringify([match.query, pageKey(match.page)]);
    if (seenMatches.has(identity)) return reference(path);
    seenMatches.add(identity);
  }
  const matches = new Map(gsc.matches.map((item) => [item.id, item]));
  const owned = new Map(value.research.pages.filter((item) => item.role === "owned").map((item) => [item.id, item]));
  const candidateIds = new Set<string>();
  const candidateUrls = new Set<string | null>();
  for (const [index, candidate] of value.candidates.entries()) {
    const path = `candidates[${index}]`;
    if (!ownedByProperty(candidate.url)) return reference(`${path}.url`);
    const identity = briefV2PageKey(candidate.url);
    if (candidateIds.has(candidate.id) || candidateUrls.has(identity)) return reference(path);
    candidateIds.add(candidate.id);
    candidateUrls.add(identity);
    for (const ref of candidate.match_refs) {
      const match = matches.get(ref);
      if (match === undefined || briefV2PageKey(match.page) !== identity) return reference(`${path}.match_refs`);
    }
    const page = owned.get(candidate.id);
    if (candidate.read === "observed") {
      if (page === undefined || page.url !== candidate.url || page.research.segments.length === 0 ||
          !sameBriefV2OwnedPage(candidate.url, page.final_url)) return reference(`${path}.read`);
    } else if (page !== undefined) return reference(`${path}.read`);
  }
  if ([...owned.keys()].some((id) => !candidateIds.has(id))) return reference("candidates");
  return parsed;
}

/** Only free text is normalized at the model boundary. IDs and mappings stay exact. */
function generatedText(max: number, strict: boolean): Decoder<string> {
  const decode = modelText(max);
  return (input, path) => decode(typeof input === "string" && !strict ? phrase(input) : input, path);
}
function writingShape(strict: boolean, answerPrefix: "U" | "Q"): Decoder<BriefV2WritingPlan> {
  const text = generatedText(TEXT_MAX, strict);
  return object({
    intent: nullable(object({ value: oneOf(["informational", "commercial", "transactional", "navigational"] as const), rationale: text })),
    format: nullable(object({ value: oneOf(["guide", "listicle", "comparison", "product_page", "tool", "other"] as const), rationale: text })),
    page_plan: object({
      action: oneOf(["create", "update", "undecidable"] as const), rationale: text, target_ref: nullable(candidateId),
      steps: array(object({ kind: oneOf(["keep", "add", "rewrite"] as const), instruction: text,
        sources: array(identifier("U"), { max: UNIT_MAX, unique: true }), answers: array(identifier(answerPrefix), { max: RESEARCH_QUESTION_MAX, unique: true }),
      }), { max: 12 }),
    }),
    gap_angle: nullable(object({ value: text, rationale: text, fact_refs: array(identifier("P"), { min: 1, max: 32, unique: true }), sources: array(identifier("U"), { min: 1, max: RESEARCH_PAGE_UNITS_MAX, unique: true }) })),
    internal_links: array(object({ page_ref: candidateId, anchor: text, why: text }), { max: 5 }),
    do_not_cover: array(object({ page_ref: candidateId, topic: text, why: text }), { max: 5 }),
  });
}

const modelResearchShape: Decoder<ModelResearchOutput> = object({
  questions: array(object({ anchor: identifier("U"), q: generatedText(RESEARCH_QUESTION_MAX_CHARS, false), sources: array(identifier("U"), { min: 1, max: UNIT_MAX, unique: true }) }), { max: RESEARCH_QUESTION_MAX }),
  outline: array(object({ h2: generatedText(RESEARCH_HEADING_MAX_CHARS, false), h3: array(generatedText(RESEARCH_HEADING_MAX_CHARS, false), { max: 3 }), answers: array(identifier("U"), { min: 1, max: RESEARCH_QUESTION_MAX, unique: true }) }), { max: RESEARCH_OUTLINE_MAX }),
});

function wholeShape<R>(input: unknown, research: Decoder<R>, strict: boolean, answerPrefix: "U" | "Q"): Decoded<BriefV2WritingPlan & { research: R }> {
  // Decode the known writing fields without dropping unknown top-level keys.
  if (typeof input !== "object" || input === null || Array.isArray(input)) return invalid("");
  if (!Object.hasOwn(input, "research")) return invalid("research");
  const { research: rawResearch, ...writing } = input as Record<string, unknown>;
  const plan = writingShape(strict, answerPrefix)(writing, "");
  if (!plan.ok) return plan;
  const result = research(rawResearch, "research");
  return result.ok ? ok({ ...plan.value, research: result.value }) : result;
}

export function validateModelBriefV2(input: unknown, context: BriefV2Context): Decoded<BriefV2Generated> {
  const checked = parseBriefV2Context(context);
  if (!checked.ok) return nested(checked, "context");
  const decoded = wholeShape(input, modelResearchShape, false, "U");
  if (!decoded.ok) return decoded;
  const research = validateResearchOutput(decoded.value.research, checked.value.research);
  if (!research.ok) return nested(research, "research");
  const { page_plan: plan, gap_angle: gap } = decoded.value;
  if (research.value.questions.length > 0 && (decoded.value.intent === null || decoded.value.format === null)) return reference("intent");
  const candidates = new Map(checked.value.candidates.map((item) => [item.id, item]));
  const units = new Map(checked.value.research.units.map((item) => [item.id, item]));
  const pages = new Map(checked.value.research.pages.map((item) => [item.id, item]));
  const target = plan.target_ref === null ? undefined : candidates.get(plan.target_ref);
  const targetIdentity = target === undefined ? null : briefV2PageKey(target.url);
  const competitorPages = new Set(checked.value.research.pages.filter((item) => item.role === "competitor").map((item) => item.id));
  const anchors = new Map(research.value.questions.map((item) => [item.anchor, item.id]));
  const steps: BriefV2PlanStep[] = [];
  if (plan.action === "update") {
    if (plan.target_ref === null || candidates.get(plan.target_ref)?.read !== "observed") return reference("page_plan.target_ref");
    if (plan.steps.length === 0 || plan.steps.every((step) => step.kind === "keep")) return reference("page_plan.steps");
  } else {
    if (plan.target_ref !== null || plan.steps.length !== 0) return reference("page_plan");
    if (plan.action === "create") {
      const observedUrls = new Set(checked.value.candidates.filter((item) => item.read === "observed").map((item) => briefV2PageKey(item.url)));
      if (checked.value.gsc.status !== "complete" || checked.value.candidates.some((item) => item.read !== "observed") ||
          checked.value.gsc.matches.some((item) => !observedUrls.has(briefV2PageKey(item.page)))) return reference("page_plan.action");
    }
  }
  for (const [index, step] of plan.steps.entries()) {
    const path = `page_plan.steps[${index}]`;
    if (step.kind === "add" ? step.answers.length === 0 : step.sources.length === 0) return reference(path);
    for (const ref of step.sources) {
      const unit = units.get(ref);
      if (unit?.kind !== "page" || (step.kind !== "add" && unit.page_ref !== plan.target_ref)) return reference(`${path}.sources`);
      const page = pages.get(unit.page_ref);
      if (step.kind !== "add" && (page?.role !== "owned" || briefV2PageKey(page.url) !== targetIdentity)) return reference(`${path}.sources`);
    }
    const answers: string[] = [];
    for (const anchor of step.answers) {
      const id = anchors.get(anchor);
      if (id === undefined) return reference(`${path}.answers`);
      answers.push(id);
    }
    steps.push({ ...step, sources: [...step.sources], answers });
  }
  if (gap !== null) {
    const facts = new Set(checked.value.facts.map((item) => item.id));
    if (gap.fact_refs.some((ref) => !facts.has(ref))) return reference("gap_angle.fact_refs");
    if (gap.sources.some((ref) => { const unit = units.get(ref); return unit?.kind !== "page" || !competitorPages.has(unit.page_ref); })) return reference("gap_angle.sources");
  }
  for (const key of ["internal_links", "do_not_cover"] as const) {
    const refs = decoded.value[key].map((item) => item.page_ref);
    const identities = refs.map((ref) => { const candidate = candidates.get(ref); return candidate === undefined ? null : briefV2PageKey(candidate.url); });
    if (new Set(identities).size !== refs.length || refs.some((ref, index) => identities[index] === targetIdentity || candidates.get(ref)?.read !== "observed")) return reference(key);
  }
  return ok({ ...decoded.value, research: research.value, page_plan: { ...plan, steps } });
}

/** Rebuild the model graph, recompute public IDs, and compare the frozen result exactly. */
export function parseBriefV2Generated(input: unknown, context: BriefV2Context): Decoded<BriefV2Generated> {
  const checked = parseBriefV2Context(context);
  if (!checked.ok) return nested(checked, "context");
  const decoded = wholeShape<ResearchResult>(input, (value, path) => nested(parseResearchResult(value, checked.value.research), path), true, "Q");
  if (!decoded.ok) return decoded;
  const value = decoded.value;
  const anchors = new Map(value.research.questions.map((item) => [item.id, item.anchor]));
  const model: ModelBriefV2Output = {
    ...value,
    research: {
      questions: value.research.questions.map((item) => ({ anchor: item.anchor, q: item.q, sources: item.source_refs })),
      outline: value.research.outline.map((item) => ({ h2: item.h2, h3: item.h3, answers: item.answers.map((id) => anchors.get(id) ?? "invalid") })),
    },
    page_plan: { ...value.page_plan, steps: value.page_plan.steps.map((step) => ({ ...step, answers: step.answers.map((id) => anchors.get(id) ?? "invalid") })) },
  };
  const rebuilt = validateModelBriefV2(model, checked.value);
  if (!rebuilt.ok) return rebuilt;
  return canonicalize(rebuilt.value) === canonicalize(value) ? decoded : reference("generated");
}
