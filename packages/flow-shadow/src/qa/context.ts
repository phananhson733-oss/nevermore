import type { QaEvaluationInput } from "../types.ts";
import { buildSourceIndex, type SourceIndex } from "./claims.ts";
import {
  isEnglishLocale,
  partitionDraft,
  readDraft,
  tokenize,
  type DraftLine,
  type DraftView,
  type ReferenceSection,
} from "./text.ts";

/** Everything the rules read, derived once so every rule sees the same draft. */
export interface QaContext {
  readonly input: QaEvaluationInput;
  readonly view: DraftView;
  /**
   * Every prose line that is NOT inside a reference list. Together with
   * `referenceSections` this is a total partition of `view.prose` — no line
   * belongs to neither half, which is the property that stops a fabricated
   * bibliography from landing in a region no rule reads.
   */
  readonly body: readonly DraftLine[];
  /** The draft's reference lists, whatever they are titled. */
  readonly referenceSections: readonly ReferenceSection[];
  readonly index: SourceIndex;
  readonly english: boolean;
  /** May be `""` — the rules that need it then report `unevaluable`. */
  readonly targetKeyword: string;
  readonly targetKeywordTokens: readonly string[];
  readonly draftTokens: readonly string[];
}

/**
 * The frozen cluster's keyword. `briefOutline.targetKeywords` is part of the
 * hashed manifest, so this is a frozen input rather than a live lookup: the same
 * frozen run always judges against the same keyword.
 */
function resolveTargetKeyword(input: QaEvaluationInput): string {
  const first = input.pack.briefOutline.targetKeywords[0];
  if (first !== undefined && first.trim().length > 0) return first.trim();
  const clusterKey = input.pack.searchObservation.clusterKey;
  return clusterKey.replace(/[-_]+/g, " ").trim();
}

export function buildQaContext(input: QaEvaluationInput): QaContext {
  const view = readDraft(input.draftMarkdown);
  const targetKeyword = resolveTargetKeyword(input);
  const partition = partitionDraft(view);
  return {
    input,
    view,
    body: partition.body,
    referenceSections: partition.reference,
    index: buildSourceIndex(input.pack),
    english: isEnglishLocale(input.pack.outputLocale),
    targetKeyword,
    targetKeywordTokens: tokenize(targetKeyword),
    draftTokens: tokenize(view.prose.map((entry) => entry.text).join(" ")),
  };
}
