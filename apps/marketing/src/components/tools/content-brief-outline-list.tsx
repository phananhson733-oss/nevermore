// @input  -- one ContentBrief's outline field and the tool translator
// @output -- the model-drafted H2/H3 list, each section naming the questions it answers
// @pos    -- whitelisted for the --sc-source-model token (app/source-tokens.test.ts):
//            the left rule on every section is the model colour, because every word
//            of the outline is model-generated

import type { ContentBrief } from "@sf/public-tools/content-brief/contract";
import {
  OUTLINE_CAP,
  OUTLINE_MIN_QUESTIONS,
} from "@sf/public-tools/content-brief/constants";

import {
  BODY_TEXT,
  CARD,
  DATA_CHIP,
  ID_CHIP,
  SECTION_TITLE,
  chipTone,
  joinList,
  reasonCopy,
  type Translate,
} from "./content-brief-results-shared";
import { SourceChip } from "./content-brief-source-chip";

export function OutlineList({
  brief,
  locale,
  t,
}: {
  readonly brief: ContentBrief;
  readonly locale: string;
  readonly t: Translate;
}) {
  const { outline } = brief;
  if (outline.status === "unavailable") {
    // Both thresholds travel with every reason; each sentence reads the one it
    // names and ignores the other.
    const values = { min: OUTLINE_MIN_QUESTIONS, cap: OUTLINE_CAP };
    return (
      <section data-outline data-field-status="unavailable" className={CARD}>
        <h3 className={SECTION_TITLE}>{t("outline.title")}</h3>
        <p
          data-unavailable-reason={outline.reason}
          className={`mt-3 ${BODY_TEXT}`}
        >
          {reasonCopy(t, "outline", outline.reason, values)}
        </p>
      </section>
    );
  }
  return (
    <section data-outline data-field-status="available" className={CARD}>
      <h3 className={SECTION_TITLE}>{t("outline.title")}</h3>
      <p className={`mt-1 ${BODY_TEXT}`}>{t("outline.modelNote")}</p>
      <ol className="mt-4 space-y-3">
        {outline.items.map((item, index) => (
          <li
            key={item.id}
            data-outline-item={item.id}
            className="border-l-2 border-source-model pl-4"
          >
            <div className="flex flex-wrap items-start gap-2">
              <span className={ID_CHIP}>{item.id}</span>
              <span className="text-[14px] font-semibold leading-[1.4] text-text-dark-primary">
                {index + 1}. {item.h2}
              </span>
            </div>
            {item.h3.length > 0 ? (
              <ul className="mt-1.5 space-y-1 pl-6 text-[12.5px] leading-[1.5] text-text-dark-strong">
                {item.h3.map((heading) => (
                  <li key={heading} className="list-disc">
                    {heading}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                data-outline-answers
                className={`${DATA_CHIP} ${chipTone("neutral")}`}
              >
                {t("outline.answers", { ids: joinList(item.answers, locale) })}
              </span>
              <SourceChip provenance={item.provenance} t={t} locale={locale} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
