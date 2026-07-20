"use client";

/**
 * Plan client view (spec §4.2, §9.3): the deterministic 30/60/90 roadmap. Actions
 * are grouped into three lanes by their server-assigned `roadmapLane`
 * (now = 0–30d, next = 31–60d, later = 61–90d) — the UI never recomputes
 * priority (spec §1.3). Each card states its priority band and status with a
 * text label + tone (never color alone, spec §4.4). A `blocked` action is the
 * low-confidence hard gate (spec §9.3 rule 7): shown distinctly with an
 * explanation. The per-card override form applies a status/priority/lane change
 * with a REQUIRED reason via `useUpdateAction`; a 409 VERSION_CONFLICT refetches
 * and informs. TanStack Query owns the server state (spec §3.2).
 */

import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Flame, Layers3, Rocket, ShieldCheck } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Panel,
  Spinner,
  StatusPill,
  TextArea,
  cx,
  useFieldControl,
  type StatusTone,
} from "@/components/ui";
import { ApiError } from "@/lib/api";
import { uniqueCursorItems } from "@/lib/api/cursor-pages";
import {
  useProjectActions,
  useUpdateAction,
  type Action,
  type ActionStatus,
  type PriorityBand,
  type RoadmapLane,
} from "@/lib/api/hooks-plan";
import { ProblemNotice, ProblemState } from "../_problem-display";
import { allowedActionStatusTargets } from "./_action-status-transitions";
import styles from "./plan.module.css";

/** The three delivery windows, in the spec's canonical order (spec §9.3). */
const LANES = ["now", "next", "later"] as const;
type Lane = (typeof LANES)[number];

/** `plan.*` message key for each lane's delivery window (0–30 / 31–60 / 61–90). */
const LANE_WINDOW_KEY: Record<
  Lane,
  "laneNowWindow" | "laneNextWindow" | "laneLaterWindow"
> = {
  now: "laneNowWindow",
  next: "laneNextWindow",
  later: "laneLaterWindow",
};

/** Priority band -> pill tone. The pill always carries a text label alongside. */
const PRIORITY_TONE: Record<PriorityBand, StatusTone> = {
  critical: "danger",
  high: "warning",
  medium: "info",
  low: "neutral",
};

/** Action status -> pill tone. The pill always carries a text label alongside. */
const STATUS_TONE: Record<ActionStatus, StatusTone> = {
  candidate: "neutral",
  planned: "info",
  in_progress: "priority",
  blocked: "danger",
  done: "success",
  dismissed: "neutral",
};

const PRIORITY_OPTIONS: readonly PriorityBand[] = [
  "critical",
  "high",
  "medium",
  "low",
];
const LANE_OPTIONS: readonly Lane[] = ["now", "next", "later"];

interface SelectOption {
  readonly value: string;
  readonly label: string;
}

/** Partition actions into the three lanes by server-assigned `roadmapLane`. */
function groupByLane(
  actions: readonly Action[],
): Record<Lane, readonly Action[]> {
  return {
    now: actions.filter((action) => action.roadmapLane === "now"),
    next: actions.filter((action) => action.roadmapLane === "next"),
    later: actions.filter((action) => action.roadmapLane === "later"),
  };
}

// --------------------------------------------------------------- Controls ---

interface PlanSelectProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly SelectOption[];
  /** The "no change" option (value ""); keeps the action's current value. */
  readonly keepLabel: string;
}

