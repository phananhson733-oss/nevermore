"use client";

// @input  -- the page's repeated-phrase tables and the visitor's own queries
// @output -- one leaderboard per phrase length, with the target words marked
// @pos    -- what the page is actually about, as opposed to what it was asked about
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { KeywordEvidence } from "@sf/public-tools/seo-audit/keyword-evidence/types";
import type { SeoAuditTargetPageExtract } from "@sf/public-tools/seo-audit/types";

type Coverage = "full" | "partial" | "none";

/**
 * Compare the way the counter counts.
 *
 * Latin text is compared word by word and CJK character by character, which is
 * the same split the units were built with — so "免费星盘" and "免费星" overlap
 * the way a reader would expect, and "chart" is not found inside "charter".
 */
function tokens(value: string): readonly string[] {
  const lowered = value.toLocaleLowerCase("en-US");
  const out: string[] = [];
  for (const chunk of lowered.split(/\s+/u)) {
    if (chunk === "") continue;
    let latin = "";
    for (const char of chunk) {
      if (/[\u3400-\u9fff\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/u.test(char)) {
        if (latin !== "") {
          out.push(latin);
          latin = "";
        }
        out.push(char);
        continue;
      }
      latin += char;
    }
    if (latin !== "") out.push(latin);
  }
  return out;
}

function containsSequence(
  haystack: readonly string[],
  needle: readonly string[],
): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  return haystack.some((_entry, start) =>
    needle.every((token, offset) => haystack[start + offset] === token),
  );
}

/**
 * How much of a submitted query this row accounts for.
 *
 * `full` is the whole query, in order, inside the phrase — the row is the thing
 * someone is trying to rank for. `partial` shares a word with it, which is what
 * most of a good page's leaderboard looks like and is not a defect.
 */
export function coverageOf(
  phrase: string,
  queries: readonly string[],
): Coverage {
  const phraseTokens = tokens(phrase);
  let partial = false;
  for (const query of queries) {
    const queryTokens = tokens(query);
    if (containsSequence(phraseTokens, queryTokens)) return "full";
    if (queryTokens.some((token) => phraseTokens.includes(token))) {
      partial = true;
    }
  }
  return partial ? "partial" : "none";
}

const COVERAGE_STYLE: Readonly<Record<Coverage, string>> = {
  full: "text-brand-success",
  partial: "text-brand-warning",
  none: "text-text-dark-primary",
};

export function OnPageTermTables({
  extract,
  evidence,
}: {
  readonly extract: SeoAuditTargetPageExtract;
  readonly evidence: KeywordEvidence;
}) {
  const t = useTranslations("tools.onPageChecker.terms");
  const tables = extract.termFrequencies ?? [];
  // Two words is where a leaderboard starts saying something: one word is
  // vocabulary, and three or more is usually a sentence fragment.
  const [size, setSize] = useState(2);

  const queries = useMemo(
    () =>
      evidence.availability === "available"
        ? evidence.queries.map((query) => query.displayQuery)
        : [],
    [evidence],
  );

  const total = extract.staticBodyUnits?.units ?? 0;
  const active = tables.find((table) => table.size === size) ?? tables[0];

  if (tables.length === 0 || active === undefined || total === 0) {
    return (
      <p className="text-[12.5px] text-text-dark-faint">{t("unavailable")}</p>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-1.5">
        {tables.map((table) => (
          <button
            key={table.size}
            type="button"
            onClick={() => setSize(table.size)}
            aria-pressed={table.size === active.size}
            className={`rounded-full border px-3 py-1 text-[12.5px] transition-colors ${
              table.size === active.size
                ? "border-brand-primary text-text-dark-primary"
                : "border-border-dark-subtle text-text-dark-faint hover:text-text-dark-secondary"
            }`}
          >
            {t("sizeLabel", { size: table.size })}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="text-text-dark-faint">
              <th className="py-2 pr-3 font-normal">{t("phrase")}</th>
              <th className="py-2 pr-3 font-normal">{t("count")}</th>
              <th className="py-2 pr-3 font-normal">{t("frequencyDensity")}</th>
              <th className="py-2 pr-3 font-normal">{t("occupancyDensity")}</th>
            </tr>
          </thead>
          <tbody>
            {active.rows.map((row) => {
              const coverage = coverageOf(row.phrase, queries);
              return (
                <tr
                  key={row.phrase}
                  className="border-t border-border-dark-subtle"
                >
                  <td className={`py-2 pr-3 ${COVERAGE_STYLE[coverage]}`}>
                    {row.phrase}
                  </td>
                  <td className="py-2 pr-3 text-text-dark-secondary">
                    {row.count}
                  </td>
                  <td className="py-2 pr-3 text-text-dark-secondary">
                    {((row.count / total) * 100).toFixed(2)}%
                  </td>
                  {/*
                    A five-word phrase occupying 5% of the page is not the same
                    fact as a one-word term occupying 5%, and reading only the
                    first column makes long phrases look negligible.
                  */}
                  <td className="py-2 pr-3 text-text-dark-secondary">
                    {(((row.count * active.size) / total) * 100).toFixed(2)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[12.5px] text-text-dark-faint">
        {t("basis", { total })}
      </p>
      {queries.length > 0 && (
        <p className="text-[12.5px] text-text-dark-faint">{t("legend")}</p>
      )}
      <p className="text-[12.5px] text-text-dark-faint">{t("stopWords")}</p>
    </div>
  );
}
