// @input  -- the site-wide audit records, filtered to the inspected page
// @output -- the checks a single-page fetch cannot answer
// @pos    -- what the full-site crawl buys this tool over a one-page tool
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { SeoAuditRecord } from "@sf/public-tools/seo-audit/types";
import { check, observation, type CheckInput, type OnPageCheck } from "./check-types.ts";

/**
 * Rules that describe this page's place in the site rather than its markup.
 *
 * These are the ones a tool that fetches a single URL cannot answer at all: a
 * duplicate title is only duplicate against the other pages, an orphan is only
 * an orphan because nothing else links to it, and click depth is a property of
 * the path from the homepage. They cost the minute this tool spends crawling.
 */
export const SITE_RULES: readonly {
  readonly id: string;
  readonly max: number;
  readonly failState: "fail" | "warn";
}[] = [
  { id: "title_duplicate", max: 3, failState: "fail" },
  { id: "meta_description_duplicate", max: 3, failState: "warn" },
  { id: "sitemap_page_without_observed_inlink", max: 3, failState: "warn" },
  { id: "page_outbound_broken_link", max: 2, failState: "warn" },
  { id: "click_depth_beyond_reviewed_limit", max: 2, failState: "warn" },
];

function normalize(url: string): string {
  return url.replace(/\/$/, "");
}

function flagged(record: SeoAuditRecord, targetUrl: string): boolean {
  const target = normalize(targetUrl);
  return record.observations.some(
    (entry) => entry.url !== null && normalize(entry.url) === target,
  );
}

/**
 * Whether absence from a rule can be read as passing it.
 *
 * A rule that ran over every collected page covered this one by definition. A
 * rule that tested a qualifying subset now says outright whether this page was
 * in it, which is the question that matters and the one `population` alone
 * could not answer: three of the five rules here are conditional, so every
 * clean page was told "that rule did not cover this page" — false whenever the
 * page qualified, which is the common case — and eight of the thirteen points
 * were unreachable.
 *
 * Unknown stays unknown. `targetTested` is null when the rule counts something
 * other than pages, and absence there is still not evidence.
 */
function absenceIsEvidence(record: SeoAuditRecord): boolean {
  if (record.population === "every_collected_page") return true;
  return record.targetTested === true;
}

export function siteChecks(input: CheckInput): readonly OnPageCheck[] {
  const checks: OnPageCheck[] = [];
  for (const rule of SITE_RULES) {
    const record = input.siteRecords.find((entry) => entry.id === rule.id);
    if (record === undefined) continue;

    if (flagged(record, input.extract.url)) {
      checks.push(
        check(
          rule.id,
          "site",
          rule.failState,
          0,
          rule.max,
          `site.${rule.id}.flagged`,
          { affected: record.affected, tested: record.tested },
        ),
      );
      continue;
    }

    if (absenceIsEvidence(record)) {
      checks.push(
        check(rule.id, "site", "pass", rule.max, rule.max, `site.${rule.id}.clear`, {
          tested: record.tested,
        }),
      );
      continue;
    }

    checks.push(
      observation(rule.id, "site", `site.${rule.id}.notTested`, {
        tested: record.tested,
      }),
    );
  }
  return checks;
}
