"use client";

// @input  -- page one for the primary query, as the provider returned it
// @output -- who already holds that query, and whether this page is among them
// @pos    -- the only part of this report that looks outside the site being checked
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { useTranslations } from "next-intl";
import type { SerpLandscape } from "../../lib/agents/audit-contract.ts";

export function OnPageSerpLandscape({
  landscape,
}: {
  readonly landscape: SerpLandscape;
}) {
  const t = useTranslations("tools.onPageChecker.landscape");

  if (landscape.availability === "unavailable") {
    return (
      <p className="text-[13px] text-text-dark-faint">
        {t(`unavailable.${landscape.reason}`)}
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {/*
        Three different sentences, because "your domain is at position 2" and
        "this page is at position 2" are different facts and the second one was
        being told when only the first was known. A rival page of your own
        holding the query is the ordinary case, not an edge one.
      */}
      <p className="text-[14px] text-text-dark-primary">
        {landscape.targetPosition === null
          ? t("summary.absent", {
              query: landscape.query,
              market: landscape.market,
              results: landscape.resultsObserved,
            })
          : landscape.targetPageOnPage
            ? t("summary.present", {
                query: landscape.query,
                market: landscape.market,
                position: landscape.targetPosition,
              })
            : t("summary.otherPage", {
                query: landscape.query,
                market: landscape.market,
                position: landscape.targetPosition,
              })}
      </p>

      {/*
        The reference tool reads competition off how many results Google
        decorates with sitelinks. Published with its basis rather than turned
        into a verdict: sitelinks follow brand and navigational demand, so the
        count says who Google already treats as a destination, which is a
        different sentence from "this query is hard".
      */}
      <p className="text-[13px] text-text-dark-secondary">
        {t("sitelinks", {
          withSitelinks: landscape.withSitelinks,
          results: landscape.resultsObserved,
        })}
      </p>

      {landscape.features !== null && landscape.features.length > 0 && (
        <p className="text-[13px] text-text-dark-secondary">
          {t("features", { features: landscape.features.join(", ") })}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="text-text-dark-faint">
              <th className="py-2 pr-3 font-normal">{t("position")}</th>
              <th className="py-2 pr-3 font-normal">{t("domain")}</th>
              <th className="py-2 pr-3 font-normal">{t("sitelinkColumn")}</th>
            </tr>
          </thead>
          <tbody>
            {landscape.rows.map((row) => (
              <tr
                className="border-t border-border-dark-subtle"
                key={`${row.position}-${row.domain}`}
              >
                <td className="py-2 pr-3 font-mono tabular-nums text-text-dark-secondary">
                  {row.position}
                </td>
                <td
                  className={`py-2 pr-3 ${
                    row.isTarget
                      ? "text-brand-success"
                      : "text-text-dark-primary"
                  }`}
                >
                  {row.domain}
                  {row.isTarget && (
                    <span className="text-text-dark-faint">
                      {" "}
                      {row.isTargetPage === true
                        ? t("youThisPage")
                        : row.isTargetPage === false
                          ? t("youOtherPage")
                          : t("you")}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 text-text-dark-secondary">
                  {row.sitelinkCount === 0 ? "—" : row.sitelinkCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[12.5px] text-text-dark-faint">
        {t("basis", {
          query: landscape.query,
          market: landscape.market,
          language: landscape.language,
        })}
      </p>
    </div>
  );
}
