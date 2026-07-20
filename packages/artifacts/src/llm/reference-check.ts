/**
 * Reference-integrity check (spec §10.2 / §14.4 step 2). The structured-LLM path
 * only accepts an artifact once every factual number it states is traceable to a
 * provided evidence excerpt. This module never mutates its inputs and returns a
 * list of human-readable integrity errors; an empty list means the envelope is
 * clean. The caller (`./openai-client.ts`) turns a non-empty list into a typed
 * `REFERENCE_INTEGRITY` error rather than returning fabricated content.
 *
 * Two guards run:
 *   1. Declared-citation check — every `evidenceRef` and every `citedNumbers`
 *      entry must point at a real `evidenceId`, and each cited number must
 *      actually appear as an exact number token in the evidence excerpt the
 *      model received.
 *   2. Body scan — every factual number in the artifact body must have a valid
 *      `citedNumbers` entry. ICP/action/finding/operator prose is context, never
 *      numeric evidence. Values written as `unknown`/`待确认` are allowed.
 */

import type { ArtifactPromptInput } from "../types.ts";
import {
  canonicalizeCurrentMetadataValue,
  safeEvidenceClaimExcerpt,
  safePromptCurrentMetadata,
  UNKNOWN_PLACEHOLDERS,
} from "./envelope.ts";
import type { LlmArtifactEnvelope } from "./envelope.ts";

/**
 * Candidate numeric tokens. Bare integers are included so prose such as
 * `3 users`, `500 users`, and factual years cannot bypass reference integrity.
 * Explicit Markdown list/step markers are removed before tokenization.
 */
const FACTUAL_NUMBER_RE =
  /(?:(?:[-−][ \t]*[$€£¥]?|[$€£¥][ \t]*[-−]?)[ \t]*)?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(?:%|[x×])?/giu;

const ORDERED_LIST_MARKER_RE = /^(\s{0,3})\d{1,9}[.)](?=[ \t]+|$)[ \t]*/;
const STRUCTURAL_STEP_MARKER_RE =
  /\b((?:step|phase|section)[ \t]+)\d{1,3}(?=[ \t]*[:.)-])/giu;
const WORD_CHARACTER_RE = /[\p{L}\p{N}_]/u;
const CURRENCY_RE = /[$€£¥]/u;
const SIGN_RE = /[-−]/u;

interface FactualNumberToken {
  readonly raw: string;
  readonly canonical: string;
}

function stripStructuralNumberMarkers(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(ORDERED_LIST_MARKER_RE, "$1")
        .replace(STRUCTURAL_STEP_MARKER_RE, "$1"),
    )
    .join("\n");
}

function normalizeNumber(token: string): string | null {
  const compact = token.replace(/[ \t]/g, "").toLowerCase();
  const currency = compact.match(CURRENCY_RE)?.[0] ?? "";
  const negative = SIGN_RE.test(compact);
  const suffixMatch = compact.match(/(%|x|×)$/u);
  const suffix = suffixMatch?.[1] === "×" ? "x" : (suffixMatch?.[1] ?? "");
  const numericText = compact
    .replace(CURRENCY_RE, "")
    .replace(SIGN_RE, "")
    .replace(/(%|x|×)$/u, "")
    .replace(/,/g, "");
  const [integerPart = "0", fractionPart] = numericText.split(".");
  const integer = integerPart.replace(/^0+(?=\d)/u, "") || "0";
  const fraction = fractionPart?.replace(/0+$/u, "") ?? "";
  const normalizedNumeric = fraction.length > 0 ? `${integer}.${fraction}` : integer;

  const sign = negative && normalizedNumeric !== "0" ? "-" : "";
  return `${sign}${currency}${normalizedNumeric}${suffix}`;
}

