import type { QaEvaluationInput } from "../types.ts";
import { buildSourceIndex, type SourceIndex } from "./claims.ts";
import {
  bodyBefore,
  isEnglishLocale,
  readDraft,
  TAIL_SECTION_TITLES,
  tokenize,
  type DraftLine,
  type DraftView,
} from "./text.ts";

/** Everything the rules read, derived once so every rule sees the same draft. */
export interface QaContext {
  readonly input: QaEvaluationInput;
  readonly view: DraftView;
  /** Prose before `Sources`/`References`/`Related Reading`. */
  readonly body: readonly DraftLine[];
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
  return {
    input,
    view,
    body: bodyBefore(view, TAIL_SECTION_TITLES),
    index: buildSourceIndex(input.pack),
    english: isEnglishLocale(input.pack.outputLocale),
    targetKeyword,
    targetKeywordTokens: tokenize(targetKeyword),
    draftTokens: tokenize(
      view.prose.map((entry) => entry.text).join(" "),
    ),
  };
}
