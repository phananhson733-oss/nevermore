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

import { useMemo, useState } from "react";
import type { InfiniteData } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
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
  useContentShadowRun,
  useContentShadowRuns,
  type ContentShadowRun,
  type ContentShadowRunSummary,
} from "@/lib/api/hooks-content-shadow";
import { useProjectSources } from "@/lib/api/hooks-sources";
import {
  useProjectActions,
  useProjectArtifacts,
  type ArtifactAction,
} from "@/lib/api/hooks-studio";
import { ProblemNotice, ProblemState } from "../_problem-display";
import { MarkdownBlocks } from "./_markdown-blocks.tsx";
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
import styles from "./execution.module.css";

const DASH = "—";
const HASH_CHARS = 12;

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
    group.reasonClaim === null ? null : claimLabelKey(group.reasonClaim.claimId);
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
            <li key={claim.claimId}>
              {key === null ? t("claimUnnamed") : t(`claimLabels.${key}`)}
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

function QaRail({
  run,
  connectedSourceCount,
}: {
  readonly run: ContentShadowRun;
  readonly connectedSourceCount: number | null;
}) {
  const t = useTranslations("studio.qa");
  const claims = (run.qa?.claims ?? []) as readonly QaClaimView[];
  const counts = qaCounts(claims);
  const groups = qaGroups(claims);
  const blocking = blockingClaims(claims);
  const verdict = run.qa?.verdict ?? null;
  const stale = verdictIsStale(
    run.qa?.evaluatedRevision ?? null,
    run.draft?.currentRevision ?? null,
  );
  const externalLimitation = run.research?.limitations[0] ?? null;

  return (
    <aside className={styles.qaRail} aria-label={t("railLabel")} data-qa-rail="">
      <div className={styles.qaVerdict}>
        <span className={styles.qaVerdictLabel}>{t("verdictLabel")}</span>
        <StatusPill tone={verdictTone(verdict) as StatusTone}>
          {stale
            ? t("verdictStale")
            : t(`verdict.${verdict ?? "none"}` as "verdict.none")}
        </StatusPill>
      </div>
      {run.qa !== null ? (
        <p className={styles.qaNote}>
          {t("verdictRevision", { revision: run.qa.evaluatedRevision })}
        </p>
      ) : null}

      <p className={styles.qaCountsTitle}>
        {run.qa === null
          ? t("countsNotEvaluated")
          : t("countsTitle", { count: counts.total })}
      </p>
      <div className={styles.qaCounts}>
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

      {groups.length > 0 ? (
        <section className={styles.qaSection}>
          <h4>{t("sectionChecks")}</h4>
          {groups.map((group) => (
            <QaGroupRow key={group.kind} group={group} />
          ))}
        </section>
      ) : null}

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
            <dt>{t("facts.externalCitable")}</dt>
            {/* Zero by construction, and said so rather than left blank: the
                pack holds only records already confirmed inside the project. */}
            <dd>{t("facts.externalCitableValue")}</dd>
          </div>
          <div>
            <dt>{t("facts.connectedSources")}</dt>
            <dd>
              {connectedSourceCount === null
                ? DASH
                : connectedSourceCount === 0
                  ? t("facts.noConnectedSources")
                  : t("facts.recordCount", { count: connectedSourceCount })}
            </dd>
          </div>
          <div>
            <dt>{t("facts.frozenHash")}</dt>
            <dd>
              <code>{`${run.contentHash.slice(0, HASH_CHARS)}…`}</code>
            </dd>
          </div>
        </dl>
        {externalLimitation !== null ? (
          <p className={styles.qaNote}>{externalLimitation}</p>
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
        <span className={styles.metaValue}>{actionTitle ?? t("notLinked")}</span>
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
          {`English draft · Target market: ${run.outputLocale}`}
        </p>
        <MarkdownBlocks
          markdown={body}
          tableClassName={styles.tableScroll}
        />
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

function DocPanel({
  run,
  actionTitle,
  generationMode,
  connectedSourceCount,
}: {
  readonly run: ContentShadowRun;
  readonly actionTitle: string | null;
  readonly generationMode: string | null;
  readonly connectedSourceCount: number | null;
}) {
  const t = useTranslations("studio.shadow");
  const tQa = useTranslations("studio.qa");
  const revision = run.draft?.currentRevision ?? 0;
  const briefLinkBroken =
    run.frozenInputs.contentBriefOutline.briefSections.length === 0;

  return (
    <article className={styles.docPanel} data-shadow-doc="">
      <header className={styles.docHead}>
        <div className={styles.docKicker}>
          <Badge>{t("deliverableType")}</Badge>
          <span className={styles.docRevision}>
            {revision === 0 ? t("noRevision") : t("revision", { revision })}
          </span>
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
      </header>

      <MetaStrip
        run={run}
        actionTitle={actionTitle}
        generationMode={generationMode}
      />

      {briefLinkBroken ? (
        <div className={styles.briefLinkBroken} data-shadow-brief-broken="">
          <strong>{t("briefLinkBroken.title")}</strong>
          <span>{t("briefLinkBroken.body")}</span>
        </div>
      ) : null}

      <div className={styles.docGrid}>
        <DocBody run={run} />
        <QaRail run={run} connectedSourceCount={connectedSourceCount} />
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

  const generationMode =
    detail?.draft === undefined || detail?.draft === null
      ? null
      : (artifacts.find((artifact) => artifact.id === detail.draft?.artifactId)
          ?.generationMode ?? null);

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

      <div className={styles.workspace}>
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
            run={detail}
            actionTitle={
              actionById.get(detail.source.actionId)?.title ?? null
            }
            generationMode={generationMode}
            connectedSourceCount={
              sourcesQuery.data === undefined
                ? null
                : sourcesQuery.data.filter(
                    (source) => source.state === "connected",
                  ).length
            }
          />
        )}
      </div>
    </section>
  );
}
