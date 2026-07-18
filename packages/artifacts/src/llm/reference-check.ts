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
 *      actually appear in that evidence's claim text.
 *   2. Body scan — any statistical figure in the artifact body that is not
 *      present anywhere in the allowlisted input (evidence + ICP/action/finding)
 *      is treated as fabricated. Values written as `unknown`/`待确认` are allowed.
 */

import type { ArtifactPromptInput } from "../types.ts";
import { UNKNOWN_PLACEHOLDERS } from "./envelope.ts";
import type { LlmArtifactEnvelope } from "./envelope.ts";

/**
 * Matches statistical figures that would be fabrication risks: thousands-grouped
 * integers (`1,204`), decimals (`3.5`), percentages (`45%`), and multipliers
 * (`2x`). Bare small integers, list indices, and 4-digit years are intentionally
 * NOT matched so structural numbers do not raise false positives.
 */
const FACTUAL_NUMBER_RE = /\d{1,3}(?:,\d{3})+|\d+\.\d+%?|\d+%|\d+(?:\.\d+)?x/gi;

function normalizeNumber(token: string): string {
  return token.toLowerCase().replace(/,/g, "");
}

function extractFactualNumbers(text: string): readonly string[] {
  const matches = text.match(FACTUAL_NUMBER_RE);
  return matches === null ? [] : matches.map(normalizeNumber);
}

function isUnknownPlaceholder(value: string): boolean {
  const v = value.trim().toLowerCase();
  return UNKNOWN_PLACEHOLDERS.some((p) => v === p.toLowerCase());
}

function claimContainsNumber(claim: string, value: string): boolean {
  return normalizeNumber(claim).includes(normalizeNumber(value));
}

/** The text a model authored, used for the body scan. */
function bodyText(envelope: LlmArtifactEnvelope): string {
  if (envelope.kind === "metadata_rewrite") {
    return [
      envelope.currentTitle,
      envelope.currentDescription,
      envelope.proposedTitle,
      envelope.proposedDescription,
      envelope.rationale,
      ...envelope.targetQueries,
    ].join("\n");
  }
  return envelope.markdown;
}

/** Every factual figure present in the allowlisted input — the legitimate sources. */
function allowedNumbers(input: ArtifactPromptInput): ReadonlySet<string> {
  const parts: string[] = [
    input.operatorInstructions ?? "",
    input.icp.productName,
    input.icp.oneLineDescription,
    ...input.icp.offers,
    ...input.icp.useCases,
    ...input.icp.differentiators,
    input.action.title,
    input.action.description,
    input.action.expectedOutcome,
    input.finding.summary,
    ...input.evidence.map((e) => e.claim),
  ];
  const set = new Set<string>();
  for (const num of extractFactualNumbers(parts.join("\n"))) set.add(num);
  return set;
}

export function checkReferences(input: ArtifactPromptInput, envelope: LlmArtifactEnvelope): readonly string[] {
  const errors: string[] = [];
  const evidenceById = new Map(input.evidence.map((e) => [e.evidenceId, e]));

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
    if (!claimContainsNumber(evidence.claim, cited.value)) {
      errors.push(`cited number "${cited.value}" does not appear in evidence "${cited.evidenceId}"`);
    }
  }

  const allowed = allowedNumbers(input);
  for (const num of extractFactualNumbers(bodyText(envelope))) {
    if (!allowed.has(num)) {
      errors.push(`factual number "${num}" in the artifact is not supported by any provided evidence`);
    }
  }

  return errors;
}
