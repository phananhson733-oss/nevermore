"use client";

// @input  -- the derived keyword region and how many queries the visitor typed
// @output -- where each query lands, the density beside it, and the stated limits
// @pos    -- the part of the report that answers about the visitor's own words
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { useTranslations } from "next-intl";

import type { KeywordEvidence } from "@sf/public-tools/seo-audit/keyword-evidence/types";

export function OnPageKeywordEvidence({
  available,
  submittedQueries,
}: {
  readonly available: Extract<KeywordEvidence, { availability: "available" }>;
  /** What the visitor typed, so a pair merged on the wire is reported as merged. */
  readonly submittedQueries: number;
}) {
  const t = useTranslations("tools.onPageChecker");

  return (
    <>
      <h3 className="text-[15px] text-text-dark-primary">
        {t("sections.keywordHeading")}
      </h3>
      <p className="text-[14px] text-text-dark-primary">
        {t("focus.summary", {
          covered: available.focus.covered,
          applicable: available.focus.applicable,
        })}
      </p>
      <p className="text-[12.5px] text-text-dark-faint">
        {t("focus.notAScore")}
      </p>
      {/*
        A query the visitor typed can be absent from the table: the wire
        normalizes and de-duplicates, so two spellings of one query arrive
        as one. Saying so is cheaper than letting them hunt for it.
      */}
      {available.queries.length < submittedQueries && (
        <p className="text-[12.5px] text-brand-warning">
          {t("provenance.queriesMerged", {
            submitted: submittedQueries,
            measured: available.queries.length,
          })}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="text-text-dark-faint">
              <th className="py-2 pr-3 font-normal">
                {t("table.query")}
              </th>
              <th className="py-2 pr-3 font-normal">
                {t("table.title")}
              </th>
              <th className="py-2 pr-3 font-normal">
                {t("table.description")}
              </th>
              <th className="py-2 pr-3 font-normal">{t("table.h1")}</th>
              <th className="py-2 pr-3 font-normal">
                {t("table.subHeadings")}
              </th>
              <th className="py-2 pr-3 font-normal">
                {t("table.openingText")}
              </th>
              <th className="py-2 pr-3 font-normal">{t("table.url")}</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {available.queries.map((query) => (
              <tr
                className="border-t border-brand-border-card"
                key={query.displayQuery}
              >
                <td className="py-2 pr-3 font-sans text-text-dark-primary">
                  {query.displayQuery}
                  {query.isPrimary && (
                    <span className="ml-2 rounded-full bg-brand-accent/10 px-2 py-0.5 font-mono text-[10.5px] text-brand-accent-text">
                      {t("table.primary")}
                    </span>
                  )}
                  {query.brandCandidate === "matched" && (
                    <span className="ml-2 rounded-full border border-brand-border-card px-2 py-0.5 font-mono text-[10.5px] text-text-dark-faint">
                      {t("table.brand")}
                    </span>
                  )}
                </td>
                {(
                  [
                    query.slots.title,
                    query.slots.description,
                    query.slots.h1,
                    query.slots.subHeadings,
                    query.slots.openingText,
                  ] as const
                ).map((slot, index) => (
                  <td className="py-2 pr-3" key={index}>
                    <SlotCell
                      label={t(`slotStates.${slot.state}`)}
                      occurrences={slot.occurrences}
                      state={slot.state}
                    />
                  </td>
                ))}
                <td className="py-2 pr-3">
                  <SlotCell
                    label={t(`slotStates.${query.slots.url.state}`)}
                    occurrences={null}
                    state={query.slots.url.state}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="grid gap-1.5">
        {available.queries.map((query) => (
          <li
            className="text-[13px] text-text-dark-secondary"
            key={`density-${query.displayQuery}`}
          >
            {query.density === null
              ? t("density.unavailable", { query: query.displayQuery })
              : t("density.value", {
                  query: query.displayQuery,
                  percent: (query.density.value * 100).toFixed(2),
                  units: query.density.denominatorUnits,
                  // Words and CJK characters are both "units" and are not
                  // the same thing; a reader comparing two pages has to
                  // be able to see which was counted.
                  unitsBasis: t(
                    `density.units.${query.density.unitsBasis}`,
                  ),
                  occurrences: query.capturedOccurrences,
                })}
          </li>
        ))}
      </ul>

      {/*
        The declared page role's one consumer. Without it the selector was
        an input that changed nothing, which is the mirror image of a
        required field that changes nothing.
      */}
      <div className="border-t border-brand-border-card pt-4">
        <h3 className="text-[15px] text-text-dark-primary">
          {t("fixes.title")}
        </h3>
        <p className="mt-2 max-w-[640px] text-[13.5px] leading-[1.7] text-text-dark-secondary">
          {t(`fixes.${available.pageRole ?? "homepage"}`)}
        </p>
        <p className="mt-2 text-[12.5px] text-text-dark-faint">
          {t("fixes.basis")}
        </p>
      </div>

      <ul className="grid gap-1.5 border-t border-brand-border-card pt-4">
        {available.limitations.map((code) => (
          <li
            className="text-[12.5px] leading-[1.6] text-text-dark-faint"
            key={code}
          >
            {t(`limitations.${code}`)}
          </li>
        ))}
      </ul>
    </>
  );
}

function SlotCell({
  label,
  occurrences,
  state,
}: {
  readonly label: string;
  readonly occurrences: number | null;
  readonly state: "covered" | "not_covered" | "not_applicable";
}) {
  const tone =
    state === "covered"
      ? "text-brand-success"
      : state === "not_covered"
        ? "text-brand-warning"
        : "text-text-dark-faint";
  return (
    <span className={tone}>
      {label}
      {occurrences !== null && occurrences > 0 && (
        <span className="text-text-dark-faint"> ({occurrences})</span>
      )}
    </span>
  );
}
