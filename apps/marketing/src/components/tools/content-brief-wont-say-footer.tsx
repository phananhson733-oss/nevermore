// @input  -- the tool translator and the engine's language allow-list
// @output -- the fixed list of things this brief will not claim
// @pos    -- the boundary footer of the content brief result, after
//            competitor-keyword-gap-coverage.tsx's EVIDENCE_BOUNDARIES

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
 * Handoff §1's "v1 does not" list, rendered in full on every run so a reader
 * never has to infer a boundary from a section that is not there.
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
    <section data-wont-say className={CARD}>
      <h3 className={SECTION_TITLE}>{t("wontSay.title")}</h3>
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
    </section>
  );
}
