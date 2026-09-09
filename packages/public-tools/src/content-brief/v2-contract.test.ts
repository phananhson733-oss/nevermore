import { describe, expect, it } from "vitest";
import * as contract from "./v2-contract.ts";

describe("v2 observed text measurement", () => {
  it.each([
    { text: "  one\n two  ", language: "en", value: 2, unit: "words", tokenizer: "whitespace" },
    { text: "", language: "en", value: 0, unit: "words", tokenizer: "whitespace" },
    { text: "你好 世界。🙂", language: "zh-CN", value: 6, unit: "non_whitespace_characters", tokenizer: "unicode_code_points" },
    { text: "日本語", language: "ja", value: 3, unit: "non_whitespace_characters", tokenizer: "unicode_code_points" },
    { text: "한국 어", language: "ko", value: 3, unit: "non_whitespace_characters", tokenizer: "unicode_code_points" },
    { text: "𠀀𠀁", language: "zh", value: 2, unit: "non_whitespace_characters", tokenizer: "unicode_code_points" },
    { text: "你好 世界", language: "und", value: 4, unit: "non_whitespace_characters", tokenizer: "unicode_code_points" },
    { text: "hello 世界", language: "en", value: 7, unit: "non_whitespace_characters", tokenizer: "unicode_code_points" },
    { text: "ภาษาไทย", language: "und", value: 7, unit: "non_whitespace_characters", tokenizer: "unicode_code_points" },
  ])("measures $language honestly without blocking research", ({ text, language, ...expected }) => {
    expect(contract.measureResearchLength).toBeTypeOf("function");
    expect(contract.measureResearchLength(text, language)).toEqual(expected);
  });
});

describe("the planning-layer language gate", () => {
  it("offers a title to English runs and to nobody whose tag the draft writer would refuse", () => {
    for (const tag of ["en", "EN", "en-GB", "en-US"]) expect(contract.briefPlanningAvailable(tag)).toBe(true);
    for (const tag of ["de", "zh", "zh-CN", "eng"]) expect(contract.briefPlanningAvailable(tag)).toBe(false);
    // An ill-formed tag starts with en and is not English to anything that has
    // to resolve it: the draft writer refuses these outright, so a brief that
    // read the first subtag would offer a title to a run whose draft can never
    // be written and whose result page would then have nowhere to send it.
    for (const tag of ["en--US", "en-US-u", "en_US", ""]) expect(contract.briefPlanningAvailable(tag)).toBe(false);
  });
});
