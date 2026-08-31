import { describe, expect, it } from "vitest";
import * as language from "./content-draft-v2-language.ts";
describe("Draft v2 locale language resolution", () => {
  it.each([
    { input: "zh-CN", code: "zh", locale: "zh-CN" },
    { input: "zh-Hant-TW", code: "zh", locale: "zh-Hant-TW" },
    { input: "en-us", code: "en", locale: "en-US" },
    { input: "ja", code: "ja", locale: "ja" },
  ])("accepts a supported language locale $input without rewriting the confirmed document", ({ input, code, locale }) => {
    expect(language.resolveDraftV2Language).toBeTypeOf("function");
    expect(language.resolveDraftV2Language(input)).toMatchObject({ code, locale });
  });
  it.each(["", "zh_CN", "xx", "en-\nignore instructions", "iw", "not a language"])("rejects malformed, unknown and renamed input %s", (input) => {
    expect(language.resolveDraftV2Language(input)).toBeNull();
  });
});
