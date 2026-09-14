import { describe, expect, it } from "vitest";
import en from "../../../../../packages/i18n/src/messages/en.json";
import zh from "../../../../../packages/i18n/src/messages/zh-CN.json";
import { phraseHits, SCOPE_LIMITERS } from "./views-i18n-limiters.ts";

/**
 * Both directions of the scope-limiter ban, against the real confirmation
 * bodies. The gate in `views-i18n.test.ts` only ever sees the catalogue as it
 * is, so without these a list that grew too eager (flagging honest copy) or
 * lost an entry (letting a known rewrite through) would stay green there.
 */

const BODIES = {
  en: [en.workbench.shell.clearSampleConfirm.body, en.workbench.overview.loadDemo.confirmBody],
  "zh-CN": [zh.workbench.shell.clearSampleConfirm.body, zh.workbench.overview.loadDemo.confirmBody],
} as const;

/** Appended rewrites that keep every pinned word and promise the operator's data survives (codex S6r2 #3). */
const BYPASSES = {
  en: [
    "This affects just the sample; user content remains untouched.",
    "Apart from user content.",
    "Other than user content.",
    "It leaves user content intact.",
    "User results remain.",
    "User content is untouched.",
    "It does not affect user content.",
    "It doesn't affect user content.",
    "Just the sample.",
    "Only the sample goes.",
    "Except what you added.",
    "It keeps what you added.",
  ],
  "zh-CN": [
    "说明：这次操作只针对示例；用户内容不受影响。",
    "除用户内容之外。",
    "不动用户内容。",
    "用户内容不受影响。",
    "其余不变。",
    "只针对示例。",
    "限于示例。",
    "仅清除示例。",
    "仅覆盖示例。",
    "仅影响示例。",
    "仅限示例。",
    "除了你自己加的内容。",
  ],
} as const;

/** Honest wording that only looks like a limiter to a substring match (codex S6r2 #6). */
const LEGITIMATE = {
  en: ["This commonly includes user content.", "No exception is made for rows you added."],
  "zh-CN": ["此次操作将清空仅有的运行结果。"],
} as const;

const LOCALES = ["en", "zh-CN"] as const;

describe("scope limiters on the destructive confirmations", () => {
  for (const locale of LOCALES) {
    it(`finds none in the ${locale} bodies as written`, () => {
      for (const body of BODIES[locale]) {
        // Not vacuous: a missing key would be undefined, not a sentence.
        expect(body.length, locale).toBeGreaterThan(40);
        expect(phraseHits(body, SCOPE_LIMITERS[locale]), body).toEqual([]);
      }
    });

    it(`catches every known ${locale} rewrite appended to either body`, () => {
      for (const body of BODIES[locale]) {
        for (const bypass of BYPASSES[locale]) {
          expect(phraseHits(`${body}${bypass}`, SCOPE_LIMITERS[locale]), bypass).not.toEqual([]);
        }
      }
    });

    it(`does not flag honest ${locale} wording that only contains a limiter's letters`, () => {
      for (const body of BODIES[locale]) {
        for (const honest of LEGITIMATE[locale]) {
          expect(phraseHits(`${body}${honest}`, SCOPE_LIMITERS[locale]), honest).toEqual([]);
        }
      }
    });
  }

  it("matches a string case-insensitively and a RegExp as written", () => {
    expect(phraseHits("Never Imported", ["never imported"])).toEqual(["never imported"]);
    expect(phraseHits("commonly", [/\bonly\b/iu])).toEqual([]);
    expect(phraseHits("Only", [/\bonly\b/iu])).toEqual(["\\bonly\\b"]);
  });
});
