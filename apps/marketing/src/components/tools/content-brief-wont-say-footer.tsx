// @input  -- the tool translator and the engine's language allow-list
// @output -- all v1 boundaries retained in a closed native disclosure
// @pos    -- compact boundary footer after the Content Brief Draft/JSON handoff

import {
  MUST_ANSWER_MIN_PAGES,
  NON_WHITESPACE_TOKENIZED_LANGUAGES,
} from "@sf/public-tools/content-brief/constants";

import {
  CARD,
  SECTION_TITLE,
  translated,
  type Translate,
} from "./content-brief-results-shared";

/**
 * Handoff §1's "v1 does not" list remains inspectable on every run without
 * displacing the Draft/JSON handoff. Collapsing the list removes no boundary.
 */
const WONT_SAY = [
  "noRewrite",
  "threeStates",
  "noWithdraw",
  "noPublish",
  "noHistory",
  "noOriginality",
  "noCredits",
  "noPaa",
  "noScore",
  "language",
] as const;

export function WontSayFooter({ t }: { readonly t: Translate }) {
  const values = {
    minPages: MUST_ANSWER_MIN_PAGES,
    languages: [...NON_WHITESPACE_TOKENIZED_LANGUAGES].join(" / "),
  };
  return (
    <details data-wont-say data-wont-say-details className={CARD}>
      <summary className={`${SECTION_TITLE} cursor-pointer border-t border-brand-border-card pt-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent`}>
        {t("wontSay.title")}
      </summary>
      <ul className="mt-3 grid gap-2 text-[12.5px] leading-[1.6] text-text-dark-secondary md:grid-cols-2">
        {WONT_SAY.map((key) => (
          <li
            key={key}
            data-wont-say-item={key}
            className="rounded-[10px] bg-brand-bg px-4 py-3"
          >
            {translated(t, `wontSay.${key}`, values)}
          </li>
        ))}
      </ul>
    </details>
  );
}
