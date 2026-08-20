// @input  -- per-stage usage records handed to the sink in call order
// @output -- a failing test when a run's model calls stop adding up
// @pos    -- the guard on the wire between the model seams and the cost log
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import { createKeywordLlmUsageSink } from "./keyword-llm-usage-sink.ts";

describe("keyword LLM usage sink", () => {
  it("totals both stages of a run", () => {
    const sink = createKeywordLlmUsageSink();
    sink.add("extract_propositions", {
      inputTokens: 900,
      outputTokens: 120,
      requestCount: 2,
      retryCount: 1,
    });
    sink.add("expand_candidates", {
      inputTokens: 1200,
      outputTokens: 300,
      requestCount: 1,
      retryCount: 0,
    });
    sink.add("interpret_serp_evidence", {
      inputTokens: 700,
      outputTokens: 180,
      requestCount: 2,
      retryCount: 1,
    });

    expect(sink.total()).toEqual({
      inputTokens: 2800,
      outputTokens: 600,
      requestCount: 5,
      retryCount: 2,
    });
  });

  it("counts nothing before the first call", () => {
    // The cost report reads this even on a run that failed before the model,
    // and an invented zero-token line would read as a measurement.
    expect(createKeywordLlmUsageSink().total()).toEqual({
      inputTokens: null,
      outputTokens: null,
      requestCount: 0,
      retryCount: 0,
    });
  });

  it("keeps a stage that reported no token counts from erasing one that did", () => {
    // Null is "the provider said nothing about tokens", not zero. Absorbing
    // 900 into null would let a retry storm hide behind a blank cost line.
    const sink = createKeywordLlmUsageSink();
    sink.add("extract_propositions", {
      inputTokens: 900,
      outputTokens: 0,
      requestCount: 1,
      retryCount: 0,
    });
    sink.add("expand_candidates", {
      inputTokens: null,
      outputTokens: null,
      requestCount: 1,
      retryCount: 0,
    });

    expect(sink.total().inputTokens).toBe(900);
    expect(sink.total().requestCount).toBe(2);
  });
});
