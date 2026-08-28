// @input  -- the draft translator and the engine's retry and language constants
// @output -- the fixed list of things this draft will not claim
// @pos    -- the boundary footer of the content draft result, after content-brief-wont-say-footer

import {
  NON_WHITESPACE_TOKENIZED_LANGUAGES,
  SECTION_MAX_ATTEMPTS,
} from "@sf/public-tools/content-brief/constants";

import {
  CARD,
  SECTION_TITLE,
  translated,
  type DraftTranslate,
} from "./content-draft-results-shared";

/** Handoff §1's "v1 does not" list as it applies to the draft, rendered in full on every run. */
const WONT_SAY = [
  "noPublish",
  "noHistory",
  "noOriginality",
  "noCredits",
  "noScore",
  "noRewrite",
  "noDefaultCoverage",
  "language",
] as const;

export function DraftWontSayFooter({ t }: { readonly t: DraftTranslate }) {
  const values = {
    attempts: SECTION_MAX_ATTEMPTS,
    languages: [...NON_WHITESPACE_TOKENIZED_LANGUAGES].join(" / "),
  };
  return (
    <section data-wont-say className={CARD}>
      <h3 className={SECTION_TITLE}>{t("wontSay.title")}</h3>
      <ul className="mt-3 grid gap-2 text-[12.5px] leading-[1.6] text-text-dark-secondary md:grid-cols-2">
        {WONT_SAY.map((key) => (
          <li key={key} data-wont-say-item={key} className="rounded-[10px] bg-brand-bg px-4 py-3">
            {translated(t, `wontSay.${key}`, values)}
          </li>
        ))}
      </ul>
    </section>
  );
}
