// @input  -- a confirmed context, a frozen query set and a report claiming to be theirs
// @output -- whether those three describe one run, checked against content and not only digests
// @pos    -- the one rule both the session restore and the AI brief ask before trusting a pairing

import type { GeoContextSnapshotV1 } from "./geo-context.ts";
import type { GeoQuerySetV1 } from "./geo-query-contract.ts";
import type { GeoReportDataV3 } from "./geo-report-contract.ts";

/**
 * Why a digest comparison is not enough on its own.
 *
 * `isGeoContextSnapshotV1` and `isGeoQuerySetV1` are shape guards; neither
 * recomputes the fingerprint it carries, because both are synchronous and the
 * hash is not. So "the stored digest equals the report's digest" only says the
 * two strings match — a stored payload whose questions were edited while its
 * declared digest was left alone passes every check and then produces a brief
 * whose planned-call count disagrees with the report printed beside it.
 *
 * Recomputing the hash here would mean making the restore path async, which is
 * its own change. Comparing the content the digest is supposed to identify is
 * cheap, synchronous, and catches the case that actually matters: the query set
 * and the report must describe the same eight questions, asked the same way,
 * the same number of times.
 *
 * This is a consistency check, not a security boundary. Web Storage belongs to
 * whoever holds the tab, and a page that can rewrite it can rewrite anything
 * else on the page too.
 */
export function isGeoRunSelfConsistent(
  context: GeoContextSnapshotV1,
  querySet: GeoQuerySetV1,
  report: GeoReportDataV3,
): boolean {
  if (context.contextHash !== report.run.contextHash) return false;
  if (context.targetHost !== report.run.targetHost) return false;
  if (querySet.querySetContentHash !== report.run.querySetContentHash) {
    return false;
  }
  if (querySet.contextHash !== context.contextHash) return false;

  // One question per confirmed core query, and nothing extra. A report carrying
  // a question the visitor never confirmed is not this run's report.
  const core = querySet.queries.filter((query) => query.cohort === "core");
  if (core.length !== report.questions.length) return false;

  const observed = new Map(
    report.questions.map((question) => [question.queryId, question]),
  );
  if (observed.size !== report.questions.length) return false;

  for (const query of core) {
    const question = observed.get(query.queryId);
    if (question === undefined) return false;
    // Text, mode, slot and depth: the four facts that decide what a ratio in
    // the report means and what the brief says was paid for.
    if (question.text !== query.text) return false;
    if (question.mode !== query.mode) return false;
    if (question.slot !== query.slot) return false;
    if (question.samplesPlanned !== query.samplesPlanned) return false;
  }
  return true;
}
