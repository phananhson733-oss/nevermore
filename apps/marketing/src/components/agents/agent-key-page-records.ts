// @input  -- the joined record ledger a run published, and which page is being judged
// @output -- the records that can honestly say something about THAT page
// @pos    -- pure filter; the fail-closed half of judging more than one page

import type { SeoAuditRecord } from "@sf/public-tools";
import {
  KEYWORD_EVIDENCE_RECORD_IDS,
  PAGE_SHAPE_RECORD_IDS,
} from "@sf/public-tools/seo-audit/keyword-evidence/records";
import { PAGE_PERFORMANCE_RECORD_IDS } from "@sf/public-tools/seo-audit/page-performance";
import { SERP_SHAPE_RECORD_IDS } from "@sf/public-tools/seo-audit/serp-shape";

/**
 * Records that only ever describe the page the visitor submitted.
 *
 * Listed by id rather than derived from `population`, because the population
 * field does not separate them: `target_query_ranking_band` is published as a
 * `conditional_subset` like any crawl record, and a population-based filter
 * would leave it in. It would then reach a different key page, find no
 * observation for it, and be excluded under the crawl's "precondition" wording
 * -- a different sentence from the rest of its own region, for no reason a
 * reader could work out.
 *
 * The regions behind these ids are each derived once, for the submitted URL:
 * the keyword evidence is about one confirmed query on one page, CrUX and the
 * SERP sample were requested for one URL, and the ranking band belongs to that
 * query. None of them was measured for any other page, and this run does not
 * spend a provider call to change that.
 */
const TARGET_ONLY_RECORD_IDS: ReadonlySet<string> = new Set([
  ...KEYWORD_EVIDENCE_RECORD_IDS,
  // Split out of the keyword region after this filter was written, and the
  // filter was not told. They are `target_page`, which `projectRecordToTarget`
  // returns untouched, so the submitted page's heading counts, schema fit and
  // section substance were republished as every other key page's -- hits and
  // URLs included.
  ...PAGE_SHAPE_RECORD_IDS,
  ...PAGE_PERFORMANCE_RECORD_IDS,
  ...SERP_SHAPE_RECORD_IDS,
  "target_query_ranking_band",
]);

export interface AgentKeyPageRecordsInput {
  readonly records: readonly SeoAuditRecord[];
  /** True only for the page the visitor actually submitted. */
  readonly isSubmittedTarget: boolean;
}

/**
 * The records a given key page may be judged from.
 *
 * For the submitted page: everything, exactly as before.
 *
 * For any other key page, two things change. Records that only describe the
 * submitted page are dropped, and every remaining `conditional_subset` record
 * loses its `targetTested` flag.
 *
 * That second part is the whole point. `projectRecordToTarget` reads
 * `targetTested` to decide whether "this page has no observation" means the
 * page is clean or that it was never tested -- and that flag was computed once,
 * for the crawl's target, and cached. Carried onto another page it answers a
 * question about a different page: on a site whose home page has a title, every
 * titleless key page would be reported as passing the title check. Clearing it
 * sends those records down the existing `unverified` branch instead, which is
 * the honest answer and needs no new vocabulary.
 *
 * The cost is stated rather than hidden: on a key page that is not the
 * submitted one, these checks can report a hit but never a pass.
 */
export function recordsForKeyPage({
  records,
  isSubmittedTarget,
}: AgentKeyPageRecordsInput): readonly SeoAuditRecord[] {
  if (isSubmittedTarget) return records;
  return records
    .filter((record) => !TARGET_ONLY_RECORD_IDS.has(record.id))
    .map((record) =>
      record.population === "conditional_subset" && record.targetTested !== null
        ? { ...record, targetTested: null }
        : record,
    );
}