/** Native select wired to an enclosing `Field` (id, describedBy, invalid). */
function PlanSelect({ value, onChange, options, keepLabel }: PlanSelectProps) {
  const field = useFieldControl();
  return (
    <select
      className={cx(styles.select, field?.invalid && styles.selectInvalid)}
      id={field?.controlId}
      aria-describedby={field?.describedBy}
      aria-invalid={field?.invalid || undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{keepLabel}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

// ------------------------------------------------------------ Override form --

interface OverrideFormProps {
  readonly projectId: string;
  readonly action: Action;
  readonly onClose: () => void;
  /** Refetch the plan after a 409 conflict so the card shows the latest values. */
  readonly onConflict: () => void;
}

/**
 * Per-action override form. Change any subset of status/priority/window, always
 * with a reason (min 3 chars). Submits `baseRevision = action.revision`; a 409
 * VERSION_CONFLICT refetches the plan and informs the operator.
 */
function OverrideForm({
  projectId,
  action,
  onClose,
  onConflict,
}: OverrideFormProps) {
  const t = useTranslations("plan");
  const tCommon = useTranslations("common");
  const tStatus = useTranslations("actionStatus");
  const tPriority = useTranslations("priorityBand");
  const tLane = useTranslations("lane");
  const update = useUpdateAction(projectId);

  const [statusSel, setStatusSel] = useState<string>("");
  const [prioritySel, setPrioritySel] = useState<string>("");
  const [laneSel, setLaneSel] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [problemError, setProblemError] = useState<unknown | null>(null);

  const allowedStatusTargets = allowedActionStatusTargets(action.status);
  const statusOptions: readonly SelectOption[] = allowedStatusTargets.map(
    (value) => ({ value, label: tStatus(value) }),
  );
  const priorityOptions: readonly SelectOption[] = PRIORITY_OPTIONS.map(
    (value) => ({
      value,
      label: tPriority(value),
    }),
  );
  const laneOptions: readonly SelectOption[] = LANE_OPTIONS.map((value) => ({
    value,
    label: tLane(value),
  }));

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setError(null);
    setProblemError(null);

    const trimmedReason = reason.trim();
    if (trimmedReason.length < 3) {
      setError(t("reasonRequired"));
      setProblemError(null);
      return;
    }

    // Only send fields that were set to a NEW value (different from current).
    const changes: {
      status?: ActionStatus;
      priorityBand?: PriorityBand;
      roadmapLane?: RoadmapLane;
    } = {};
    if (
      statusSel !== "" &&
      allowedStatusTargets.includes(statusSel as ActionStatus)
    ) {
      changes.status = statusSel as ActionStatus;
    }
    if (prioritySel !== "" && prioritySel !== action.priorityBand) {
      changes.priorityBand = prioritySel as PriorityBand;
    }
    if (laneSel !== "" && laneSel !== action.roadmapLane) {
      changes.roadmapLane = laneSel as RoadmapLane;
    }
    if (Object.keys(changes).length === 0) {
      setError(t("noChange"));
      setProblemError(null);
      return;
    }

    const trimmedNote = note.trim();
    try {
      await update.mutateAsync({
        actionId: action.id,
        body: {
          baseRevision: action.revision,
          reason: trimmedReason,
          ...changes,
          ...(trimmedNote.length > 0 ? { note: trimmedNote } : {}),
        },
      });
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "VERSION_CONFLICT") {
        setError(t("conflict"));
        setProblemError(caught);
        onConflict();
        return;
      }
      if (caught instanceof ApiError) {
        setError(tCommon("error"));
        setProblemError(caught);
        return;
      }
      setError(tCommon("error"));
      setProblemError(null);
    }
  }

  const busy = update.isPending;

  return (
    <form
      className={styles.overrideForm}
      onSubmit={handleSubmit}
      aria-label={`${t("overrideTitle")} — ${action.title}`}
    >
      <div className={styles.overrideHead}>
        <h4 className={styles.overrideTitle}>{t("overrideTitle")}</h4>
        <p className={styles.overrideDesc}>{t("overrideDescription")}</p>
      </div>

      <div className={styles.overrideGrid}>
        <Field label={t("newStatus")}>
          <PlanSelect
            value={statusSel}
            onChange={setStatusSel}
            options={statusOptions}
            keepLabel={`${t("keepUnchanged")} — ${tStatus(action.status)}`}
          />
        </Field>
        <Field label={t("newPriority")}>
          <PlanSelect
            value={prioritySel}
            onChange={setPrioritySel}
            options={priorityOptions}
            keepLabel={t("keepUnchanged")}
          />
        </Field>
        <Field label={t("newLane")}>
          <PlanSelect
            value={laneSel}
            onChange={setLaneSel}
            options={laneOptions}
            keepLabel={t("keepUnchanged")}
          />
        </Field>
      </div>

      <Field label={t("reason")} help={t("reasonHelp")} required>
        <TextArea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          placeholder={t("reasonPlaceholder")}
        />
      </Field>

      <Field label={t("note")} help={t("noteOptional")}>
        <TextArea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          placeholder={t("notePlaceholder")}
        />
      </Field>

      <p className={styles.overrideKept}>{t("overrideKept")}</p>

      {error !== null ? (
        problemError !== null ? (
          <ProblemNotice
            className={styles.overrideError}
            error={problemError}
            message={error}
            compact
          />
        ) : (
          <p className={styles.overrideError} role="alert">
            {error}
          </p>
        )
      ) : null}

      <div className={styles.overrideActions}>
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          {tCommon("cancel")}
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? t("applying") : t("applyOverride")}
        </Button>
      </div>
    </form>
  );
}

// --------------------------------------------------------------- Card -------

interface ActionCardProps {
  readonly projectId: string;
  readonly action: Action;
  readonly onConflict: () => void;
  /** A lane-level note can own the repeated explanation for an all-blocked set. */
  readonly showBlockedExplanation?: boolean;
  /** Associates a visually deduplicated lane explanation with this card. */
  readonly blockedExplanationId?: string;
}

