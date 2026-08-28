// @input  -- the content-brief constants and the site-side values they mirror
// @output -- a failing test when a mirrored constant drifts from its source of truth
// @pos    -- the app-side alignment pins the package cannot express (it may not import apps/*)
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import {
  CRAWL_DEADLINE_MS,
  CRAWL_FETCH_TIMEOUT_MS,
  ENVELOPE_MS,
  GSC_LOOKBACK_DAYS,
  LLM_DEADLINE_MS,
  NON_WHITESPACE_TOKENIZED_LANGUAGES,
  RUN_BUDGET_MS,
  SECTION_BODY_MAX_BYTES,
  SECTION_ENDPOINT_BUDGET_MS,
  SECTION_MAX_OUTPUT_TOKENS,
  SECTION_REQUEST_MAX_BYTES,
  DRAFT_REQUEST_MAX_BYTES,
  DRAFT_RESULT_MAX_BYTES,
  OUTLINE_CAP,
  SECTION_MAX_SENTENCES,
  SENTENCE_MAX_CHARS,
  SERP_DEADLINE_MS,
} from "@sf/public-tools/content-brief/constants";
import { CONTENT_BRIEF_HANDOFF_MAX_BYTES } from "@sf/public-tools/content-brief/contract";
import { PUBLIC_RESOURCE_DEFAULT_TIMEOUT_MS } from "@sf/sources/public-http";

import { COVERAGE_WINDOW_DAYS } from "./keyword-coverage-reader.ts";
import { SERP_LANGUAGES } from "./serp-markets.ts";

const BRIEF_ROUTE_MAX_DURATION_MS = 300 * 1000;
/** Vercel serverless request body limit (4.5 MB). */
const VERCEL_BODY_LIMIT_BYTES = 4.5 * 1024 * 1024;

describe("content-brief constants stay aligned with what they mirror", () => {
  it("looks back over the same window the coverage reader uses", () => {
    expect(GSC_LOOKBACK_DAYS).toBe(COVERAGE_WINDOW_DAYS);
  });

  it("uses the public fetch's own default timeout per page", () => {
    expect(CRAWL_FETCH_TIMEOUT_MS).toBe(PUBLIC_RESOURCE_DEFAULT_TIMEOUT_MS);
  });

  it("keeps the serial critical path inside the printed budget", () => {
    expect(SERP_DEADLINE_MS + CRAWL_DEADLINE_MS + LLM_DEADLINE_MS + ENVELOPE_MS).toBeLessThanOrEqual(RUN_BUDGET_MS);
    expect(RUN_BUDGET_MS + ENVELOPE_MS).toBeLessThan(BRIEF_ROUTE_MAX_DURATION_MS);
    expect(SECTION_ENDPOINT_BUDGET_MS).toBeLessThan(BRIEF_ROUTE_MAX_DURATION_MS);
  });

  it("sizes section bodies from the model's output ceiling, not a literal", () => {
    expect(SECTION_BODY_MAX_BYTES).toBeGreaterThanOrEqual(SECTION_MAX_OUTPUT_TOKENS * 4 * 1.5);
    expect(SECTION_REQUEST_MAX_BYTES).toBeGreaterThan(DRAFT_REQUEST_MAX_BYTES);
    // The section endpoint carries a whole DraftResult; its cap must cover the largest contract-valid one.
    expect(SECTION_REQUEST_MAX_BYTES).toBeGreaterThan(DRAFT_RESULT_MAX_BYTES + CONTENT_BRIEF_HANDOFF_MAX_BYTES);
    expect(DRAFT_RESULT_MAX_BYTES).toBeGreaterThan(OUTLINE_CAP * SECTION_BODY_MAX_BYTES + OUTLINE_CAP * SECTION_MAX_SENTENCES * SENTENCE_MAX_CHARS * 4);
    // Stays under the platform's request body limit with room to spare.
    expect(SECTION_REQUEST_MAX_BYTES).toBeLessThan(VERCEL_BODY_LIMIT_BYTES);
  });

  it("only refuses tokenisation for languages the SERP selector actually offers", () => {
    for (const language of NON_WHITESPACE_TOKENIZED_LANGUAGES) {
      expect(SERP_LANGUAGES.has(language)).toBe(true);
    }
  });
});
