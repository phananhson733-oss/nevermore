// @input -- parsed confirmed Brief v2, exact selected sections/settings and bounded model seams
// @output -- self-checked Draft v2 with current-request receipts and whole-draft coverage
// @pos -- server orchestration only; admission and error envelopes remain in content-draft-handler
import { COVERAGE_TIMEOUT_MS, DRAFT_TOTAL_BUDGET_MS, ENVELOPE_MS, SECTION_ENDPOINT_BUDGET_MS, SECTION_MAX_ATTEMPTS, SECTION_TIMEOUT_MS } from "@sf/public-tools/content-brief/constants";
import type { ResearchOutlineItem } from "@sf/public-tools/content-brief/v2-contract";
import { assembleDraftV2, parseDraftResultV2 } from "@sf/public-tools/content-brief/v2-draft";
import type { DraftResultV2, DraftV2Section, DraftV2Settings } from "@sf/public-tools/content-brief/v2-draft-contract";
import type { ConfirmedBriefV2 } from "@sf/public-tools/content-brief/v2-generation-contract";
import type { DraftCoverageInput, DraftCoverageResult } from "./content-draft-llm.ts";
import type { DraftV2SectionInput } from "./content-draft-v2-llm.ts";
import type { DraftV2SectionGeneration } from "@sf/public-tools/content-brief/v2-draft-contract";

const SECTION_CONCURRENCY = 3;
// The client's final abort/receipt must settle before the outer watchdog fires.
const RECEIPT_SETTLEMENT_MS = 100;
const NO_COVERAGE: DraftCoverageResult = { items: null, reads: { status: "unavailable", reason: "insufficient_evidence", attempted: 0, calls: 0, model_id: null, input_tokens: null, output_tokens: null } };

export interface DraftV2RunDependencies {
  readonly generateSectionV2: (input: DraftV2SectionInput) => Promise<DraftV2SectionGeneration>;
  readonly runCoverageV2: (input: DraftCoverageInput) => Promise<DraftCoverageResult>;
  readonly now: () => number;
  readonly runId: () => string;
}

interface DraftV2RunInput {
  readonly confirmed: ConfirmedBriefV2;
  readonly settings: DraftV2Settings;
  readonly requested: readonly ResearchOutlineItem[];
  readonly previous: DraftResultV2 | null;
  readonly start: number;
  readonly deadlineAt: number;
}

/** Missing receipts are programming/transport failures, never invented zero-call successes. */
async function withReceiptDeadline<T>(work: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Draft receipt deadline exceeded")), timeoutMs); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function noAttemptTimeout(heading: ResearchOutlineItem): DraftV2Section {
  return { ...heading, status: "failed", fail_reason: "timeout", llm: { attempts: 0, model_id: null, temperature_requested: 0.4, temperature_effective: null, input_tokens: null, output_tokens: null } };
}

/** Workers drain their bounded started calls before a missing receipt can escape. */
async function writeSections(input: DraftV2RunInput, deps: DraftV2RunDependencies): Promise<readonly DraftV2Section[]> {
  const sections = new Map<string, DraftV2Section>();
  const sectionDeadline = input.deadlineAt - COVERAGE_TIMEOUT_MS - RECEIPT_SETTLEMENT_MS;
  let next = 0;
  let failed = false;
  let firstFailure: unknown;
  async function worker(): Promise<void> {
    while (!failed) {
      const heading = input.requested[next++];
      if (heading === undefined) return;
      const availableMs = sectionDeadline - deps.now() - ENVELOPE_MS;
      if (availableMs <= 0) {
        sections.set(heading.id, noAttemptTimeout(heading));
        continue;
      }
      try {
        const generated = await withReceiptDeadline(() => deps.generateSectionV2({ confirmed: input.confirmed, sectionId: heading.id, settings: input.settings, deadlineAt: sectionDeadline }), Math.min(SECTION_TIMEOUT_MS * SECTION_MAX_ATTEMPTS, availableMs) + RECEIPT_SETTLEMENT_MS);
        sections.set(heading.id, { ...heading, ...generated });
      } catch (error) {
        if (!failed) firstFailure = error;
        failed = true;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(SECTION_CONCURRENCY, input.requested.length) }, worker));
  if (failed) throw firstFailure;
  return input.confirmed.outline.map((heading) => sections.get(heading.id) ?? input.previous?.sections.find((section) => section.id === heading.id) ?? { ...heading, status: "skipped" });
}

async function coverageOf(input: DraftV2RunInput, sections: readonly DraftV2Section[], deps: DraftV2RunDependencies): Promise<DraftCoverageResult> {
  const ok = sections.filter((section) => section.status === "ok");
  if (ok.length === 0) return NO_COVERAGE;
  const deadlineAt = input.deadlineAt - RECEIPT_SETTLEMENT_MS;
  const availableMs = deadlineAt - deps.now() - ENVELOPE_MS;
  if (availableMs <= 0) return { items: null, reads: { status: "unavailable", reason: "timeout", attempted: 0, calls: 0, model_id: null, input_tokens: null, output_tokens: null } };
  return withReceiptDeadline(() => deps.runCoverageV2({
    primary: input.confirmed.brief.context.input.primary,
    language: input.confirmed.brief.context.input.language,
    questions: input.confirmed.brief.generated!.research.questions.map(({ id, q }) => ({ id, q })),
    sections: ok.map((section) => ({
      id: section.id, h2: section.h2,
      // H3 is real rendered content; only sentences enter the length totals.
      text: section.body.paragraphs.map((paragraph) => [paragraph.heading, paragraph.sentences.map((sentence) => sentence.text).join(" ")].filter((text) => text !== null).join("\n")).join("\n\n"),
    })),
    deadlineAt,
  }), Math.min(COVERAGE_TIMEOUT_MS, availableMs) + RECEIPT_SETTLEMENT_MS);
}

export async function runDraftV2(input: DraftV2RunInput, deps: DraftV2RunDependencies): ReturnType<typeof parseDraftResultV2> {
  const sections = await writeSections(input, deps);
  const coverage = await coverageOf(input, sections, deps);
  const previous = input.previous;
  const assembled = await assembleDraftV2({
    confirmed: input.confirmed, settings: input.settings, sections, coverage,
    run: {
      run_id: deps.runId(), collected_at: new Date(input.start).toISOString(), elapsed_ms: Math.max(0, deps.now() - input.start),
      budget_ms: previous === null ? DRAFT_TOTAL_BUDGET_MS : SECTION_ENDPOINT_BUDGET_MS,
      rerun: previous === null ? null : { previous_run_id: previous.run.run_id, previous_fingerprint: previous.run.fingerprint, section_id: input.requested[0]!.id },
    },
  });
  if (!assembled.ok) return assembled;
  return parseDraftResultV2(assembled.value, input.confirmed, previous ?? undefined);
}