function ActionCard({
  projectId,
  action,
  onConflict,
  showBlockedExplanation = true,
  blockedExplanationId,
}: ActionCardProps) {
  const t = useTranslations("plan");
  const tStatus = useTranslations("actionStatus");
  const tPriority = useTranslations("priorityBand");
  const [open, setOpen] = useState<boolean>(false);
  const isBlocked = action.status === "blocked";

  return (
    <Card
      padding="md"
      className={cx(styles.actionCard, isBlocked && styles.actionCardBlocked)}
      role="article"
      data-testid="plan-action-card"
      data-action-status={action.status}
      aria-describedby={isBlocked ? blockedExplanationId : undefined}
    >
      <div className={styles.actionTopline}>
        <StatusPill tone={PRIORITY_TONE[action.priorityBand]}>
          {`${t("priority")}: ${tPriority(action.priorityBand)}`}
        </StatusPill>
        <StatusPill tone={STATUS_TONE[action.status]}>
          {tStatus(action.status)}
        </StatusPill>
      </div>

      <h3 className={styles.actionTitle}>{action.title}</h3>
      <p className={styles.actionDesc}>{action.description}</p>

      {isBlocked && showBlockedExplanation ? (
        <p className={styles.blockedNote}>
          <span className={styles.blockedLabel}>{t("blocked")}</span>
          {t("blockedExplanation")}
        </p>
      ) : null}

      <dl className={styles.actionMeta}>
        <div className={styles.metaItem}>
          <dt className={styles.metaLabel}>{t("effort")}</dt>
          <dd className={styles.metaValue}>
            {t(`effortValue.${action.effort}`)}
          </dd>
        </div>
        <div className={styles.metaItem}>
          <dt className={styles.metaLabel}>{t("risk")}</dt>
          <dd className={styles.metaValue}>{t(`riskValue.${action.risk}`)}</dd>
        </div>
      </dl>

      <div className={styles.outcome}>
        <span className={styles.metaLabel}>{t("expectedOutcome")}</span>
        <p className={styles.outcomeText}>{action.expectedOutcome}</p>
      </div>

      <div className={styles.actionFoot}>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
        >
          {t("override")}
        </Button>
      </div>

      {open ? (
        <OverrideForm
          projectId={projectId}
          action={action}
          onClose={() => setOpen(false)}
          onConflict={onConflict}
        />
      ) : null}
    </Card>
  );
}

// --------------------------------------------------------------- Lane -------

interface LaneColumnProps {
  readonly projectId: string;
  readonly lane: Lane;
  /** Two-digit ordinal ("01"/"02"/"03") shown as the lane's Fraunces index. */
  readonly index: string;
  readonly actions: readonly Action[];
  readonly hasMore: boolean;
  readonly onConflict: () => void;
}

function LaneColumn({
  projectId,
  lane,
  index,
  actions,
  hasMore,
  onConflict,
}: LaneColumnProps) {
  const t = useTranslations("plan");
  const tLane = useTranslations("lane");
  const sharesBlockedExplanation =
    !hasMore &&
    actions.length > 1 &&
    actions.every((action) => action.status === "blocked");
  const sharedBlockedExplanationId = `plan-${lane}-blocked-explanation`;

  return (
    <Panel
      padding="lg"
      className={styles.lane}
      aria-label={`${tLane(lane)} — ${t(LANE_WINDOW_KEY[lane])}`}
    >
      <header className={styles.laneHead}>
        <span className={styles.laneIndex} aria-hidden="true">
          {index}
        </span>
        <div className={styles.laneHeadText}>
          <div className={styles.laneTitleRow}>
            <h2 className={styles.laneName}>{tLane(lane)}</h2>
            <Badge>
              {actions.length}
              {hasMore ? "+" : ""}
            </Badge>
          </div>
          <span className={styles.laneWindow}>{t(LANE_WINDOW_KEY[lane])}</span>
        </div>
      </header>
      {sharesBlockedExplanation ? (
        <p
          id={sharedBlockedExplanationId}
          role="note"
          className={styles.laneBlockedNote}
          data-testid="plan-lane-blocked-note"
        >
          <span className={styles.blockedLabel}>{t("blocked")}</span>
          <span>{t("blockedExplanation")}</span>
        </p>
      ) : null}
      <div
        className={cx(
          styles.laneBody,
          sharesBlockedExplanation && styles.laneBodyBlockedGroup,
        )}
        data-testid="plan-lane-actions"
      >
        {actions.length === 0 ? (
          <p className={styles.laneEmpty}>
            {hasMore ? t("laneEmptyPartial") : t("laneEmpty")}
          </p>
        ) : (
          actions.map((action) => (
            <ActionCard
              key={action.id}
              projectId={projectId}
              action={action}
              onConflict={onConflict}
              showBlockedExplanation={!sharesBlockedExplanation}
              {...(sharesBlockedExplanation
                ? { blockedExplanationId: sharedBlockedExplanationId }
                : {})}
            />
          ))
        )}
      </div>
    </Panel>
  );
}

