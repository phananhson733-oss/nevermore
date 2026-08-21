// @input  -- one contract-valid v3 report and the active locale
// @output -- every denominator beside its own numerator, and every link exactly as cited
// @pos    -- the only rendering of GEO evidence; every number here comes from the payload

"use client";

import { useTranslations } from "next-intl";

import type {
  GeoCitationEvidenceRefV1,
  GeoQuestionObservationV3,
  GeoReportDataV3,
  GeoSampleV3,
} from "../../../lib/agents/geo-report-contract";
import type {
  GeoCitationCounts,
  GeoMentionCounts,
  GeoRunCoverageV3,
  GeoRunTotals,
  GeoSearchCounts,
} from "../../../lib/agents/geo-report-derive";
import type { GeoContextSnapshotV1 } from "../../../lib/agents/geo-context";
import type { GeoQuerySetV1 } from "../../../lib/agents/geo-query-contract";
import {
  deriveGeoSourceLandscape,
  type GeoModeSourcesV1,
  type GeoSourceLandscapeV1,
} from "../../../lib/agents/geo-source-landscape";
import { GeoActionPanel } from "./geo-action-panel";

function formatDate(value: string, locale: string): string {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : value;
}

const CARD_CLASS =
  "rounded-card border border-brand-border-card bg-brand-panel-sunken p-5 md:p-6";
const TAG_CLASS =
  "inline-flex items-center rounded-row border px-2 py-0.5 font-mono text-[10px] tracking-[0.06em] uppercase";

function Tag({
  tone = "neutral",
  children,
}: {
  readonly tone?: "neutral" | "accent" | "warn" | "faint";
  readonly children: React.ReactNode;
}) {
  const toneClass =
    tone === "accent"
      ? "border-brand-accent/50 text-brand-accent-text"
      : tone === "warn"
        ? "border-brand-accent-2/50 text-brand-accent-2"
        : tone === "faint"
          ? "border-brand-border-dashed text-text-dark-tertiary"
          : "border-brand-border-strong text-text-dark-secondary";
  return <span className={`${TAG_CLASS} ${toneClass}`}>{children}</span>;
}

/**
 * One counted set, always shown with the denominator it was counted against.
 *
 * Raw counts, never a percentage. Three samples support "cited in one of three
 * observed answers" and support nothing about probability: the same question
 * asked four times in calibration produced four citation sets whose
 * intersection was empty.
 */
type MetricRow = readonly [string, number];

