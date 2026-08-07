// @input  -- SeoAuditRecord payload fields from @sf/public-tools
// @output -- record ordering/grouping arithmetic plus bilingual result copy
// @pos    -- presentation-layer derivations for the public SEO Audit results
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { SeoAuditRecord } from "@sf/public-tools";

export type SeoAuditResultCopyLocale = "en" | "zh";

export function resultCopyLocale(locale: string): SeoAuditResultCopyLocale {
  return locale === "zh" ? "zh" : "en";
}

export interface SeoAuditRecordPartition {
  /** affected > 0, ordered by observed count descending — arithmetic, not severity. */
  readonly observed: readonly SeoAuditRecord[];
  /** Could not be checked this run; not the same fact as "observed nothing". */
  readonly unverified: readonly SeoAuditRecord[];
  /** Checked, nothing observed; collapsible as one summary line. */
  readonly nothingObserved: readonly SeoAuditRecord[];
}

export function partitionRecords(
  records: readonly SeoAuditRecord[],
): SeoAuditRecordPartition {
  return {
    observed: records
      .filter((entry) => entry.affected > 0)
      .toSorted((a, b) => b.affected - a.affected),
    unverified: records.filter(
      (entry) => entry.affected === 0 && entry.state === "unverified",
    ),
    nothingObserved: records.filter(
      (entry) => entry.affected === 0 && entry.state !== "unverified",
    ),
  };
}

/** Observed site-resource records state a resource was found, not an issue. */
export function observedIssueRecords(
  records: readonly SeoAuditRecord[],
): readonly SeoAuditRecord[] {
  return partitionRecords(records).observed.filter(
    (entry) => entry.unit !== "site_resource",
  );
}

export interface SeoAuditDuplicateGroup {
  readonly value: string;
  /** The engine-reported matching_pages count, not a re-derived number. */
  readonly pageCount: number;
  readonly urls: readonly string[];
}

/* Mirrors the engine's normalisation so display grouping never invents a
   distinction the engine did not observe. */
function normalizeComparableText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

/**
 * Groups duplicate-type per-URL observations into one row per distinct value.
 * Returns null when the record does not carry the grouped evidence shape
 * (URL + one text value + matching_pages), so callers can fall back to the
 * per-URL rendering unchanged.
 */
export function duplicateGroups(
  record: SeoAuditRecord,
): readonly SeoAuditDuplicateGroup[] | null {
  if (record.observations.length === 0) return null;

  const groups = new Map<
    string,
    { value: string; pageCount: number; urls: string[] }
  >();
  for (const observation of record.observations) {
    if (observation.url === null) return null;
    const matching = observation.values.find(
      (entry) => entry.label === "matching_pages",
    );
    const text = observation.values.find(
      (entry) =>
        entry.label !== "matching_pages" && typeof entry.value === "string",
    );
    if (
      !matching ||
      typeof matching.value !== "number" ||
      typeof text?.value !== "string"
    ) {
      return null;
    }
    const key = normalizeComparableText(text.value);
    const group = groups.get(key) ?? {
      value: text.value,
      pageCount: matching.value,
      urls: [],
    };
    groups.set(key, { ...group, urls: [...group.urls, observation.url] });
  }

  return [...groups.values()].toSorted((a, b) => b.pageCount - a.pageCount);
}

export function pageCountLabel(
  count: number,
  locale: SeoAuditResultCopyLocale,
): string {
  if (locale === "zh") return `${count} 个页面`;
  return count === 1 ? "1 page" : `${count} pages`;
}

export function zeroObservationSummary(
  names: readonly string[],
  locale: SeoAuditResultCopyLocale,
): string {
  if (locale === "zh") {
    return `${names.length} 项检查未观察到对应情况：${names.join("、")}`;
  }
  const noun = names.length === 1 ? "check" : "checks";
  return `${names.length} ${noun} observed nothing: ${names.join(", ")}`;
}

export interface SeoAuditLegendCopy {
  readonly title: string;
  readonly observed: string;
  readonly notObserved: string;
  readonly unverified: string;
}

const LEGEND: Record<SeoAuditResultCopyLocale, SeoAuditLegendCopy> = {
  en: {
    title: "Reading the record states",
    observed:
      "Observed — the condition this check looks for was present in the collected evidence. It is a recorded fact, not a severity rating. For the two site-resource checks it only means the resource was found.",
    notObserved:
      "Not observed — the check ran and the condition was not present in the pages we collected.",
    unverified:
      "Unverified — this run could not test the condition. That is not evidence of absence.",
  },
  zh: {
    title: "状态标识说明",
    observed:
      "Observed（已观察到）——该检查项对应的情况出现在本次采集的证据里。这只是记录到的事实，不是严重程度评级。对两项站点资源检查而言，它只表示资源被找到了。",
    notObserved:
      "Not observed（未观察到）——检查已执行，所采集页面中未出现该情况。",
    unverified:
      "Unverified（无法核实）——本次运行无法检验该情况，这不代表它不存在。",
  },
};

export function legendCopy(
  locale: SeoAuditResultCopyLocale,
): SeoAuditLegendCopy {
  return LEGEND[locale];
}

export interface SeoAuditClosingCopy {
  readonly heading: string;
  /** Set only when more issue types were observed than the list shows. */
  readonly topNote: string | null;
  readonly boundary: string;
  readonly cta: string;
}

export function closingCopy(
  summary: {
    readonly pagesInspected: number;
    readonly issueTypeCount: number;
  },
  locale: SeoAuditResultCopyLocale,
): SeoAuditClosingCopy {
  const { pagesInspected, issueTypeCount } = summary;
  if (locale === "zh") {
    return {
      heading:
        issueTypeCount === 0
          ? `我们检查了 ${pagesInspected} 个页面，未观察到本工具检测的任何一类问题。`
          : `我们检查了 ${pagesInspected} 个页面，观察到 ${issueTypeCount} 类问题：`,
      topNote:
        issueTypeCount > 3
          ? `按观察数取前三，全部 ${issueTypeCount} 类的完整清单见上文。`
          : null,
      boundary:
        issueTypeCount === 0
          ? "这些是我们从公开 HTML 里能核实的全部。哪些页面真的有排名和流量，只存在于你的 Search Console 里。"
          : "这些是我们从公开 HTML 里能核实的全部。我们无法告诉你先修哪一个——那需要知道哪些页面真的有排名和流量，而那只存在于你的 Search Console 里。",
      cta: "连接 Search Console，查看哪些页面真的有排名和流量",
    };
  }
  const pagesNoun = pagesInspected === 1 ? "page" : "pages";
  const typesNoun = issueTypeCount === 1 ? "issue type" : "issue types";
  return {
    heading:
      issueTypeCount === 0
        ? `We checked ${pagesInspected} ${pagesNoun} and observed none of the issue conditions this audit tests for.`
        : `We checked ${pagesInspected} ${pagesNoun} and observed ${issueTypeCount} ${typesNoun}:`,
    topNote:
      issueTypeCount > 3
        ? `Top three by observed count — the full list of ${issueTypeCount} is above.`
        : null,
    boundary:
      issueTypeCount === 0
        ? "These are everything we can verify from public HTML. Which pages actually have rankings and traffic exists only in your Search Console."
        : "These are everything we can verify from public HTML. We cannot tell you which to fix first — that requires knowing which pages actually have rankings and traffic, and that exists only in your Search Console.",
    cta: "Connect Search Console to see which pages actually rank and get traffic",
  };
}
