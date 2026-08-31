// @input -- complete v2 generation, or an imported confirmed revision
// @output -- exact detached brief/revision with recomputed graph and fingerprint
// @pos -- producer/consumer agreement and user-edit boundary, separate from legacy v1
import { canonicalize, fingerprintCanonical } from "./canonical.ts";
import {
  array, byteLength, finite, identifier, invalid, isRecord, literal, llmReadMeta, modelText,
  nullable, object, ok, oneOf, reference, text, timestamp, type Decoded, type Decoder,
} from "./parse-brief-shape.ts";
import { CONTENT_BRIEF_V2_SCHEMA, RESEARCH_HEADING_MAX_CHARS, RESEARCH_OUTLINE_MAX, RESEARCH_PROMPT_MAX_BYTES } from "./v2-contract.ts";
import { parseBriefV2Context, parseBriefV2Generated } from "./v2-generation.ts";
import type { BriefV2Generated, ConfirmedBriefV2, ContentBriefV2 } from "./v2-generation-contract.ts";

export const BRIEF_V2_MAX_BYTES = 224 * 1024;
export const CONFIRMED_BRIEF_V2_MAX_BYTES = 256 * 1024;
export const CONFIRMED_BRIEF_V2_SCHEMA = "gengrowth.confirmed_brief/v2";
const count = (max: number, min = 0): Decoder<number> => (input, path) =>
  typeof input === "number" && Number.isSafeInteger(input) && input >= min && input <= max ? ok(input) : invalid(path);
const hash: Decoder<string> = (input, path) => typeof input === "string" && /^[a-f0-9]{64}$/u.test(input) ? ok(input) : invalid(path);
const readSources = ["serp", "paa", "competitors", "owned_pages", "gsc", "profile"] as const;
const readShape = object({
  source: oneOf(readSources), status: oneOf(["complete", "partial", "unavailable"] as const),
  attempted: nullable(count(10_000_000)), retained: nullable(count(10_000_000)),
  reason: nullable(oneOf(["not_requested", "not_connected", "not_configured", "timeout", "provider_error", "insufficient_evidence"] as const)),
});
const runShape = object({
  run_id: text(128, 1), collected_at: timestamp, elapsed_ms: count(60_000), budget_ms: literal(45000),
  reads: array(readShape, { min: 6, max: 6 }), llm: llmReadMeta,
  serp_cost_usd: nullable(finite(0)),
  prompt_bytes: count(RESEARCH_PROMPT_MAX_BYTES), fingerprint: hash,
});

export async function fingerprintBriefV2(brief: ContentBriefV2): Promise<string> {
  const { fingerprint: _fingerprint, elapsed_ms: _elapsed, ...run } = brief.run;
  return fingerprintCanonical({ ...brief, run });
}

/** A causal checksum, never a claim that an imported source is authentic. */
export async function parseContentBriefV2(input: unknown): Promise<Decoded<ContentBriefV2>> {
  const bytes = byteLength(input);
  if (bytes === null || bytes > BRIEF_V2_MAX_BYTES) return invalid("brief.bytes");
  if (!isRecord(input) || input.schema !== CONTENT_BRIEF_V2_SCHEMA) return { ok: false, code: "brief_schema_mismatch", path: "schema" };
  // Decode context before generated fields so no model edge escapes the frozen graph.
  const context = parseBriefV2Context(input.context);
  if (!context.ok) return context;
  const generated: Decoder<BriefV2Generated | null> = nullable((value) => parseBriefV2Generated(value, context.value));
  const shape = object({ schema: literal(CONTENT_BRIEF_V2_SCHEMA), context: () => context, generated, run: runShape });
  const decoded = shape(input, "");
  if (!decoded.ok) return decoded;
  const brief = decoded.value;
  const { reads, llm, prompt_bytes } = brief.run;
  if (new Set(reads.map((read) => read.source)).size !== readSources.length) return reference("run.reads");
  for (const read of reads) {
    if (read.status === "unavailable") {
      if (read.reason === null || read.retained !== null) return reference(`run.reads.${read.source}`);
    } else if (read.reason !== null || read.attempted === null || read.retained === null || read.retained > read.attempted) {
      return reference(`run.reads.${read.source}`);
    }
  }
  const retained = new Map(reads.map((read) => [read.source, read.retained ?? 0]));
  const research = brief.context.research;
  if (research.budget.paa_omitted > 0 && reads.find((read) => read.source === "paa")?.status !== "partial") return reference("run.reads.paa");
  for (const role of ["competitor", "owned"] as const) {
    const source = role === "competitor" ? "competitors" : "owned_pages";
    if (research.pages.some((page) => page.role === role && (!page.body_complete || page.research.omitted_segments > 0 || page.research.segments.some((segment) => segment.truncated))) &&
        reads.find((read) => read.source === source)?.status !== "partial") return reference(`run.reads.${source}`);
  }
  if (retained.get("paa") !== research.paa.length ||
      retained.get("competitors") !== research.pages.filter((page) => page.role === "competitor").length ||
      retained.get("owned_pages") !== research.pages.filter((page) => page.role === "owned").length ||
      retained.get("profile") !== brief.context.facts.length ||
      retained.get("gsc") !== brief.context.gsc.matches.length) return reference("run.reads.retained");
  const gscRead = reads.find((read) => read.source === "gsc")!;
  if (gscRead.status !== brief.context.gsc.status || gscRead.reason !== brief.context.gsc.reason) return reference("run.reads.gsc");
  if ((llm.status === "complete") !== (brief.generated !== null) || llm.calls > 1 ||
      (llm.status === "complete" && (llm.calls !== 1 || prompt_bytes === 0)) ||
      (llm.status === "unavailable" && (llm.attempted === null || llm.attempted > 1 || llm.calls > llm.attempted)) ||
      (llm.calls > 0 && prompt_bytes === 0)) return reference("run.llm");
  if ([llm.input_tokens, llm.output_tokens].some((tokens) => tokens !== null && !Number.isSafeInteger(tokens)) ||
      (llm.status === "complete" && (llm.temperature_requested !== 0.2 ||
        (llm.temperature_effective !== null && (llm.temperature_effective < 0 || llm.temperature_effective > 2))))) return reference("run.llm");
  if (await fingerprintBriefV2(brief) !== brief.run.fingerprint) return { ok: false, code: "brief_fingerprint_mismatch", path: "run.fingerprint" };
  return decoded;
}