// --------------------------------------------------------------- Screen -----

/**
 * Plan entry: owns the `actions` query and renders loading / error / empty /
 * ready states. The project shell layout provides the chrome; this renders
 * content only.
 */
export function PlanClient({ projectId }: { readonly projectId: string }) {
  const t = useTranslations("plan");
  const tCommon = useTranslations("common");
  const query = useProjectActions(projectId);

  if (query.isLoading) {
    return (
      <div className={styles.state}>
        <Spinner size="lg" label={tCommon("loading")} />
        <p className={styles.stateText}>{tCommon("loading")}</p>
      </div>
    );
  }

  if (query.isError && query.data === undefined) {
    return (
      <div className={styles.state}>
        <ProblemState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const actions = uniqueCursorItems(query.data);
  const grouped = groupByLane(actions);
  const visibleLanes = LANES.flatMap((lane, index) =>
    grouped[lane].length > 0 ? [{ lane, index }] : [],
  );
  const highPriorityCount = actions.filter(
    (action) =>
      action.priorityBand === "critical" || action.priorityBand === "high",
  ).length;
  const inDeliveryCount = actions.filter(
    (action) => action.status === "in_progress" || action.status === "done",
  ).length;
  const onConflict = () => {
    void query.refetch();
  };

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroText}>
          <span className="sf-eyebrow">{t("kicker")}</span>
          <h1 className={styles.title}>{t("title")}</h1>
          <p className={styles.subtitle}>{t("subtitle")}</p>
        </div>
      </header>

      {actions.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyHint")} />
      ) : (
        <>
          <section
            className={styles.summaryStrip}
            aria-label={t("summaryTitle")}
          >
            <article className={styles.summaryCard}>
              <span className={styles.summaryIcon}>
                <Layers3 aria-hidden="true" size={18} />
              </span>
              <span className={styles.summaryMetric}>
                {actions.length}
                {query.hasNextPage ? "+" : ""}
              </span>
              <div className={styles.summaryText}>
                <span className={styles.summaryLabel}>
                  {t("summaryPrioritized")}
                </span>
                <p className={styles.summaryHint}>
                  {t("summaryPrioritizedHint")}
                </p>
              </div>
            </article>
            <article className={styles.summaryCard}>
              <span className={cx(styles.summaryIcon, styles.summaryIconAmber)}>
                <Flame aria-hidden="true" size={18} />
              </span>
              <span className={styles.summaryMetric}>
                {highPriorityCount}
                {query.hasNextPage ? "+" : ""}
              </span>
              <div className={styles.summaryText}>
                <span className={styles.summaryLabel}>
                  {t("summaryHighPriority")}
                </span>
                <p className={styles.summaryHint}>
                  {t("summaryHighPriorityHint")}
                </p>
              </div>
            </article>
            <article className={styles.summaryCard}>
              <span className={cx(styles.summaryIcon, styles.summaryIconMint)}>
                <Rocket aria-hidden="true" size={18} />
              </span>
              <span className={styles.summaryMetric}>
                {inDeliveryCount}
                {query.hasNextPage ? "+" : ""}
              </span>
              <div className={styles.summaryText}>
                <span className={styles.summaryLabel}>
                  {t("summaryInDelivery")}
                </span>
                <p className={styles.summaryHint}>
                  {t("summaryInDeliveryHint")}
                </p>
              </div>
            </article>
            <article className={cx(styles.summaryCard, styles.methodCard)}>
              <span className={styles.methodHead}>
                <ShieldCheck aria-hidden="true" size={16} />
                <span className={styles.methodTitle}>{t("methodTitle")}</span>
              </span>
              <p className={styles.methodCopy}>{t("methodCopy")}</p>
            </article>
          </section>

          <div
            className={styles.board}
            data-testid="plan-board"
            data-lane-count={visibleLanes.length}
          >
            {visibleLanes.map(({ lane, index }) => (
              <LaneColumn
                key={lane}
                projectId={projectId}
                lane={lane}
                index={String(index + 1).padStart(2, "0")}
                actions={grouped[lane]}
                hasMore={query.hasNextPage}
                onConflict={onConflict}
              />
            ))}
          </div>
          {query.hasNextPage || query.isFetchNextPageError ? (
            <div className={styles.pagination}>
              {query.isFetchNextPageError ? (
                <p className={styles.paginationError} role="alert">
                  {tCommon("loadMoreError")}
                </p>
              ) : null}
              <Button
                variant="secondary"
                onClick={() => void query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
              >
                {query.isFetchingNextPage
                  ? tCommon("loadingMore")
                  : query.isFetchNextPageError
                    ? tCommon("retry")
                    : tCommon("loadMore")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
