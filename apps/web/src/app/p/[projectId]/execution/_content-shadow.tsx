"use client";

/**
 * The Content Shadow reading surface (Slice 2 Task 7).
 *
 * What this screen owes a reader, in order of importance:
 *
 * 1. **The body itself.** The draft is the evidence; a reviewer cannot judge a
 *    field table. The prose is the main column, at reading size.
 * 2. **What was NOT judged.** The gate's third state is "we did not judge
 *    this", and every place it could be rounded up to a tick is a place this
 *    screen would lie. Counts are three-way, never two-way.
 * 3. **Why a draft cannot pass.** `blocked` is the ordinary outcome here, not a
 *    fault: the research pack is assembled from confirmed project data with no
 *    external retrieval, so any draft that cites an outside source has nothing
 *    to be checked against. It is presented as the system holding back an
 *    unverifiable citation — never as a failure, an error, or a retry prompt.
 *
 * No identifier a person cannot act on appears anywhere in here: no run id, no
 * action id, no finding id, no rule id. The frozen content hash is the single
 * exception and it is truncated, because it is the one value an auditor asks
 * for by name.
 */

import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { InfiniteData } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import {
  Badge,
  EmptyState,
  Panel,
  Spinner,
  StatusPill,
  cx,
  type StatusTone,
} from "@/components/ui";
import { uniqueCursorItems } from "@/lib/api/cursor-pages";
import type { ListEnvelope } from "@/lib/api";
import {
  useArtifactRevision,
  useContentShadowRun,
  useContentShadowRuns,
  type ContentShadowAuthoritySource,
  type ContentShadowRun,
  type ContentShadowRunSummary,
} from "@/lib/api/hooks-content-shadow";
import { useProjectSources } from "@/lib/api/hooks-sources";
import {
  useProjectActions,
  useProjectArtifacts,
  type Artifact,
  type ArtifactAction,
} from "@/lib/api/hooks-studio";
import { ProblemNotice, ProblemState } from "../_problem-display";
import { ComparePanes } from "./_compare.tsx";
import { coverageClaimOf } from "./_compare-view.ts";
import { connectedSourceProviders } from "./_connected-sources.ts";
import { MarkdownBlocks } from "./_markdown-blocks.tsx";
import { Overlay } from "./_overlay.tsx";
import {
  advisoryClaimCount,
  blockingClaims,
  claimLabelKey,
  groupOpensByDefault,
  qaCounts,
  qaGroups,
  verdictIsStale,
  verdictTone,
  type QaClaimView,
  type QaGroup,
} from "./_qa-view.ts";
import {
  RevisionHistory,
  ReviewSurface,
  StaleReviewBanner,
} from "./_review.tsx";
import {
  humanReviewState,
  type ArtifactLifecycle,
  type HumanReviewState,
} from "./_review-view.ts";
import { safeResearchSourceHref } from "./_safe-research-url.ts";
import styles from "./execution.module.css";

const DASH = "—";
const HASH_CHARS = 12;

interface ResearchSourceView {
  readonly id: string;
  readonly kind: ContentShadowAuthoritySource["kind"];
  readonly label: string;
  readonly availability: ContentShadowAuthoritySource["availability"];
  readonly url: string | null;
  readonly capturedAt: string | null;
  readonly authorityTier: ContentShadowAuthoritySource["authorityTier"];
  readonly contentHash: string | null;
  readonly contentHashMethod: ContentShadowAuthoritySource["contentHashMethod"];
  readonly contentTruncated: boolean;
  readonly excerpt: string | null;
  readonly excerptTruncated: boolean;
  readonly evidenceRefs: readonly string[];
  readonly limitation: string | null;
  readonly metrics: ContentShadowAuthoritySource["metrics"];
}

interface ArtifactRevisionHistoryView {
  readonly revision: number;
  readonly hash: string | null;
  readonly createdAt: string | null;
  readonly generatedBy: string;
  readonly note: string | null;
  readonly validationErrorCount: number;
  readonly isCurrent: boolean;
  readonly isJudged: boolean;
}