const outlineShape = array(object({
  id: identifier("O"), h2: modelText(RESEARCH_HEADING_MAX_CHARS),
  h3: array(modelText(RESEARCH_HEADING_MAX_CHARS), { max: 3 }),
  answers: array(identifier("Q"), { min: 1, max: 8, unique: true }),
}), { min: 1, max: RESEARCH_OUTLINE_MAX });
const editShape = object({
  outline: outlineShape, revision: count(1_000_000, 1), confirmed_at: timestamp,
  resolution: oneOf(["accept_recommendation", "create_despite_uncertainty"] as const),
});
type ConfirmationEdits = Pick<ConfirmedBriefV2, "outline" | "revision" | "confirmed_at" | "resolution">;

function validateEdits(brief: ContentBriefV2, edits: ConfirmationEdits): Decoded<ConfirmationEdits> {
  const generated = brief.generated;
  if (generated === null || generated.research.outline.length === 0) return reference("generated.research.outline");
  const base = new Map(generated.research.outline.map((section) => [section.id, section]));
  if (edits.outline.length !== base.size || new Set(edits.outline.map((section) => section.id)).size !== base.size) return reference("outline");
  for (const section of edits.outline) {
    const original = base.get(section.id);
    if (original === undefined || canonicalize(original.answers) !== canonicalize(section.answers)) return reference("outline.answers");
  }
  const unresolved = generated.page_plan.action === "undecidable";
  if (unresolved !== (edits.resolution === "create_despite_uncertainty")) return reference("resolution");
  return ok(edits);
}

/** All editable fields are explicit and survive export/import without mutating model output. */
export async function confirmBriefV2(input: unknown, edits: unknown): Promise<Decoded<ConfirmedBriefV2>> {
  const brief = await parseContentBriefV2(input);
  if (!brief.ok) return brief;
  const shape = editShape(edits, "");
  if (!shape.ok) return shape;
  const checked = validateEdits(brief.value, shape.value);
  if (!checked.ok) return checked;
  const unsigned = { schema: CONFIRMED_BRIEF_V2_SCHEMA, brief: brief.value, ...checked.value } satisfies Omit<ConfirmedBriefV2, "fingerprint">;
  const value: ConfirmedBriefV2 = { ...unsigned, fingerprint: await fingerprintCanonical(unsigned) };
  return parseConfirmedBriefV2(value);
}

export async function parseConfirmedBriefV2(input: unknown): Promise<Decoded<ConfirmedBriefV2>> {
  const bytes = byteLength(input);
  if (bytes === null || bytes > CONFIRMED_BRIEF_V2_MAX_BYTES) return invalid("confirmation.bytes");
  if (!isRecord(input) || input.schema !== CONFIRMED_BRIEF_V2_SCHEMA) return { ok: false, code: "brief_schema_mismatch", path: "schema" };
  const brief = await parseContentBriefV2(input.brief);
  if (!brief.ok) return brief;
  const shape = object({
    schema: literal(CONFIRMED_BRIEF_V2_SCHEMA), brief: () => brief,
    outline: outlineShape, revision: count(1_000_000, 1), confirmed_at: timestamp,
    resolution: oneOf(["accept_recommendation", "create_despite_uncertainty"] as const), fingerprint: hash,
  })(input, "");
  if (!shape.ok) return shape;
  const value = shape.value;
  const checked = validateEdits(value.brief, value);
  if (!checked.ok) return checked;
  const { fingerprint, ...unsigned } = value;
  if (await fingerprintCanonical(unsigned) !== fingerprint) return { ok: false, code: "brief_fingerprint_mismatch", path: "fingerprint" };
  return shape;
}