function MetricTable({
  label,
  rows,
}: {
  readonly label: string;
  readonly rows: readonly MetricRow[];
}) {
  const t = useTranslations("agents.geo");

  return (
    <div>
      <h4 className="text-[11.5px] font-semibold text-text-dark-primary">
        {label}
      </h4>
      <dl className="mt-1.5 grid grid-cols-3 gap-px overflow-hidden rounded-card border border-brand-border-card bg-brand-border-card">
        {rows.map(([key, value]) => (
          <div key={key} className="bg-brand-panel p-2.5">
            <dt className="text-[10.5px] leading-[1.4] text-text-dark-secondary">
              {t(`coverage.${key}`)}
            </dt>
            <dd className="mt-0.5 font-mono text-[16px] text-text-dark-primary tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The four numbers the approved report opens with.
 *
 * Three of them are mode-agnostic facts about the whole run — attempted,
 * observed, unavailable — and are safe to total because they count calls, not
 * citations. The fourth is not: a run-level "never searched" would count three
 * natural-demand questions that were never expected to search and report them
 * as an instrument failure. It is counted over retrieval probes alone and
 * labelled that way, which is the only reading that is true.
 */
/*
 * The four numbers, and why they are not four slices of one pie.
 *
 * `attempted = observed + unavailable` is the split; `neverSearched` sits
 * inside `observed` rather than beside it. An answer written from memory is an
 * observation: it cannot show who was cited, because it cited nobody, but it
 * still shows whether the customer was named. Subtracting those samples out of
 * `observed` — as the approved mock did, where the four numbers summed to the
 * attempted total — would report a working instrument as one that saw nothing
 * on three of its samples, and would leave the mention counts underneath with
 * no visible denominator to belong to. Each number carries its own scope line
 * instead.
 */
function overviewCounts(coverage: GeoRunCoverageV3) {
  const probes = coverage.search.retrieval_probe;
  return {
    attempted: coverage.totals.scheduledSamples,
    observed: coverage.totals.answeredSamples,
    neverSearched:
      probes.searchEvaluableSamples - probes.searchPerformedSamples,
    unavailable: coverage.totals.unavailableSamples,
  };
}

/**
 * One word for how far the run got, before any of its numbers are read.
 *
 * Not a grade and not a score. It says whether the instrument worked, which is
 * the first thing a reader needs in order to know how much weight the rest of
 * the page can carry.
 */
function availabilityOf(
  coverage: GeoRunCoverageV3,
): "Full" | "Partial" | "None" {
  if (coverage.totals.answeredSamples === 0) return "None";
  const degraded =
    coverage.triggerFailedProbes > 0 ||
    coverage.degradedProbes > 0 ||
    coverage.failedProbes > 0 ||
    coverage.totals.unavailableSamples > 0;
  return degraded ? "Partial" : "Full";
}

function searchRows(counts: GeoSearchCounts): readonly MetricRow[] {
  return [
    ["searchEvaluable", counts.searchEvaluableSamples],
    ["searchPerformed", counts.searchPerformedSamples],
  ];
}

function citationRows(counts: GeoCitationCounts): readonly MetricRow[] {
  return [
    ["citationEvaluable", counts.citationEvaluableSamples],
    ["targetCited", counts.targetCitedIn],
  ];
}

function mentionRows(counts: GeoMentionCounts): readonly MetricRow[] {
  return [
    ["mentionEvaluable", counts.mentionEvaluableSamples],
    ["targetMentioned", counts.targetMentionedIn],
  ];
}

function totalsRowsOf(totals: GeoRunTotals): readonly MetricRow[] {
  return [
    ["scheduled", totals.scheduledSamples],
    ["answered", totals.answeredSamples],
    ["unavailable", totals.unavailableSamples],
  ];
}

/**
 * Whether an annotation is nothing but the link the row already shows.
 *
 * The provider's annotation for a citation is normally `([host](url))` and
 * carries no wording of its own, so printing it under a label put the same
 * address on screen twice for every row. Anything that is not exactly that
 * shape is text the answer wrote, and worth reading.
 */
function isBareMarkdownLink(text: string): boolean {
  return /^\(?\[[^\]]*\]\([^()\s]*\)\)?$/u.test(text.trim());
}

/**
 * One citation, exactly as the answer carried it.
 *
 * The link is the observed URL, not a cleaned-up version of it, and the
 * annotation text is labelled as what it is: the anchor inside the answer, not
 * an excerpt of the page it points at. `rel` is set because these are third
 * party links the visitor did not choose.
 */
function CitationRow({
  evidence,
}: {
  readonly evidence: GeoCitationEvidenceRefV1;
}) {
  const t = useTranslations("agents.geo");
  const hasSpan = evidence.startIndex !== null && evidence.endIndex !== null;

  return (
    <li className="grid gap-1 border-t border-brand-border-card py-2 first:border-t-0">
      {/*
        Only when there is something to say. Ownership can only be "target" or
        "unknown" and source type can only be "owned_page" or "unknown", so on a
        run that never cited the customer every row carried the same two grey
        labels — the first thing the eye hits, and never once a fact about the
        row it sits on.
      */}
      {evidence.ownership === "target" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag tone="accent">{t(`ownership.${evidence.ownership}`)}</Tag>
          {evidence.sourceType !== "unknown" && (
            <Tag tone="faint">{t(`sourceType.${evidence.sourceType}`)}</Tag>
          )}
        </div>
      )}
      <a
        href={evidence.exactUrl}
        target="_blank"
        rel="noreferrer noopener nofollow ugc"
        className="break-all text-[12px] leading-[1.5] text-brand-accent-text underline underline-offset-2"
      >
        {evidence.exactUrl}
      </a>
      {evidence.title !== null && (
        <p className="text-[11.5px] leading-[1.5] text-text-dark-secondary">
          {evidence.title}
        </p>
      )}
      {/*
        Suppressed when it only restates the link above it. The provider's
        annotation is usually the markdown link itself, so printing it under a
        label showed every reader the same URL twice and buried the one case
        worth reading: an annotation that carries wording of its own.

        Matched on shape rather than on the URL: the annotation links the
        canonical address while `exactUrl` keeps the tracking query the answer
        actually carried, so comparing the two strings never fires.
      */}
      {evidence.annotationText !== null &&
        !isBareMarkdownLink(evidence.annotationText) && (
          <p className="text-[11px] leading-[1.5] text-text-dark-tertiary">
            <span className="font-mono text-[10px] uppercase">
              {t("evidence.annotationLabel")}
            </span>{" "}
            {evidence.annotationText}
          </p>
        )}
      <p className="font-mono text-[10.5px] text-text-dark-tertiary">
        {t("evidence.location", {
          item: evidence.providerOutputItemIndex,
          section: evidence.sectionIndex,
        })}
        {hasSpan
          ? ` · ${t("evidence.span", {
              start: evidence.startIndex ?? 0,
              end: evidence.endIndex ?? 0,
            })}`
          : ` · ${t("evidence.spanUnavailable")}`}
      </p>
    </li>
  );
}

function SampleRow({ sample }: { readonly sample: GeoSampleV3 }) {
  const t = useTranslations("agents.geo");
  const citations = sample.evidence.filter(
    (entry): entry is GeoCitationEvidenceRefV1 => entry.kind === "cited",
  );
  const mention = sample.evidence.find((entry) => entry.kind === "mention");

  return (
    <li className="grid gap-2 border-t border-brand-border-card py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10.5px] text-text-dark-tertiary">
          {t("results.sampleLabel", { index: sample.sampleIndex })}
        </span>
        <Tag>{t(`answerStatus.${sample.answerStatus}`)}</Tag>
        {sample.webSearchPerformed !== null && (
          <Tag tone={sample.webSearchPerformed ? "accent" : "faint"}>
            {t(
              sample.webSearchPerformed
                ? "results.searched"
                : "results.notSearched",
            )}
          </Tag>
        )}
        {/*
          Probe status is deliberately absent here. It is derived from every
          sample of the question at once, so stamping it on one sample put a
          verdict about the question next to facts about the answer — "searched"
          and "searched only sometimes" side by side, reading as a
          contradiction. It renders on the question instead.
        */}
        <Tag>{t(`citationStatus.${sample.citationStatus}`)}</Tag>
        <Tag>{t(`mentionStatus.${sample.mentionStatus}`)}</Tag>
        <Tag tone={sample.mentionEligibility === "prompted" ? "warn" : "faint"}>
          {t(`mentionEligibility.${sample.mentionEligibility}`)}
        </Tag>
        <Tag tone="faint">{t("results.recommendationNotEvaluated")}</Tag>
      </div>

      {sample.limitations.length > 0 && (
        <ul className="grid gap-0.5">
          {sample.limitations.map((code) => (
            <li
              key={code}
              className="text-[11px] leading-[1.5] text-text-dark-tertiary"
            >
              {t(`sampleLimitations.${code}`)}
            </li>
          ))}
        </ul>
      )}

      {citations.length > 0 && (
        <ul className="rounded-row border border-brand-border-card bg-brand-panel px-3">
          {citations.map((evidence) => (
            <CitationRow key={evidence.evidenceId} evidence={evidence} />
          ))}
        </ul>
      )}

      {mention !== undefined && mention.kind === "mention" && (
        <div className="rounded-row border border-brand-border-dashed bg-brand-panel px-3 py-2">
          <p className="font-mono text-[10px] tracking-[0.06em] text-text-dark-tertiary uppercase">
            {t("evidence.mentionLabel")}
          </p>
          <p className="mt-1 text-[11.5px] leading-[1.5] text-text-dark-secondary">
            {t("evidence.mentionAlias", { alias: mention.matchedAlias })}
          </p>
          {mention.mentionSnippet !== null && (
            <p className="mt-1 text-[11.5px] leading-[1.55] text-text-dark-secondary italic">
              {mention.mentionSnippet}
            </p>
          )}
          <p className="mt-1 text-[10.5px] leading-[1.5] text-text-dark-tertiary">
            {t("evidence.mentionDisclaimer")}
          </p>
        </div>
      )}
    </li>
  );
}

/**
 * The aggregate the per-question list cannot show.
 *
 * Everything here is a count of records already rendered above it, so the two
 * views can be read side by side without a second denominator to reconcile.
 * One table per mode and never a total: a retrieval probe is asked three times
 * and a natural-demand question once, so a blended row would treat one repeat
 * of a calibrated probe as interchangeable with a whole one-shot question.
 *
 * Deliberately no classification of what any host *is* — the sampler refuses to
 * guess that from a URL, and a table that guessed would put a made-up label on
 * the most-read line of the report.
 */
function ModeSourceTable({
  mode,
  sources,
  targetHost,
}: {
  readonly mode: "retrieval_probe" | "natural_demand";
  readonly sources: GeoModeSourcesV1;
  readonly targetHost: string;
}) {
  const t = useTranslations("agents.geo");

  return (
    <div data-testid={`geo-sources-${mode}`} className="mt-3">
      <h4 className="text-[11.5px] font-semibold text-text-dark-primary">
        {t(`sources.mode.${mode}`)}
      </h4>
      {sources.sources.length === 0 ? (
        <p className="mt-1 text-[12px] text-text-dark-secondary">
          {t("sources.empty")}
        </p>
      ) : (
        <>
          <p className="mt-1 font-mono text-[11px] text-text-dark-secondary">
            {t("sources.denominator", {
              domains: sources.distinctDomains,
              samples: sources.citationEvaluableSamples,
              questions: sources.citationEvaluableQuestions,
            })}{" "}
            {/*
              Only when the mode had something to count. A table with rows and a
              null verdict cannot happen — the rows come from countable samples
              — but reading the boolean without checking would print "was not
              cited" for a mode that could not be read at all.
            */}
            {sources.targetObserved !== null &&
              t(
                sources.targetObserved
                  ? "sources.targetPresent"
                  : "sources.targetAbsent",
                { host: targetHost },
              )}
          </p>
          <div className="mt-1.5 overflow-x-auto rounded-card border border-brand-border-card">
            <table className="w-full border-collapse bg-brand-panel text-[12px]">
              <thead>
                <tr className="border-b border-brand-border-card">
                  <th className="px-3 py-2 text-left font-medium text-text-dark-secondary">
                    {t("sources.colDomain")}
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-text-dark-secondary">
                    {t("sources.colSamples")}
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-text-dark-secondary">
                    {t("sources.colQuestions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sources.sources.map((source) => (
                  <tr
                    key={source.domain}
                    className="border-t border-brand-border-card"
                  >
                    <td className="px-3 py-1.5 break-all">
                      <span
                        className={
                          source.isTarget
                            ? "text-brand-accent-text"
                            : "text-text-dark-primary"
                        }
                      >
                        {source.domain}
                      </span>
                      {source.isTarget && (
                        <span className="ml-2">
                          <Tag tone="accent">{t("sources.yours")}</Tag>
                        </span>
                      )}
                      {/*
                        Which pages on this host, one click down.
                        The table aggregates to the host because that is the
                        pattern worth reading first, but "acme.test was cited in
                        3 of 3" does not say whether that was one page three
                        times or three different pages. The URLs were derived
                        and carried here from the start; only this disclosure
                        was missing.
                      */}
                      {source.urls.length > 0 && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[11px] text-text-dark-tertiary">
                            {t("sources.showUrls", {
                              count: source.urls.length,
                            })}
                          </summary>
                          <ul className="mt-1 grid gap-0.5">
                            {source.urls.map((url) => (
                              <li
                                key={url}
                                className="font-mono text-[10.5px] break-all text-text-dark-secondary"
                              >
                                {url}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-text-dark-secondary">
                      {t("sources.sampleShare", {
                        cited: source.citedInSamples,
                        total: sources.citationEvaluableSamples,
                      })}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-text-dark-secondary">
                      {t("sources.questionShare", {
                        cited: source.citedInQuestions,
                        total: sources.citationEvaluableQuestions,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function SourceLandscape({
  landscape,
  targetHost,
}: {
  readonly landscape: GeoSourceLandscapeV1;
  readonly targetHost: string;
}) {
  const t = useTranslations("agents.geo");

  return (
    <div>
      <h3 className="text-[14px] font-semibold text-text-dark-primary">
        {t("sources.title")}
      </h3>
      <p className="mt-1 text-[12px] leading-[1.6] text-text-dark-secondary">
        {t("sources.note")}
      </p>
      <ModeSourceTable
        mode="retrieval_probe"
        sources={landscape.byMode.retrieval_probe}
        targetHost={targetHost}
      />
      <ModeSourceTable
        mode="natural_demand"
        sources={landscape.byMode.natural_demand}
        targetHost={targetHost}
      />
    </div>
  );
}

/**
 * Why a sample is not in the citation denominator, or what it observed.
 *
 * One phrase, not six chips. The full six — answered, searched, citation,
 * mention, eligibility, recommendation — are all true and all still on the page
 * one disclosure down; as a default they turned every sample into a row of
 * labels and eight questions into a wall nobody reads to the end of. The
 * disqualifying reason wins when there is one, because "we could not count
 * this" is the fact that decides how to read the ratio above.
 */
function sampleOutcomeKey(
  sample: GeoSampleV3,
  mode: GeoQuestionObservationV3["mode"],
): string {
  if (sample.answerStatus !== "answered")
    return "answerStatus.no_usable_answer";
  if (mode === "retrieval_probe" && sample.webSearchPerformed !== true) {
    return "results.notSearched";
  }
  return `citationStatus.${sample.citationStatus}`;
}

/**
 * One sample, one line: which try it was, what came of it, who it cited.
 *
 * The hosts are deduped per sample. The same page cited three times in one
 * answer is three observations and the evidence list keeps all three, but a row
 * whose job is "who did this answer reach for" must not repeat a name.
 */
function CompactSampleRow({
  sample,
  mode,
  targetHost,
}: {
  readonly sample: GeoSampleV3;
  readonly mode: GeoQuestionObservationV3["mode"];
  readonly targetHost: string;
}) {
  const t = useTranslations("agents.geo");
  const hosts = [
    ...new Set(
      sample.evidence
        .filter(
          (entry): entry is GeoCitationEvidenceRefV1 => entry.kind === "cited",
        )
        .map((entry) => entry.domain),
    ),
  ];

  return (
    <li
      data-testid="geo-sample-row"
      className="grid gap-1 border-t border-brand-border-card py-1.5 text-[11px] leading-[1.5] sm:grid-cols-[5.5rem_10rem_minmax(0,1fr)] sm:gap-2.5"
    >
      <span className="font-mono text-text-dark-tertiary">
        {t("results.sampleLabel", { index: sample.sampleIndex })}
      </span>
      <span className="text-text-dark-secondary">
        {t(sampleOutcomeKey(sample, mode))}
      </span>
      <span className="flex min-w-0 flex-wrap gap-1">
        {hosts.length === 0 ? (
          <span className="text-text-dark-tertiary">—</span>
        ) : (
          hosts.map((host) => (
            <span
              key={host}
              className={`rounded-row border px-1.5 py-0.5 font-mono text-[9.5px] break-all ${
                host === targetHost
                  ? "border-brand-accent/50 text-brand-accent-text"
                  : "border-brand-border-strong text-text-dark-secondary"
              }`}
            >
              {host}
            </span>
          ))
        )}
      </span>
    </li>
  );
}

function QuestionCard({
  question,
  targetHost,
}: {
  readonly question: GeoQuestionObservationV3;
  readonly targetHost: string;
}) {
  const t = useTranslations("agents.geo");
  const { counts } = question;
  // One value per question, not per sample: every sample of a retrieval probe
  // carries the same verdict, and the report guard refuses a payload where they
  // disagree. Reading the first is reading the question's.
  const probeStatus = question.samples[0]?.probeStatus ?? null;

  return (
    <li className={CARD_CLASS}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[46rem] text-[13.5px] leading-[1.6] text-text-dark-primary">
          {question.text}
        </p>
        {/*
          Wraps rather than refuses to shrink. `shrink-0` kept this row at its
          full three-chip width, and at 320px that pushed the whole page 15px
          sideways — a horizontal scrollbar on the report, caused by a row of
          labels. The chips already wrap; they just needed to be allowed to.
        */}
        <div className="flex min-w-0 flex-wrap gap-1.5">
          <Tag
            tone={question.mode === "retrieval_probe" ? "accent" : "neutral"}
          >
            {t(`modes.${question.mode}`)}
          </Tag>
          <Tag>{t(`stances.${question.brandStance}`)}</Tag>
          {probeStatus !== null && (
            <Tag
              tone={
                probeStatus === "valid"
                  ? "accent"
                  : probeStatus === "provider_failed"
                    ? "faint"
                    : "warn"
              }
            >
              {t(`probeStatus.${probeStatus}`)}
            </Tag>
          )}
        </div>
      </div>

      {/*
        Named, because these two lines sit directly above a list of everyone
        else's citations. Without the host in the sentence, "cited 0 times" next
        to twenty links reads as a broken report rather than as the finding.
      */}
      <p className="mt-2 font-mono text-[11px] text-brand-accent-text">
        {t("results.citedInCount", {
          host: targetHost,
          cited: counts.targetCitedIn,
          total: counts.citationEvaluableSamples,
        })}
      </p>
      <p className="mt-1 font-mono text-[11px] text-text-dark-secondary">
        {t("results.mentionedInCount", {
          host: targetHost,
          mentioned: counts.targetMentionedIn,
          total: counts.mentionEvaluableSamples,
        })}
      </p>

      <ul className="mt-2.5">
        {question.samples.map((sample) => (
          <CompactSampleRow
            key={sample.sampleId}
            sample={sample}
            mode={question.mode}
            targetHost={targetHost}
          />
        ))}
      </ul>

      {/*
        Nothing is lost, it is one click away. The exact URLs, the titles, the
        annotation spans and the mention excerpts are what this report claims to
        be exact about; they are also the reason a run of eight questions filled
        several screens before a reader reached the part that says what to do.
      */}
      <details className="mt-2.5 min-w-0">
        <summary className="cursor-pointer text-[11.5px] text-text-dark-secondary">
          {t("results.sampleDetails")}
        </summary>
        <ul className="mt-1">
          {question.samples.map((sample) => (
            <SampleRow key={sample.sampleId} sample={sample} />
          ))}
        </ul>
      </details>
    </li>
  );
}

export function GeoReportView({
  report,
  capture,
  locale,
  onRestart,
}: {
  readonly report: GeoReportDataV3;
  /**
   * The confirmed context and the query set that was actually run.
   *
   * One prop rather than two, because the solutions section needs both and a
   * report rendered with the context of one run and the questions of another is
   * the exact pairing the copy builder refuses. Optional only for the callers
   * that render evidence without the confirmation that produced it.
   */
  readonly capture?: {
    readonly context: GeoContextSnapshotV1;
    readonly querySet: GeoQuerySetV1;
  };
  readonly locale: string;
  readonly onRestart: () => void;
}) {
  const t = useTranslations("agents.geo");
  const { run, coverage, questions, limitations } = report;
  const { provenance } = run;
  const degraded =
    coverage.triggerFailedProbes > 0 || coverage.degradedProbes > 0;
  const totalsRows = totalsRowsOf(coverage.totals);
  const overview = overviewCounts(coverage);
  const availability = availabilityOf(coverage);

  const identity = [
    ["collector", provenance.collector],
    ["upstream", provenance.upstream],
    ["surface", provenance.surface],
    ["modelRequested", provenance.modelRequested],
    ["modelObserved", provenance.modelObserved.join(", ")],
    ["maxOutputTokens", String(provenance.maxOutputTokensRequested)],
    ["market", provenance.webSearchCountryIsoCodeRequested],
    ["queryLanguage", provenance.queryLanguageTag],
    ["querySet", run.querySetContentHash.slice(7, 19)],
    ["runId", run.runId],
  ] as const;

  return (
    <section className="grid gap-5">
      {degraded && (
        <p
          role="alert"
          className="rounded-card border border-brand-accent-2/50 bg-brand-panel-sunken px-4 py-3 text-[12.5px] leading-[1.6] text-brand-accent-2"
        >
          {/*
            Two facts, not one sentence, and each printed only when it happened.
            The lumped version said "0 probes never searched, 4 searched
            sometimes. This is an instrumentation failure" — a zero-valued
            clause, and a claim about cause on a run where nothing failed. Only
            `trigger_failed` is defined as an instrument failure; a probe that
            searched on two tries out of three is the surface being
            non-deterministic, which is the reason three samples are taken.
          */}
          {coverage.triggerFailedProbes > 0 && (
            <span className="block">
              {t("results.degradedFailed", {
                failed: coverage.triggerFailedProbes,
              })}
            </span>
          )}
          {coverage.degradedProbes > 0 && (
            <span
              className={
                coverage.triggerFailedProbes > 0 ? "mt-2 block" : "block"
              }
            >
              {t("results.degradedMixed", { mixed: coverage.degradedProbes })}
            </span>
          )}
        </p>
      )}

      <div className={CARD_CLASS}>
        <h2 className="text-[16px] font-semibold text-text-dark-primary">
          {t("results.title")}
        </h2>
        <p className="mt-1 font-mono text-[11px] text-text-dark-tertiary">
          {t("results.sampledAt", { date: formatDate(run.sampledAt, locale) })}
        </p>

        {/*
          One line by default, ten fields one click down.
          The ten are there because a single "provider" label would let a
          DataForSEO answer read as if the visitor had asked ChatGPT Pro
          themselves — collector, upstream and surface are three separate facts
          and at least one of them is always the one a reader needs. As an
          opening they were ten rows above the first number.
        */}
        <p className="mt-4 font-mono text-[11px] break-all text-text-dark-secondary">
          {[
            provenance.surface,
            provenance.modelRequested,
            provenance.webSearchCountryIsoCodeRequested,
            formatDate(run.sampledAt, locale),
          ].join(" · ")}
        </p>
        <details className="mt-2 min-w-0">
          <summary className="cursor-pointer text-[12px] text-text-dark-secondary">
            {t("results.identityTitle")}
          </summary>
          <dl className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {identity.map(([key, value]) => (
              <div key={key} className="text-[11.5px] leading-[1.5]">
                <dt className="inline text-text-dark-tertiary">
                  {t(`identity.${key}`)}:{" "}
                </dt>
                <dd className="inline font-mono text-[11px] text-text-dark-secondary">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-[11.5px] leading-[1.55] text-text-dark-secondary">
            {t(`identity.${provenance.triggerCalibrationScope}`)}
          </p>
        </details>
        {/*
          Stays outside the disclosure. What is kept and what is not is a promise
          to the person reading, not a detail they have to go looking for.
        */}
        <p className="mt-2 text-[11.5px] leading-[1.55] text-text-dark-tertiary">
          {t("results.notStored")}
        </p>
      </div>

      <div className={CARD_CLASS}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/*
            One platform, said before the numbers rather than in a limitation at
            the foot of the page. Everything below is ChatGPT at one moment.
          */}
          <p className="font-mono text-[10px] tracking-[0.06em] text-text-dark-tertiary uppercase">
            {t("results.snapshotEyebrow")}
          </p>
          <Tag tone={availability === "Full" ? "accent" : "warn"}>
            {t(`results.availability${availability}`)}
          </Tag>
        </div>
        <h3 className="mt-1 text-[12.5px] font-semibold text-text-dark-primary">
          {t("results.overviewTitle")}
        </h3>
        <p className="mt-1 text-[11.5px] leading-[1.55] text-text-dark-secondary">
          {t("results.overviewNote")}
        </p>

        {/*
          Four numbers, then the four things they do not mean.
          Seventeen numbers in seven tables is the whole truth and nobody's
          first read; the reader needs to know how far the instrument got
          before any ratio below is worth anything. The tables are still here,
          one disclosure down, because the two modes' denominators are the
          reason this report exists and hiding them entirely would be the
          opposite fix.
        */}
        <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-brand-border-card bg-brand-border-card sm:grid-cols-4">
          {(
            [
              ["attempted", overview.attempted, null],
              ["observed", overview.observed, "results.observedScope"],
              ["noSearch", overview.neverSearched, "results.noSearchScope"],
              ["unavailableSamples", overview.unavailable, null],
            ] as const
          ).map(([key, value, scope]) => (
            <div key={key} className="bg-brand-panel p-3">
              <dt className="text-[10.5px] leading-[1.4] text-text-dark-secondary">
                {t(`results.${key}`)}
              </dt>
              <dd className="mt-0.5 font-mono text-[20px] text-text-dark-primary tabular-nums">
                {value}
              </dd>
              {/*
                The one number that is not about the whole run says so on its
                own line. A "never searched" total that silently included three
                one-shot questions nobody expected to search would report a
                working instrument as a broken one.
              */}
              {scope !== null && (
                <p className="mt-0.5 text-[10px] leading-[1.35] text-text-dark-tertiary">
                  {t(scope)}
                </p>
              )}
            </div>
          ))}
        </dl>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {[
            "boundaryUnavailable",
            "boundaryNoSearch",
            "boundaryCitation",
            "boundaryNoScore",
          ].map((key) => (
            <Tag key={key} tone="faint">
              {t(`results.${key}`)}
            </Tag>
          ))}
        </div>

        <p className="mt-3 font-mono text-[11px] text-text-dark-secondary">
          {t("results.probeSummary", {
            valid: coverage.validProbes,
            failed: coverage.triggerFailedProbes,
            mixed: coverage.degradedProbes,
            unavailable: coverage.failedProbes,
          })}
        </p>

        <details className="mt-3 min-w-0">
          <summary className="cursor-pointer text-[12px] text-text-dark-secondary">
            {t("results.coverageDetails")}
          </summary>
          <p className="mt-1 text-[11.5px] leading-[1.55] text-text-dark-secondary">
            {t("results.coverageNote")}
          </p>
          <div className="mt-3 grid gap-4">
            {/* Only the three mode-agnostic facts are stated about the whole run.
              A run-level "named in 4 of 18" would blend three prompted
              repetitions with one unprompted discovery, and a run-level
              "searched 15 of 18" would count three natural-demand questions
              that were never expected to search. */}
            <MetricTable label={t("coverage.totals")} rows={totalsRows} />
            <MetricTable
              label={t("coverage.searchRetrieval")}
              rows={searchRows(coverage.search.retrieval_probe)}
            />
            <MetricTable
              label={t("coverage.searchNatural")}
              rows={searchRows(coverage.search.natural_demand)}
            />
            <MetricTable
              label={t("coverage.citationRetrieval")}
              rows={citationRows(coverage.citation.retrieval_probe)}
            />
            <MetricTable
              label={t("coverage.citationNatural")}
              rows={citationRows(coverage.citation.natural_demand)}
            />
            <MetricTable
              label={t("coverage.mentionUnprompted")}
              rows={mentionRows(coverage.mention.unprompted)}
            />
            <MetricTable
              label={t("coverage.mentionPrompted")}
              rows={mentionRows(coverage.mention.prompted)}
            />
          </div>
        </details>
      </div>

      <SourceLandscape
        landscape={deriveGeoSourceLandscape(report)}
        targetHost={report.run.targetHost}
      />

      {capture !== undefined && (
        <GeoActionPanel
          report={report}
          context={capture.context}
          querySet={capture.querySet}
          locale={locale}
        />
      )}

      <div>
        <p className="font-mono text-[10px] tracking-[0.06em] text-text-dark-tertiary uppercase">
          {t("results.questionsEyebrow")}
        </p>
        <h3 className="mt-1 text-[14px] font-semibold text-text-dark-primary">
          {t("results.questionsTitle")}
        </h3>
        {questions.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-text-dark-secondary">
            {t("results.empty")}
          </p>
        ) : (
          <ul className="mt-3 grid gap-3">
            {questions.map((question) => (
              <QuestionCard
                key={question.queryId}
                question={question}
                targetHost={report.run.targetHost}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-card border border-brand-border-dashed bg-brand-panel-sunken p-5">
        <h3 className="text-[12.5px] font-semibold text-text-dark-primary">
          {t("limitations.title")}
        </h3>
        <ul className="mt-2 grid gap-1.5">
          {limitations.map((code) => (
            <li
              key={code}
              className="text-[11.5px] leading-[1.6] text-text-dark-secondary"
            >
              {t(`runLimitations.${code}`)}
            </li>
          ))}
          {["sampling", "platform", "citation", "denominator"].map((key) => (
            <li
              key={key}
              className="text-[11.5px] leading-[1.6] text-text-dark-secondary"
            >
              {t(`limitations.${key}`)}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <button
          type="button"
          onClick={onRestart}
          className="inline-flex h-11 items-center justify-center rounded-[10px] border border-brand-border-strong bg-transparent px-4 text-[13px] text-text-dark-secondary transition-colors hover:text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
        >
          {t("workbench.back")}
        </button>
      </div>
    </section>
  );
}