function extractFactualNumbers(text: string): readonly FactualNumberToken[] {
  const scanText = stripStructuralNumberMarkers(text);
  const tokens: FactualNumberToken[] = [];
  for (const match of scanText.matchAll(FACTUAL_NUMBER_RE)) {
    const matched = match[0];
    const start = match.index;
    const before = start > 0 ? scanText[start - 1] : undefined;
    const after = scanText[start + matched.length];
    if (
      (before !== undefined && WORD_CHARACTER_RE.test(before)) ||
      (after !== undefined && WORD_CHARACTER_RE.test(after))
    ) {
      continue;
    }

    const raw = matched.trim();
    const canonical = normalizeNumber(raw);
    if (canonical !== null) tokens.push({ raw, canonical });
  }
  return tokens;
}

function isUnknownPlaceholder(value: string): boolean {
  const v = value.trim().toLowerCase();
  return UNKNOWN_PLACEHOLDERS.some((p) => v === p.toLowerCase());
}

function singleFactualNumber(value: string): FactualNumberToken | null {
  const tokens = extractFactualNumbers(value);
  const token = tokens[0];
  return tokens.length === 1 && token?.raw === value.trim() ? token : null;
}

function claimContainsNumber(claim: string, value: string): boolean {
  const cited = singleFactualNumber(value);
  if (cited === null) return false;
  const claimNumbers = new Set(
    extractFactualNumbers(claim).map((token) => token.canonical),
  );
  return claimNumbers.has(cited.canonical);
}

/** The text a model authored, used for the body scan. */
function bodyText(envelope: LlmArtifactEnvelope): string {
  if (envelope.kind === "metadata_rewrite") {
    return [
      envelope.proposedTitle,
      envelope.proposedDescription,
      envelope.rationale,
      ...envelope.targetQueries,
    ].join("\n");
  }
  return envelope.markdown;
}

export function checkReferences(input: ArtifactPromptInput, envelope: LlmArtifactEnvelope): readonly string[] {
  const errors: string[] = [];
  const evidenceById = new Map(input.evidence.map((e) => [e.evidenceId, e]));
  const validCitedNumbers = new Set<string>();

  if (envelope.kind === "metadata_rewrite") {
    const expected = safePromptCurrentMetadata(input.currentMetadata);
    for (const field of [
      "url",
      "currentTitle",
      "currentDescription",
    ] as const) {
      const actual =
        expected[field] === null
          ? canonicalizeCurrentMetadataValue(envelope[field])
          : envelope[field];
      if (actual !== expected[field]) {
        errors.push(
          `metadata ${field} does not match the provided currentMetadata`,
        );
      }
    }
  }

  for (const ref of envelope.evidenceRefs) {
    if (!evidenceById.has(ref)) {
      errors.push(`evidenceRef "${ref}" is not one of the provided evidenceIds`);
    }
  }

  for (const cited of envelope.citedNumbers) {
    if (isUnknownPlaceholder(cited.value)) continue;
    const evidence = evidenceById.get(cited.evidenceId);
    if (evidence === undefined) {
      errors.push(`cited number "${cited.value}" references evidenceId "${cited.evidenceId}" that was not provided`);
      continue;
    }
    const excerpt = safeEvidenceClaimExcerpt(evidence.claim);
    if (!claimContainsNumber(excerpt, cited.value)) {
      errors.push(`cited number "${cited.value}" does not appear in evidence "${cited.evidenceId}"`);
      continue;
    }
    const token = singleFactualNumber(cited.value);
    if (token !== null) validCitedNumbers.add(token.canonical);
  }

  const bodyNumbers = new Map<string, string>();
  for (const token of extractFactualNumbers(bodyText(envelope))) {
    if (!bodyNumbers.has(token.canonical)) {
      bodyNumbers.set(token.canonical, token.raw);
    }
  }
  for (const [canonical, raw] of bodyNumbers) {
    if (!validCitedNumbers.has(canonical)) {
      errors.push(
        `factual number "${raw}" in the artifact is not supported by any provided evidence citation`,
      );
    }
  }

  return errors;
}
