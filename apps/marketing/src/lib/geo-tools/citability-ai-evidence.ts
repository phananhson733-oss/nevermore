// @input -- server-fetched complete raw HTML, metadata and deterministic checks
// @output -- bounded, fingerprinted excerpts with explicit coverage
// @pos -- server-only evidence construction, never browser-supplied page text
import { createHash } from "node:crypto";
import { isCitabilityAiContext, type CitabilityAiContext } from "./citability-ai-contract.ts";
import { deriveQuestionTerms, extractCitabilityText } from "./citability-text.ts";

export interface CreateCitabilityAiContextInput {
  readonly finalUrl: string;
  readonly targetQuestion: string | null;
  readonly rawHtml: string;
  readonly capturedAt: string;
  readonly checks: CitabilityAiContext["checks"];
}
/** Hashes the precise evidence input, including capture identity, not model output. */
export function citabilityAiInputFingerprint(context: Omit<CitabilityAiContext, "inputFingerprint">): string {
  return createHash("sha256").update(JSON.stringify({
    schemaVersion: context.schemaVersion, finalUrl: context.finalUrl, rawSha256: context.rawSha256,
    question: context.question, capturedAt: context.capturedAt, totalBodyChars: context.totalBodyChars,
    includedBodyChars: context.includedBodyChars, coverage: context.coverage, excerpts: context.excerpts,
    checks: context.checks,
  })).digest("hex");
}
export function createCitabilityAiContext(input: CreateCitabilityAiContextInput): CitabilityAiContext {
  const body = extractCitabilityText(input.rawHtml);
  if (!body) throw new Error("empty_evidence");
  // Disjoint chunks make the included count exact. Keep the first two chunks,
  // then rank the remainder by question-term matches, with source-order ties.
  const chunks: string[] = [];
  for (let start = 0; start < body.length;) {
    let end = Math.min(start + 360, body.length);
    if (end < body.length && /[\uD800-\uDBFF]/.test(body[end - 1])) end -= 1;
    chunks.push(body.slice(start, end)); start = end;
  }
  const terms = deriveQuestionTerms(input.targetQuestion);
  const selected = chunks.map((chunk, index) => ({ index,
    score: index < 2 ? Number.MAX_SAFE_INTEGER - index : terms.reduce((sum, term) => sum + Number(chunk.toLowerCase().includes(term)), 0),
  })).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 8).sort((a, b) => a.index - b.index);
  const excerpts = selected.map(({ index }, position) => ({ id: `E${position + 1}`, text: chunks[index] }));
  const includedBodyChars = excerpts.reduce((sum, item) => sum + item.text.length, 0);
  const context: Omit<CitabilityAiContext, "inputFingerprint"> = {
    schemaVersion: "citability-ai-context.v1", finalUrl: input.finalUrl,
    rawSha256: createHash("sha256").update(input.rawHtml).digest("hex"), question: input.targetQuestion,
    capturedAt: input.capturedAt, totalBodyChars: body.length, includedBodyChars,
    coverage: includedBodyChars === body.length ? "full" : "excerpt", excerpts,
    checks: input.checks.map(({ ruleId, state, kind }) => ({ ruleId, state, kind })),
  };
  const result = { ...context, inputFingerprint: citabilityAiInputFingerprint(context) };
  if (!isCitabilityAiContext(result)) throw new Error("invalid_context");
  return result;
}
