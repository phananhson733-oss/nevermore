// @input  -- one DraftResult's coverage field, the brief it was checked against, and the translator
// @output -- three big counts over the total, then one row per question with status,
//            home section, gap text and cause; or the whole card as an unavailable notice
// @pos    -- top card of the draft result (handoff §5.5); the ONLY thing a reader can
//            use to say the draft answers the brief, so it never renders unavailable as 8/8

import type {
  CoverageItem,
  DraftResult,
} from "@sf/public-tools/content-brief/contract";
import type { SharedContentBrief as ContentBrief } from "@sf/public-tools/content-brief/geo-contract";

import {
  BODY_TEXT,
  CARD,
  DATA_CHIP,
  ID_CHIP,
  PILL,
  SECTION_TITLE,
  chipTone,
  reasonCopy,
  translated,
  type DraftTranslate,
} from "./content-draft-results-shared";

function statusTone(status: CoverageItem["status"]): string {
  switch (status) {
    case "covered":
      return chipTone("positive");
    case "partial":
      return chipTone("caution");
    case "none":
      return "border-brand-error/35 bg-brand-error/[0.10] text-brand-error";
  }
}

function questionText(brief: ContentBrief, id: string): string | null {
  if (brief.must_answer.status !== "available") return null;
  return brief.must_answer.items.find((item) => item.id === id)?.q ?? null;
}

function Figure({
  name,
  value,
  label,
}: {
  readonly name: string;
  readonly value: number;
  readonly label: string;
}) {
  return (
    <div data-coverage-figure={name} className="min-w-0">
      <div className="font-mono text-[28px] font-semibold leading-none tracking-[-0.03em] text-text-dark-primary">
        {value}
      </div>
      <div className="mt-1 font-mono text-[10.5px] tracking-[0.1em] text-text-dark-secondary uppercase">
        {label}
      </div>
    </div>
  );
}

function CoverageRow({
  item,
  brief,
  t,
}: {
  readonly item: CoverageItem;
  readonly brief: ContentBrief;
  readonly t: DraftTranslate;
}) {
  const question = questionText(brief, item.question_id);
  return (
    <li
      data-coverage-item={item.question_id}
      data-coverage-status={item.status}
      data-coverage-cause={item.cause ?? undefined}
      className="rounded-[10px] border border-brand-border-card bg-brand-panel-raised p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span className={`${ID_CHIP} mt-0.5`}>{item.question_id}</span>
          <span className="text-[13px] font-semibold leading-[1.4] text-text-dark-primary">
            {question ?? item.question_id}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {item.covered_in !== null ? (
            <span className={`${DATA_CHIP} ${chipTone("neutral")}`}>
              {t("coverage.coveredIn", { id: item.covered_in })}
            </span>
          ) : null}
          <span className={`${PILL} ${statusTone(item.status)}`}>
            {translated(t, `coverageStatus.${item.status}`)}
          </span>
        </div>
      </div>
      {item.gap !== null ? (
        <p data-coverage-gap className={`mt-2 ${BODY_TEXT}`}>
          <span className="font-mono text-[10px] tracking-[0.12em] uppercase">
            {t("coverage.gap")}
          </span>
          <span className="ml-2">{item.gap}</span>
        </p>
      ) : null}
      {item.cause !== null ? (
        <p data-coverage-cause-copy className={`mt-1 ${BODY_TEXT}`}>
          <span className="font-mono text-[10px] tracking-[0.12em] uppercase">
            {t("coverage.cause")}
          </span>
          <span className="ml-2">{translated(t, `coverageCause.${item.cause}`)}</span>
        </p>
      ) : null}
    </li>
  );
}

export function CoverageCard({
  result,
  brief,
  t,
}: {
  readonly result: DraftResult;
  readonly brief: ContentBrief;
  readonly t: DraftTranslate;
}) {
  const { coverage } = result;
  if (coverage.status === "unavailable") {
    // The whole card, not a row of zeros: an unavailable check has produced
    // no count, and "0 covered of 8" would be a count.
    return (
      <section data-coverage-card data-field-status="unavailable" className={CARD}>
        <h3 className={SECTION_TITLE}>{t("coverage.unavailableTitle")}</h3>
        <p data-unavailable-reason={coverage.reason} className={`mt-3 ${BODY_TEXT}`}>
          {reasonCopy(t, "coverage", coverage.reason)}
        </p>
        <p className={`mt-1 ${BODY_TEXT}`}>{t("coverage.unavailableBody")}</p>
      </section>
    );
  }
  return (
    <section data-coverage-card data-field-status="available" className={CARD}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={SECTION_TITLE}>{t("coverage.title")}</h3>
        <span data-coverage-total className="font-mono text-[12px] text-text-dark-secondary">
          {t("coverage.total", { total: coverage.total })}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4">
        <Figure name="covered" value={coverage.covered} label={t("coverage.covered")} />
        <Figure name="partial" value={coverage.partial} label={t("coverage.partial")} />
        <Figure name="none" value={coverage.none} label={t("coverage.none")} />
      </div>
      <p className={`mt-3 ${BODY_TEXT}`}>{t("coverage.checkNote")}</p>
      <ul className="mt-4 space-y-2">
        {coverage.items.map((item) => (
          <CoverageRow key={item.question_id} item={item} brief={brief} t={t} />
        ))}
      </ul>
    </section>
  );
}
