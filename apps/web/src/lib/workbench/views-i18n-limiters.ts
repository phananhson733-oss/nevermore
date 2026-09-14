/**
 * Phrases the copy gate (`views-i18n.test.ts`) bans per key, and the one
 * matcher both that gate and `views-i18n-limiters.test.ts` use, so the cases
 * that pin the matcher are the cases the gate runs. Test support only: no
 * production module imports this file.
 *
 * A string is a case-insensitive substring, which suits Chinese and multi-word
 * English phrases. A single English word is a `RegExp` with word boundaries:
 * as a substring "only" hits "commonly" and "except" hits "exception", which is
 * a false alarm on copy that says nothing narrower.
 */
export type Phrase = string | RegExp;

/** The phrases found in `text`, as their source spelling; empty when none is. */
export function phraseHits(
  text: string,
  phrases: readonly Phrase[],
): readonly string[] {
  const lower = text.toLowerCase();
  return phrases
    .filter((phrase) =>
      typeof phrase === "string"
        ? lower.includes(phrase.toLowerCase())
        : phrase.test(text),
    )
    .map((phrase) => (typeof phrase === "string" ? phrase : phrase.source));
}

/**
 * Scope limiters banned from the two destructive confirmations
 * (`shell.clearSampleConfirm.body`, `overview.loadDemo.confirmBody`).
 *
 * The gate's `REQUIRED` table pins what those bodies name by PRESENCE, and a
 * negator or limiter sits outside every pinned substring: 「不包括载入示例之后你自己加的内容」,
 * 「但保留所有已有的运行结果」 and an added 「只会影响示例站点」 each kept every pin
 * and turned the warning into a promise that the operator's data survives —
 * with `Topbar.test.tsx`'s literal updated to match, all three gates stayed
 * green. A second round (codex S6r2 #3) appended 「这次操作只针对示例；用户内容不受影响」
 * and "just the sample; user content remains untouched" past the first list.
 * Neither body needs any of these to say what it says, so they are banned
 * outright.
 *
 * A finite list cannot prove the sentence honest; it closes the rewrites found
 * so far. The Chinese 「仅」 is narrowed to the scope phrases, because 「仅有的运行结果」
 * describes what is cleared without limiting it.
 */
export const SCOPE_LIMITERS: Readonly<
  Record<"en" | "zh-CN", readonly Phrase[]>
> = {
  "zh-CN": [
    "不包括",
    "不含",
    "除了",
    /除.{0,12}之外/u,
    "保留",
    "不会清",
    "不会覆盖",
    "不影响",
    "不受影响",
    "不动",
    "其余不变",
    "只会",
    "只针对",
    "限于",
    "仅清除",
    "仅覆盖",
    "仅影响",
    "仅限",
  ],
  en: [
    /\bexcluding\b/iu,
    /\bexcept\b/iu,
    /\bkeeps?\b/iu,
    /\bnot including\b/iu,
    /\bwon['’]t\b/iu,
    /\bonly\b/iu,
    /\bapart from\b/iu,
    /\bother than\b/iu,
    /\bleaves?\b/iu,
    /\bremain(?:s|ed|ing)?\b/iu,
    /\buntouched\b/iu,
    // No `\b` before "n't": "doesn't" has no word boundary between s and n.
    /(?:\bnot|n['’]t) affect/iu,
    /\bjust the sample\b/iu,
  ],
};