function formatUtcTimestamp(value: string | null, locale: string): string | null {
  if (value === null) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

function researchSourceView(
  source: ContentShadowAuthoritySource,
): ResearchSourceView {
  return {
    id: `${source.kind}:${source.ref}`,
    kind: source.kind,
    label: source.label,
    availability: source.availability,
    url: source.url,
    capturedAt: source.capturedAt,
    authorityTier: source.authorityTier,
    contentHash: source.contentHash,
    contentHashMethod: source.contentHashMethod,
    contentTruncated: source.contentTruncated,
    excerpt: source.excerpt,
    excerptTruncated: source.excerptTruncated,
    evidenceRefs: source.evidenceRefs,
    limitation: source.limitation,
    metrics: source.metrics,
  };
}

function artifactRevisionHistory(
  draft: ContentShadowRun["draft"],
  evaluatedRevision: number | null,
  currentRevision: number | null,
): readonly ArtifactRevisionHistoryView[] {
  if (draft === null) return [];
  return [...draft.revisionHistory]
    .map((entry) => {
      return {
        revision: entry.revision,
        hash: entry.contentHash,
        createdAt: entry.createdAt,
        generatedBy: entry.generatedBy,
        note: entry.note,
        validationErrorCount: entry.validationErrorCount,
        isCurrent: currentRevision === entry.revision,
        isJudged: evaluatedRevision === entry.revision,
      } satisfies ArtifactRevisionHistoryView;
    })
    .sort((left, right) => right.revision - left.revision);
}

/** A group state is conveyed by a character AND a word, never by colour alone. */
const GROUP_MARK: Readonly<Record<QaGroup["state"], string>> = {
  passed: "✓",
  failed: "×",
  partial: "!",
  unevaluated: DASH,
};

const GROUP_TONE: Readonly<Record<QaGroup["state"], string | undefined>> = {
  passed: styles.groupPassed,
  failed: styles.groupFailed,
  partial: styles.groupPartial,
  unevaluated: styles.groupUnevaluated,
};

function QaClaimRow({ claim }: { readonly claim: QaClaimView }) {
  const t = useTranslations("studio.qa");
  const key = claimLabelKey(claim.claimId);
  const label = key === null ? t("claimUnnamed") : t(`claimLabels.${key}`);
  return (
    <li className={styles.qaClaim}>
      <span className={styles.qaClaimName}>{label}</span>
      <span className={cx(styles.qaClaimState, styles[claim.status])}>
        {t(`claimStatus.${claim.status}`)}
        {claim.severity === "advisory" ? ` · ${t("advisoryTag")}` : ""}
      </span>
      {/* The English original is the checkable evidence, so it is not
          translated; the lead-in tells a reader what they are looking at. */}
      <p className={styles.qaClaimDetail}>
        <span>{t("claimBasis")}</span> {claim.detail}
      </p>
    </li>
  );
}

function QaGroupRow({ group }: { readonly group: QaGroup }) {
  const t = useTranslations("studio.qa");
  const [open, setOpen] = useState(groupOpensByDefault(group));
  const reasonKey =
    group.reasonClaim === null
      ? null
      : claimLabelKey(group.reasonClaim.claimId);
  const stateText =
    group.state === "failed"
      ? t("state.failed", { count: group.failedCount })
      : group.state === "partial"
        ? t("state.partial", { count: group.unevaluatedCount })
        : t(`state.${group.state}`);

  return (
    <div className={styles.qaGroup}>
      <button
        type="button"
        className={styles.qaGroupHead}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={cx(styles.qaGroupIcon, GROUP_TONE[group.state])}>
          {GROUP_MARK[group.state]}
        </span>
        <span>
          <span className={styles.qaGroupName}>{t(`group.${group.kind}`)}</span>
          <span className={styles.qaGroupState}>{stateText}</span>
          {group.reasonClaim !== null ? (
            <span className={styles.qaGroupReason}>
              {reasonKey === null
                ? t("claimUnnamed")
                : t(`claimLabels.${reasonKey}`)}
            </span>
          ) : null}
        </span>
        <span className={styles.qaGroupArrow} aria-hidden="true">
          ›
        </span>
      </button>
      {open ? (
        <ul className={styles.qaClaims}>
          {group.claims.map((claim) => (
            <QaClaimRow key={claim.claimId} claim={claim} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Why every row here carries a state word.
 *
 * A claim label names a PROPERTY, and the properties are mixed in polarity:
 * `rl8` reads "A statement with no traceable source" (a defect), while `sc9b`
 * reads "Listed sources match the frozen records" (the property when it is
 * SATISFIED). Listing the bare labels under "Cannot pass review yet" put a
 * sentence that reads like a pass in the list of reasons a draft is held back.
 *
 * So the state is stated, in the same vocabulary the claim rows above use, and
 * it is stated structurally rather than by rewording one label — a blocking
 * rule added later will have whatever polarity its author chose.
 */
function BlockerBlock({ claims }: { readonly claims: readonly QaClaimView[] }) {
  const t = useTranslations("studio.qa");
  const shown = claims.slice(0, 3);
  return (
    <div className={styles.blocker} data-qa-blocker="">
      <strong>{t("blocker.title")}</strong>
      <p>{t("blocker.body", { count: claims.length })}</p>
      <ul>
        {shown.map((claim) => {
          const key = claimLabelKey(claim.claimId);
          return (
            <li key={claim.claimId} data-qa-blocker-claim="">
              <span>
                {key === null ? t("claimUnnamed") : t(`claimLabels.${key}`)}
              </span>
              {/* The separator is DOM text, not a CSS `::before`: generated
                  content is not reliably part of the accessible name, and this
                  row's meaning depends on both halves being read. */}
              {/* Same tone map as `QaClaimRow` above: an item-level state word
                  keeps the status matrix's colour, while the block around it
                  stays amber because the block is the verdict. */}
              <span
                className={cx(styles.blockerItemState, styles[claim.status])}
              >
                {` · ${t(`claimStatus.${claim.status}`)}`}
              </span>
            </li>
          );
        })}
        {claims.length > shown.length ? (
          <li>{t("blocker.more", { count: claims.length - shown.length })}</li>
        ) : null}
      </ul>
      <p className={styles.blockerNote}>{t("blocker.why")}</p>
      <p className={styles.blockerNote}>{t("blocker.next")}</p>
    </div>
  );
}

/**
 * The human-review row of the quality rail.
 *
 * Not a gate claim — the gate never judges this — but it belongs beside them:
 * "a person has confirmed this" is a state of the deliverable, and a rail that
 * listed only the machine's four groups would leave a reader to infer it.
 * It returns to "awaiting" the instant a new revision exists.
 */
function HumanReviewRow({ state }: { readonly state: HumanReviewState }) {
  const t = useTranslations("studio.qa");
  const mark = state === "passed" ? "✓" : state === "awaiting" ? "!" : DASH;
  const tone =
    state === "passed"
      ? styles.groupPassed
      : state === "awaiting"
        ? styles.groupPartial
        : styles.groupUnevaluated;
  return (
    <div className={styles.qaGroup} data-qa-human-review={state}>
      <div className={styles.qaGroupHead}>
        <span className={cx(styles.qaGroupIcon, tone)}>{mark}</span>
        <span>
          <span className={styles.qaGroupName}>{t("group.human_review")}</span>
          <span className={styles.qaGroupState}>
            {t(`humanState.${state}` as "humanState.awaiting")}
          </span>
        </span>
        <span />
      </div>
    </div>
  );
}

function isPageSource(source: ResearchSourceView): boolean {
  return (
    source.kind === "first_party_page" || source.kind === "external_page"
  );
}

function availabilityTone(
  availability: ContentShadowAuthoritySource["availability"],
): StatusTone {
  switch (availability) {
    case "available":
      return "success";
    case "partial":
      return "warning";
    case "unavailable":
      return "neutral";
  }
}

function availabilityKey(
  availability: ContentShadowAuthoritySource["availability"],
): "available" | "partial" | "unavailable" {
  return availability;
}

function citabilityKey(
  source: ResearchSourceView,
):
  | "externalEvidence"
  | "firstPartyFacts"
  | "identityOnly"
  | "partialPage"
  | "unavailable" {
  if (source.availability !== "available") {
    return source.availability === "partial" ? "partialPage" : "unavailable";
  }
  if (source.kind === "external_page") return "externalEvidence";
  if (source.kind === "first_party_page") return "firstPartyFacts";
  return "identityOnly";
}

function sourceConclusionCounts(sources: readonly ResearchSourceView[]) {
  return {
    availableExternalPages: sources.filter(
      (source) =>
        source.kind === "external_page" && source.availability === "available",
    ).length,
    availableFirstPartyPages: sources.filter(
      (source) =>
        source.kind === "first_party_page" &&
        source.availability === "available",
    ).length,
    partialPages: sources.filter(
      (source) => isPageSource(source) && source.availability === "partial",
    ).length,
    unavailablePages: sources.filter(
      (source) => isPageSource(source) && source.availability === "unavailable",
    ).length,
    pageSourcesWithContent: sources.filter(
      (source) => isPageSource(source) && source.contentHash !== null,
    ).length,
    identityRecords: sources.filter((source) => !isPageSource(source)).length,
  };
}

function AllSourcesDrawer({
  sources,
}: {
  readonly sources: readonly ResearchSourceView[];
}) {
  const t = useTranslations("studio.qa");
  const locale = useLocale();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={styles.researchSourceAction}
        onClick={() => setOpen(true)}
        data-research-sources-button=""
      >
        {t("research.openAll")}
      </button>
      <Overlay
        open={open}
        shape="drawer"
        title={t("research.drawerTitle")}
        subtitle={t("research.drawerSubtitle", { count: sources.length })}
        onClose={() => setOpen(false)}
        returnFocusRef={buttonRef}
        testId="research-sources-overlay"
      >
        <div className={styles.researchDrawer} data-research-sources-drawer="">
          <ul className={styles.drawerSourceList}>
            {sources.map((source) => {
              const capturedAt = formatUtcTimestamp(source.capturedAt, locale);
              const sourceHref = safeResearchSourceHref(source.url);
              return (
                <li key={source.id} className={styles.drawerSourceItem}>
                  <div className={styles.researchSourceHead}>
                    <div>
                      <p className={styles.researchSourceLabel}>
                        {t(`research.kind.${source.kind}` as never)}
                      </p>
                      <h5 className={styles.researchSourceTitle}>{source.label}</h5>
                    </div>
                    <StatusPill tone={availabilityTone(source.availability)}>
                      {t(
                        `research.availability.${availabilityKey(source.availability)}` as never,
                      )}
                    </StatusPill>
                  </div>
                  <dl className={styles.researchDrawerFacts}>
                    <div>
                      <dt>{t("research.fields.citability")}</dt>
                      <dd>{t(`research.citability.${citabilityKey(source)}` as never)}</dd>
                    </div>
                    <div>
                      <dt>{t("research.fields.url")}</dt>
                      <dd>
                        {sourceHref === null ? (
                          t("research.unavailable")
                        ) : (
                          <a
                            className={styles.researchSourceLink}
                            href={sourceHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={t("research.openSource", {
                              label: source.label,
                            })}
                          >
                            {source.url}
                          </a>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("research.fields.capturedAt")}</dt>
                      <dd>{capturedAt ?? t("research.unavailable")}</dd>
                    </div>
                    <div>
                      <dt>{t("research.fields.hash")}</dt>
                      <dd>
                        {source.contentHash === null
                          ? t("research.unavailable")
                          : `${source.contentHash.slice(0, HASH_CHARS)}…`}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("research.fields.hashMethod")}</dt>
                      <dd>
                        {source.contentHashMethod === null
                          ? t("research.unavailable")
                          : t(
                              `research.hashMethod.${source.contentHashMethod}` as never,
                            )}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("research.fields.bodyCompleteness")}</dt>
                      <dd>
                        {source.contentTruncated
                          ? t("research.bodyCompleteness.truncated")
                          : t("research.bodyCompleteness.complete")}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("research.fields.summary")}</dt>
                      <dd>{source.excerpt ?? t("research.unavailable")}</dd>
                    </div>
                    <div>
                      <dt>{t("research.fields.previewCompleteness")}</dt>
                      <dd>
                        {source.excerptTruncated
                          ? t("research.previewCompleteness.truncated")
                          : t("research.previewCompleteness.complete")}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("research.fields.evidenceRefs")}</dt>
                      <dd>
                        {source.evidenceRefs.length === 0
                          ? t("research.unavailable")
                          : source.evidenceRefs.join(" · ")}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("research.fields.metrics")}</dt>
                      <dd>
                        {source.metrics === null
                          ? t("research.unavailable")
                          : t("research.metricsSummary", {
                              status: source.metrics.status ?? DASH,
                              contentType:
                                source.metrics.contentType ?? t("research.unavailable"),
                              bodyBytes: source.metrics.bodyBytes ?? DASH,
                              wordCount: source.metrics.wordCount ?? DASH,
                              responseMs: source.metrics.responseMs ?? DASH,
                              redirects: source.metrics.redirectChain.length,
                            })}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("research.fields.limitation")}</dt>
                      <dd>{source.limitation ?? t("research.unavailable")}</dd>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ul>
        </div>
      </Overlay>
    </>
  );
}

function CompactPageSourceRow({
  source,
}: {
  readonly source: ResearchSourceView;
}) {
  const t = useTranslations("studio.qa");
  const locale = useLocale();
  const capturedAt = formatUtcTimestamp(source.capturedAt, locale);
  const sourceHref = safeResearchSourceHref(source.url);

  return (
    <article className={styles.researchSource} data-research-source-card="">
      <div className={styles.researchSourceHead}>
        <div>
          <p className={styles.researchSourceLabel}>
            {t(`research.kind.${source.kind}` as never)}
          </p>
          <h5 className={styles.researchSourceTitle}>
            {source.label}
          </h5>
        </div>
        <StatusPill tone={availabilityTone(source.availability)}>
          {t(`research.availability.${availabilityKey(source.availability)}` as never)}
        </StatusPill>
      </div>

      <dl className={styles.researchSourceFacts}>
        <div>
          <dt>{t("research.fields.citability")}</dt>
          <dd>
            {t(`research.citability.${citabilityKey(source)}` as never)}
          </dd>
        </div>
        <div>
          <dt>{t("research.fields.capturedAt")}</dt>
          <dd>
            {capturedAt ?? t("research.unavailable")}
          </dd>
        </div>
        <div>
          <dt>{t("research.fields.url")}</dt>
          <dd>
            {sourceHref === null ? (
              t("research.unavailable")
            ) : (
              <a
                className={styles.researchSourceLink}
                href={sourceHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("research.openSource", {
                  label: source.label,
                })}
              >
                {source.url}
              </a>
            )}
          </dd>
        </div>
      </dl>

      <p className={styles.researchSourceSummary}>
        <strong>{t("research.fields.summary")}</strong>
        <span>
          {source.excerpt ?? t("research.unavailable")}
        </span>
      </p>
    </article>
  );
}

function QaRail({
  run,
  connectedProviders,
  currentRevision,
  artifactStatus,
}: {
  readonly run: ContentShadowRun;
  /** `null` while the project's source list is still being read. */
  readonly connectedProviders: readonly string[] | null;
  /**
   * The deliverable's LIVE revision and status, read from the artifacts list.
   *
   * Deliberately not `run.draft.currentRevision`: the run projection pins the
   * draft to the revision its own gate judged, which is the right answer for
   * "what did this run produce" and the wrong one for "is that still the text
   * on screen". Comparing the verdict against the pinned number could only ever
   * report "current", which would make the staleness check decorative.
   */
  readonly currentRevision: number | null;
  readonly artifactStatus: ArtifactLifecycle | null;
}) {
  const t = useTranslations("studio.qa");
  const tProvider = useTranslations("provider");
  const claims = (run.qa?.claims ?? []) as readonly QaClaimView[];
  const counts = qaCounts(claims);
  const groups = qaGroups(claims);
  const blocking = blockingClaims(claims);
  const verdict = run.qa?.verdict ?? null;
  const evaluatedRevision = run.qa?.evaluatedRevision ?? null;
  const stale = verdictIsStale(evaluatedRevision, currentRevision);
  const researchLimitations = run.research?.limitations ?? [];
  const researchSources = (run.research?.sources ?? []).map(researchSourceView);
  const conclusion = sourceConclusionCounts(researchSources);
  const compactSources = researchSources.filter(isPageSource).slice(0, 4);
  const humanState = humanReviewState({
    verdict,
    evaluatedRevision,
    currentRevision,
    artifactStatus,
    hasUnsavedEdits: false,
  });

  return (
    <aside
      className={styles.qaRail}
      aria-label={t("railLabel")}
      data-qa-rail=""
    >
      <div className={styles.qaVerdict}>
        <span className={styles.qaVerdictLabel}>{t("verdictLabel")}</span>
        <StatusPill
          tone={(stale ? "neutral" : verdictTone(verdict)) as StatusTone}
        >
          {stale
            ? t("verdictStale", { revision: evaluatedRevision ?? 0 })
            : t(`verdict.${verdict ?? "none"}` as "verdict.none")}
        </StatusPill>
      </div>
      {run.qa !== null ? (
        <p className={styles.qaNote} data-qa-verdict-revision="">
          {t("verdictRevision", { revision: run.qa.evaluatedRevision })}
        </p>
      ) : null}

      <p className={styles.qaCountsTitle}>
        {run.qa === null
          ? t("countsNotEvaluated")
          : t("countsTitle", { count: counts.total })}
      </p>
      {/* A stale tally is still the truth about the revision it judged, so it
          stays legible and keeps its numbers — it is dimmed, not hidden. */}
      <div className={cx(styles.qaCounts, stale && styles.qaCountsStale)}>
        <div className={styles.qaCountCell}>
          <span>{t("counts.passed")}</span>
          <strong>{run.qa === null ? DASH : counts.passed}</strong>
        </div>
        <div className={styles.qaCountCell}>
          <span>{t("counts.failed")}</span>
          <strong>{run.qa === null ? DASH : counts.failed}</strong>
        </div>
        <div className={styles.qaCountCell}>
          <span>{t("counts.unevaluated")}</span>
          <strong>{run.qa === null ? DASH : counts.unevaluated}</strong>
        </div>
      </div>

      <section className={styles.qaSection}>
        <h4>{t("sectionChecks")}</h4>
        {groups.map((group) => (
          <QaGroupRow key={group.kind} group={group} />
        ))}
        <HumanReviewRow state={humanState} />
      </section>

      {verdict === "blocked" && blocking.length > 0 ? (
        <BlockerBlock claims={blocking} />
      ) : null}

      {run.qa !== null ? (
        <p className={styles.qaScopeNote}>
          {t("scopeNote", {
            advisory: advisoryClaimCount(claims),
            total: counts.total,
          })}
        </p>
      ) : null}

      <section className={styles.qaSection}>
        <h4>{t("sectionEvidence")}</h4>
        <p className={styles.qaNote}>
          {t("researchConclusion", {
            external: conclusion.availableExternalPages,
            firstParty: conclusion.availableFirstPartyPages,
            partial: conclusion.partialPages,
            unavailable: conclusion.unavailablePages,
            pages: conclusion.pageSourcesWithContent,
            identity: conclusion.identityRecords,
          })}
        </p>
        <dl className={styles.qaFacts}>
          <div>
            <dt>{t("facts.frozenRecords")}</dt>
            <dd>
              {run.research === null
                ? DASH
                : t("facts.recordCount", {
                    count: run.research.sources.length,
                  })}
            </dd>
          </div>
          <div>
            <dt>{t("facts.connectedSources")}</dt>
            {/* Named, not counted, and read off every live state rather than
                the single word `connected`: a source that has delivered data
                has already moved past it. */}
            <dd>
              {connectedProviders === null
                ? DASH
                : connectedProviders.length === 0
                  ? t("facts.noConnectedSources")
                  : connectedProviders
                      .map((provider) => tProvider(provider as "crawl"))
                      .join(" · ")}
            </dd>
          </div>
          <div>
            <dt>{t("facts.frozenHash")}</dt>
            <dd>
              <code>{`${run.contentHash.slice(0, HASH_CHARS)}…`}</code>
            </dd>
          </div>
        </dl>
        {compactSources.length > 0 ? (
          <div className={styles.researchSources} data-research-sources="">
            {compactSources.map((source) => (
              <CompactPageSourceRow key={source.id} source={source} />
            ))}
          </div>
        ) : (
          <p className={styles.qaNote} data-research-source-unavailable="sources">
            {t("research.noSources")}
          </p>
        )}
        {researchSources.length > 0 ? (
          <AllSourcesDrawer sources={researchSources} />
        ) : null}
        {researchLimitations.length > 0 ? (
          <ul className={styles.qaNote} data-research-limitations="">
            {researchLimitations.map((limitation, index) => (
              <li key={`${index}:${limitation}`}>{limitation}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className={styles.qaSection}>
        <h4>{t("sectionPublish")}</h4>
        <p className={styles.qaNote}>{t("publishNote")}</p>
      </section>
    </aside>
  );
}

function MetaStrip({
  run,
  actionTitle,
  generationMode,
}: {
  readonly run: ContentShadowRun;
  readonly actionTitle: string | null;
  readonly generationMode: string | null;
}) {
  const t = useTranslations("studio.meta");
  const tQa = useTranslations("studio.qa");
  const counts = qaCounts((run.qa?.claims ?? []) as readonly QaClaimView[]);
  const conversion = run.frozenInputs.firstParty.icpPrimaryConversionUrl;

  return (
    <section className={styles.metaStrip} aria-label={t("stripLabel")}>
      <div className={styles.metaCell}>
        <span className={styles.metaLabel}>{t("linkedTarget")}</span>
        <span className={styles.metaValue}>
          {run.frozenInputs.firstParty.siteOrigin}
          {conversion === null ? "" : ` · ${conversion}`}
        </span>
      </div>
      <div className={styles.metaCell}>
        <span className={styles.metaLabel}>{t("sourceOpportunity")}</span>
        <span className={styles.metaValue}>
          {actionTitle ?? t("notLinked")}
        </span>
      </div>
      <div className={styles.metaCell}>
        <span className={styles.metaLabel}>{t("generation")}</span>
        <span className={styles.metaValue}>
          {generationMode === null
            ? DASH
            : `${t(`mode.${generationMode}` as "mode.template")} · ${run.outputLocale}`}
        </span>
      </div>
      <div className={styles.metaCell}>
        <span className={styles.metaLabel}>{t("automatedChecks")}</span>
        <span className={styles.metaValue}>
          {run.qa === null
            ? t("notEvaluatedYet")
            : tQa("countsInline", {
                passed: counts.passed,
                failed: counts.failed,
                unevaluated: counts.unevaluated,
              })}
        </span>
      </div>
    </section>
  );
}

function phaseTone(phase: ContentShadowRun["phase"]): StatusTone {
  if (phase === "failed") return "danger";
  if (phase === "complete") return "neutral";
  return "info";
}

function DocBody({ run }: { readonly run: ContentShadowRun }) {
  const t = useTranslations("studio.shadow");
  const body = run.draft?.contentText ?? null;

  if (body !== null && body.trim().length > 0) {
    return (
      <div className={styles.docBody} data-shadow-body="">
        <p className={styles.docLabel}>
          {t("draftMetadata", { locale: run.outputLocale })}
        </p>
        <MarkdownBlocks markdown={body} tableClassName={styles.tableScroll} />
      </div>
    );
  }

  if (run.phase === "failed") {
    return (
      <div className={styles.docBody}>
        <p>{t("runFailedBody")}</p>
      </div>
    );
  }

  // No skeleton: a fake body shaped like a real one reads as content.
  return (
    <div className={styles.docBody}>
      <div className={styles.docPending}>
        <Spinner size="lg" label={t(`phase.${run.phase}`)} />
        <p>{t(`phase.${run.phase}`)}</p>
        <p className={styles.qaNote}>
          {t("frozenHash", { hash: run.contentHash.slice(0, HASH_CHARS) })}
        </p>
      </div>
    </div>
  );
}

type CompareMode = "draft" | "compare";

/** Tab order of the view switch; the keyboard walks exactly this. */
const VIEW_MODES: readonly CompareMode[] = ["draft", "compare"];

function viewTabId(mode: CompareMode): string {
  return `sf-shadow-view-${mode}`;
}

function DocPanel({
  projectId,
  run,
  actionTitle,
  generationMode,
  connectedProviders,
  liveArtifact,
  revisionHistory,
  compareMode,
  onCompareMode,
}: {
  readonly projectId: string;
  readonly run: ContentShadowRun;
  readonly actionTitle: string | null;
  readonly generationMode: string | null;
  readonly connectedProviders: readonly string[] | null;
  readonly liveArtifact: Artifact | null;
  readonly revisionHistory: readonly ArtifactRevisionHistoryView[];
  readonly compareMode: CompareMode;
  readonly onCompareMode: (mode: CompareMode) => void;
}) {
  const t = useTranslations("studio.shadow");
  const tQa = useTranslations("studio.qa");
  const tCompare = useTranslations("studio.compare");
  const claims = (run.qa?.claims ?? []) as readonly QaClaimView[];
  const evaluatedRevision = run.qa?.evaluatedRevision ?? null;
  // The live artifact is the authority on "what revision is on screen"; the run
  // projection pins its draft to the revision its own gate judged.
  const currentRevision =
    liveArtifact?.currentRevision ?? run.draft?.currentRevision ?? 0;
  const artifactStatus = (liveArtifact?.status ??
    run.draft?.status ??
    null) as ArtifactLifecycle | null;
  const stale = verdictIsStale(evaluatedRevision, currentRevision);
  const briefLinkBroken =
    run.frozenInputs.contentBriefOutline.briefSections.length === 0;
  const briefQuery = useArtifactRevision(
    projectId,
    run.source.contentBriefArtifactId,
    run.source.contentBriefRevision,
  );

  /**
   * Arrow-key navigation, which a `tablist` with roving `tabIndex` owes its
   * users and this one did not have.
   *
   * Only the selected tab is in the Tab sequence — that is the whole point of
   * roving tabIndex — so without this handler the unselected tab was reachable
   * by no key at all, and the entire brief-versus-draft comparison had no
   * keyboard path into it. Same shape as the Evidence drawer's tablist, which
   * already got this right.
   */
  function onViewKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % VIEW_MODES.length;
    if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + VIEW_MODES.length) % VIEW_MODES.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = VIEW_MODES.length - 1;
    if (nextIndex === null) return;
    const next = VIEW_MODES[nextIndex];
    if (next === undefined) return;
    event.preventDefault();
    onCompareMode(next);
    // The new tab has to take focus, or the next arrow press starts from the
    // tab the reader has already left.
    requestAnimationFrame(() =>
      document.getElementById(viewTabId(next))?.focus(),
    );
  }

  return (
    <article className={styles.docPanel} data-shadow-doc="">
      <header className={styles.docHead}>
        <div className={styles.docKicker}>
          <Badge>{t("deliverableType")}</Badge>
          {/* Revision is stated here permanently: it is what the review below
              binds to, and a review of an unnamed version is not a review. */}
          <span className={styles.docRevision} data-shadow-revision="">
            {currentRevision === 0
              ? t("noRevision")
              : t("revision", { revision: currentRevision })}
          </span>
          {artifactStatus === null ? null : (
            <StatusPill
              tone={artifactStatus === "ready" ? "success" : "neutral"}
              data-shadow-status={artifactStatus}
            >
              {t(`artifactStatus.${artifactStatus}` as "artifactStatus.draft")}
            </StatusPill>
          )}
          {run.phase !== "complete" ? (
            <StatusPill tone={phaseTone(run.phase)}>
              {t(`phase.${run.phase}`)}
            </StatusPill>
          ) : null}
          {run.status === "partial" ? (
            <StatusPill tone="warning">{t("partial")}</StatusPill>
          ) : null}
          {run.qa?.verdict === "blocked" ? (
            <StatusPill tone="warning">{tQa("kickerBlocked")}</StatusPill>
          ) : null}
        </div>
        <h3 className={styles.docTitle}>{actionTitle ?? t("untitled")}</h3>
        <div className={styles.docActions}>
          <RevisionHistory
            currentRevision={currentRevision}
            evaluatedRevision={evaluatedRevision}
            revisions={revisionHistory}
          />
          <ReviewSurface
            projectId={projectId}
            flowShadowRunId={run.flowShadowRunId}
            deliverableTitle={actionTitle ?? t("untitled")}
            contentHash={run.contentHash}
            verdict={run.qa?.verdict ?? null}
            evaluatedRevision={evaluatedRevision}
            currentRevision={currentRevision === 0 ? null : currentRevision}
            artifactStatus={artifactStatus}
            blockingCount={blockingClaims(claims).length}
            briefRevision={run.source.contentBriefRevision}
            claimCounts={qaCounts(claims)}
          />
        </div>
      </header>

      <MetaStrip
        run={run}
        actionTitle={actionTitle}
        generationMode={generationMode}
      />

      {stale ? <StaleReviewBanner revision={currentRevision} /> : null}

      {briefLinkBroken ? (
        <div className={styles.briefLinkBroken} data-shadow-brief-broken="">
          <strong>{t("briefLinkBroken.title")}</strong>
          <span>{t("briefLinkBroken.body")}</span>
        </div>
      ) : null}

      {/* Side by side is a mode, not the default: at any real window width two
          bodies plus a queue plus a quality rail leave neither body a readable
          measure, and an unreadable body is not evidence a reviewer can judge. */}
      <div
        className={styles.viewSwitch}
        role="tablist"
        aria-label={tCompare("switchLabel")}
      >
        {VIEW_MODES.map((mode, index) => (
          <button
            key={mode}
            type="button"
            role="tab"
            id={viewTabId(mode)}
            aria-selected={compareMode === mode}
            aria-controls="sf-shadow-view-panel"
            tabIndex={compareMode === mode ? 0 : -1}
            className={styles.viewSwitchBtn}
            onClick={() => onCompareMode(mode)}
            onKeyDown={(event) => onViewKeyDown(event, index)}
            data-view-switch={mode}
          >
            {tCompare(mode === "draft" ? "switchDraft" : "switchCompare")}
          </button>
        ))}
      </div>

      <div
        id="sf-shadow-view-panel"
        role="tabpanel"
        aria-labelledby={viewTabId(compareMode)}
        className={styles.docGrid}
      >
        {compareMode === "compare" ? (
          <ComparePanes
            outline={run.frozenInputs.contentBriefOutline}
            briefRevision={run.source.contentBriefRevision}
            briefContent={briefQuery.data?.current ?? null}
            briefLoading={briefQuery.isPending}
            /* The revision these BYTES are, not the deliverable's live one:
               `run.draft.contentText` is the text this run froze and its gate
               judged. Labelling it with `currentRevision` put an edited
               deliverable's number over superseded prose. */
            draftRevision={run.draft?.currentRevision ?? currentRevision}
            liveDraftRevision={currentRevision === 0 ? null : currentRevision}
            draftBody={run.draft?.contentText ?? null}
            outputLocale={run.outputLocale}
            coverageClaim={coverageClaimOf(claims)}
          />
        ) : (
          <DocBody run={run} />
        )}
        <QaRail
          run={run}
          connectedProviders={connectedProviders}
          currentRevision={currentRevision === 0 ? null : currentRevision}
          artifactStatus={artifactStatus}
        />
      </div>
    </article>
  );
}

/**
 * Flatten the index pages, keeping the first projection of each run.
 *
 * The shared helper keys on `id`; a shadow run's identity is
 * `flowShadowRunId`, and renaming it on the wire to fit a helper would be the
 * tail wagging the dog.
 */
function shadowRunItems(
  data:
    | InfiniteData<ListEnvelope<ContentShadowRunSummary>, string | null>
    | undefined,
): readonly ContentShadowRunSummary[] {
  if (data === undefined) return [];
  const seen = new Set<string>();
  const items: ContentShadowRunSummary[] = [];
  for (const page of data.pages) {
    for (const item of page.data) {
      if (seen.has(item.flowShadowRunId)) continue;
      seen.add(item.flowShadowRunId);
      items.push(item);
    }
  }
  return items;
}

function runTitle(
  summary: ContentShadowRunSummary,
  actionById: ReadonlyMap<string, ArtifactAction>,
): string | null {
  return actionById.get(summary.source.actionId)?.title ?? null;
}

export function ContentShadowSection({
  projectId,
}: {
  readonly projectId: string;
}) {
  const t = useTranslations("studio.shadow");
  const runsQuery = useContentShadowRuns(projectId);
  const actionsQuery = useProjectActions(projectId);
  const artifactsQuery = useProjectArtifacts(projectId);
  const sourcesQuery = useProjectSources(projectId);
  const runs = shadowRunItems(runsQuery.data);
  const actions = uniqueCursorItems(actionsQuery.data);
  const artifacts = uniqueCursorItems(artifactsQuery.data);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState<CompareMode>("draft");

  const actionById = useMemo(
    () => new Map(actions.map((action) => [action.id, action])),
    [actions],
  );

  const selected =
    runs.find((run) => run.flowShadowRunId === selectedId) ?? runs[0] ?? null;
  const detailQuery = useContentShadowRun(
    projectId,
    selected?.flowShadowRunId ?? null,
  );
  const detail = detailQuery.data ?? null;

  /**
   * The deliverable as it stands right now.
   *
   * The run projection answers "what did this run produce", pinned to the
   * revision its own gate judged. Whether that is still the current text is a
   * different question, and only the artifacts list can answer it — which is
   * exactly what makes an edit visible as an edit here.
   */
  const liveArtifact =
    detail?.draft == null
      ? null
      : (artifacts.find(
          (artifact) => artifact.id === detail.draft?.artifactId,
        ) ?? null);
  const generationMode = liveArtifact?.generationMode ?? null;
  const connectedProviders =
    sourcesQuery.data === undefined
      ? null
      : connectedSourceProviders(sourcesQuery.data);

  if (runsQuery.isError) {
    return (
      <ProblemNotice
        error={runsQuery.error ?? new Error("unknown")}
        message={t("loadError")}
        onRetry={() => void runsQuery.refetch()}
        compact
      />
    );
  }
  // Nothing to say when the project has produced no content deliverable yet:
  // an empty panel here would be noise, and its absence asserts nothing.
  if (runs.length === 0) return null;

  return (
    <section
      className={styles.shadow}
      aria-labelledby="sf-shadow-title"
      data-content-shadow=""
    >
      <header className={styles.shadowHead}>
        <span className="sf-eyebrow">{t("eyebrow")}</span>
        <h2 id="sf-shadow-title" className={styles.shadowTitle}>
          {t("title")}
        </h2>
        <p className={styles.shadowLead}>{t("lead")}</p>
      </header>

      {/* Side by side needs the width the queue is holding, so the queue
          becomes a horizontal rail — the same shape it already takes on a
          narrow window, rather than a second layout invented for this mode. */}
      <div className={styles.workspace} data-compare-mode={compareMode}>
        <Panel
          padding="none"
          className={styles.workQueue}
          aria-label={t("queueTitle")}
        >
          <div className={styles.queueHead}>
            <div>
              <span className="sf-eyebrow">{t("queueEyebrow")}</span>
              <h3 className={styles.queueTitle}>{t("queueTitle")}</h3>
            </div>
            <Badge>{runs.length}</Badge>
          </div>
          <ul className={styles.queueList}>
            {runs.map((run) => {
              const title = runTitle(run, actionById);
              const current = run.flowShadowRunId === selected?.flowShadowRunId;
              return (
                <li key={run.flowShadowRunId}>
                  <button
                    type="button"
                    className={styles.queueItem}
                    aria-current={current}
                    onClick={() => setSelectedId(run.flowShadowRunId)}
                  >
                    <span className={styles.queueMark} aria-hidden="true">
                      EN
                    </span>
                    <span className={styles.queueText}>
                      <span className={styles.queueItemTitle}>
                        {title ?? t("untitled")}
                      </span>
                      <span className={styles.queueItemMeta}>
                        {t("briefRevision", {
                          revision: run.source.contentBriefRevision,
                        })}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>

        {detailQuery.isError ? (
          <Panel padding="lg" className={styles.docPanel}>
            <ProblemState
              error={detailQuery.error ?? new Error("unknown")}
              onRetry={() => void detailQuery.refetch()}
            />
          </Panel>
        ) : detail === null ? (
          <Panel padding="lg" className={styles.docPanel}>
            <EmptyState title={t("loading")} />
          </Panel>
        ) : (
          <DocPanel
            projectId={projectId}
            run={detail}
            actionTitle={actionById.get(detail.source.actionId)?.title ?? null}
            generationMode={generationMode}
            connectedProviders={connectedProviders}
            liveArtifact={liveArtifact}
            revisionHistory={artifactRevisionHistory(
              detail.draft,
              detail.qa?.evaluatedRevision ?? null,
              liveArtifact?.currentRevision ?? detail.draft?.currentRevision ?? null,
            )}
            compareMode={compareMode}
            onCompareMode={setCompareMode}
          />
        )}
      </div>
    </section>
  );
}
