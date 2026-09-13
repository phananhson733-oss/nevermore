import { crawlSignals, demoAiDoc, gscSignals } from "@/lib/workbench/mock/profile";
import { formatLocalStamp } from "@/lib/workbench/mock/time";
import type { AuditReport, GscRow, GscRowsSource, Profile, ProfileDoc } from "@/lib/workbench/types";

/**
 * The profile snapshot the "generate" button writes (plan Task 9 Step 1; jsx
 * `ProfileView.run`, jsx:1178-1202).
 *
 * The three source switches are real (codex #6): a switch that is off leaves
 * its field `null` and its builder is never called. The prototype built every
 * signal first and only dropped some when assembling, and it reused ONE crawl
 * object for the third-party estimate as well, so "site crawl" and
 * "third-party metrics" printed identical numbers (jsx P4). Here the estimate is
 * its own variant, drawn from its own seed.
 *
 * GSC signals need rows. With the switch on and nothing imported there is no
 * summary to make: `gscSignals([])` would say "0 queries", a count of a search
 * console export that does not exist. The rows' provenance is frozen into the
 * snapshot beside them (Q6): a document generated from the sample must keep
 * saying so after the operator imports their own rows, and an unknown source
 * (only a tampered envelope makes one) stays unknown instead of becoming either.
 *
 * With a completed audit the crawl shape (pages, indexable, key pages) is read
 * from it, so the profile and the audit report agree (jsx P6); third-party
 * numbers are never observed and stay generated.
 *
 * `now` is taken as a `Date` and formatted here (codex #7): the caller reads the
 * clock when the run finishes, in an event callback, never during render (Q22).
 * The AI part is the bracketed placeholder document (`demoAiDoc`, R8) — there is
 * no model behind this page, so there is no "AI" switch either.
 */

export interface ProfileSources {
  readonly crawl: boolean;
  readonly gsc: boolean;
  readonly third: boolean;
}

export interface BuildProfileDocInput {
  readonly profile: Profile;
  readonly gscRows: readonly GscRow[];
  readonly gscRowsSource: GscRowsSource | null;
  readonly lastAudit: AuditReport | null;
  readonly srcs: ProfileSources;
  readonly now: Date;
}

export function buildProfileDoc(input: BuildProfileDocInput): ProfileDoc {
  const { profile, gscRows, gscRowsSource, lastAudit, srcs, now } = input;
  const gsc = srcs.gsc && gscRows.length > 0 ? gscSignals(profile, gscRows) : null;
  return {
    crawl: srcs.crawl ? crawlSignals(profile, "crawl", lastAudit ?? undefined) : null,
    gsc,
    gscSource: gsc === null ? null : gscRowsSource,
    third: srcs.third ? crawlSignals(profile, "third") : null,
    ai: demoAiDoc(profile),
    at: formatLocalStamp(now),
  };
}
