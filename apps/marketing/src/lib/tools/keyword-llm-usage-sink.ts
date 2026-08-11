// @input  -- per-stage LLM usage as each model call finishes
// @output -- one running total the cost report can read at the end of a run
// @pos    -- the wire between `createKeywordLlmSeams({onUsage})` and the cost log
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  EMPTY_KEYWORD_LLM_USAGE,
  mergeKeywordLlmUsage,
  type KeywordLlmUsage,
} from "./keyword-llm-client.ts";

export interface KeywordLlmUsageSink {
  /** Pass as `onUsage`; the stage name is accepted and ignored. */
  readonly add: (stage: string, usage: KeywordLlmUsage) => void;
  /** The run's total, for the cost report. */
  readonly total: () => KeywordLlmUsage;
}

/**
 * One mutable total per request.
 *
 * The stage name is dropped on purpose. Per-stage numbers would be the more
 * interesting record, but the cost line is a single JSON object read by a
 * human scanning a log, and two more nested counters buy less than they cost
 * to read. The one number that changes a decision is `retryCount`: it is how
 * often the model had to be asked twice.
 */
export function createKeywordLlmUsageSink(): KeywordLlmUsageSink {
  let total = EMPTY_KEYWORD_LLM_USAGE;
  return {
    add: (_stage, usage) => {
      total = mergeKeywordLlmUsage(total, usage);
    },
    total: () => total,
  };
}
