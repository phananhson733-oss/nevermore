"use client";

/**
 * Evidence-led 30 / 60 / 90 plan. The API owns deterministic ordering: this
 * view only partitions the returned sequence by `roadmapLane` and never
 * invents scores, owners, dates, or dependencies. Action details are shown in
 * a modal drawer; manual overrides retain the required reason and revision CAS.
 */

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  FileSearch,
  Flame,
  Layers3,
  Link2,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  Field,
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
  mergeFindingPages,
  useProjectFindings,
  type Evidence,
  type Finding,
} from "@/lib/api/hooks-diagnosis";
import {
  useProjectActions,
  useUpdateAction,
  type Action,
  type ActionStatus,
  type PriorityBand,
  type RoadmapLane,
} from "@/lib/api/hooks-plan";
import { ProblemNotice, ProblemState } from "../_problem-display";
import { growthMapFindingRoute } from "../_compatibility-route";
import { allowedActionStatusTargets } from "../_action-status-transitions";
import { evidenceProviderLabel } from "./_provider-label";
import styles from "./plan.module.css";

const LANES = ["now", "next", "later"] as const;
type Lane = (typeof LANES)[number];

const LANE_WINDOW_KEY: Record<
  Lane,
  "laneNowWindow" | "laneNextWindow" | "laneLaterWindow"
> = {
  now: "laneNowWindow",
  next: "laneNextWindow",
  later: "laneLaterWindow",
};

const LANE_INDEX: Record<Lane, string> = {
  now: "01",
  next: "02",
  later: "03",
};

const LANE_CLASS: Record<Lane, string | undefined> = {
  now: styles.laneNow,
  next: styles.laneNext,
  later: styles.laneLater,
};

const ACTION_CARD_LANE_CLASS: Record<Lane, string | undefined> = {
  now: styles.actionCardNow,
  next: styles.actionCardNext,
  later: styles.actionCardLater,
};

const PRIORITY_TONE: Record<PriorityBand, StatusTone> = {
  critical: "danger",
  high: "warning",
  medium: "info",
  low: "neutral",
};

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

/** Preserve the server order inside each lane; no client-side re-ranking. */
export function groupActionsByLane(
  actions: readonly Action[],
): Record<Lane, readonly Action[]> {
  return {
    now: actions.filter((action) => action.roadmapLane === "now"),
    next: actions.filter((action) => action.roadmapLane === "next"),
    later: actions.filter((action) => action.roadmapLane === "later"),
  };
}

function uniqueEvidence(evidence: readonly Evidence[]): readonly Evidence[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

// --------------------------------------------------------------- Controls --

interface PlanSelectProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly SelectOption[];
  readonly keepLabel: string;
}

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
  readonly onCancel: () => void;
  readonly onApplied: () => void;
  readonly onConflict: () => void;
}

/**
 * Apply any allowed status / priority / lane subset with a mandatory audit
 * reason. `baseRevision` remains the server-provided optimistic CAS token.
 */
function OverrideForm({
  projectId,
  action,
  onCancel,
  onApplied,
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
    (value) => ({ value, label: tPriority(value) }),
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
      return;
    }

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
      onApplied();
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
    }
  }

  const busy = update.isPending;

  return (
    <form
      id="plan-override-controls"
      className={styles.overrideForm}
      onSubmit={handleSubmit}
      aria-label={`${t("overrideTitle")} — ${action.title}`}
      data-testid="plan-override-form"
    >
      <div className={styles.overrideHead}>
        <span className={styles.sectionKicker}>{t("overrideKicker")}</span>
        <h3 className={styles.overrideTitle}>{t("overrideTitle")}</h3>
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
            keepLabel={`${t("keepUnchanged")} — ${tPriority(action.priorityBand)}`}
          />
        </Field>
        <Field label={t("newLane")}>
          <PlanSelect
            value={laneSel}
            onChange={setLaneSel}
            options={laneOptions}
            keepLabel={`${t("keepUnchanged")} — ${tLane(action.roadmapLane)}`}
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

      <p className={styles.overrideKept}>
        <ShieldCheck aria-hidden="true" size={16} />
        <span>{t("overrideKept")}</span>
      </p>

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
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
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
  readonly action: Action;
  readonly onOpen: (actionId: string) => void;
  readonly showBlockedExplanation?: boolean;
  readonly blockedExplanationId?: string;
}

function ActionCard({
  action,
  onOpen,
  showBlockedExplanation = true,
  blockedExplanationId,
}: ActionCardProps) {
  const t = useTranslations("plan");
  const tStatus = useTranslations("actionStatus");
  const tPriority = useTranslations("priorityBand");
  const isBlocked = action.status === "blocked";
  const ownBlockedExplanationId = `plan-action-${action.id}-blocked`;
  const describedBy = isBlocked
    ? (blockedExplanationId ?? ownBlockedExplanationId)
    : undefined;

  return (
    <article
      className={cx(
        styles.actionCard,
        ACTION_CARD_LANE_CLASS[action.roadmapLane],
        isBlocked && styles.actionCardBlocked,
      )}
      data-testid="plan-action-card"
      data-action-id={action.id}
      data-action-status={action.status}
      data-roadmap-lane={action.roadmapLane}
    >
      <button
        type="button"
        className={styles.actionOpen}
        onClick={() => onOpen(action.id)}
        aria-label={t("openAction", { title: action.title })}
        aria-describedby={describedBy}
      >
        <span className={styles.actionTopline}>
          <StatusPill tone={STATUS_TONE[action.status]}>
            {tStatus(action.status)}
          </StatusPill>
          <span className={styles.actionPriority}>
            {tPriority(action.priorityBand)}
          </span>
        </span>

        <span className={styles.actionTitle}>{action.title}</span>
        <span className={styles.actionDesc}>{action.description}</span>

        {isBlocked && showBlockedExplanation ? (
          <span
            id={ownBlockedExplanationId}
            className={styles.blockedNote}
          >
            <strong>{t("blocked")}</strong>
            <span>{t("blockedExplanation")}</span>
          </span>
        ) : null}

        <span className={styles.actionDeliverable}>
          <span>
            <FileSearch aria-hidden="true" size={16} />
            <span>{action.templateId}</span>
          </span>
        </span>

        <span className={styles.actionFoot}>
          <span>
            <Link2 aria-hidden="true" size={15} />
            {t("linkedFindingCount", { count: 1 })}
          </span>
          <ChevronRight aria-hidden="true" size={17} />
        </span>
      </button>
    </article>
  );
}

// --------------------------------------------------------------- Lane -------

interface LaneColumnProps {
  readonly lane: Lane;
  readonly actions: readonly Action[];
  readonly hasMore: boolean;
  readonly onOpenAction: (actionId: string) => void;
}

function LaneColumn({
  lane,
  actions,
  hasMore,
  onOpenAction,
}: LaneColumnProps) {
  const t = useTranslations("plan");
  const sharesBlockedExplanation =
    !hasMore &&
    actions.length > 1 &&
    actions.every((action) => action.status === "blocked");
  const sharedBlockedExplanationId = `plan-${lane}-blocked-explanation`;

  return (
    <section
      className={cx(styles.lane, LANE_CLASS[lane])}
      aria-label={`${t(`laneTitle.${lane}`)} — ${t(LANE_WINDOW_KEY[lane])}`}
      data-testid={`plan-lane-${lane}`}
    >
      <header className={styles.laneHead}>
        <span className={styles.laneIndex} aria-hidden="true">
          {LANE_INDEX[lane]}
        </span>
        <div className={styles.laneHeadText}>
          <h2 className={styles.laneName}>{t(`laneTitle.${lane}`)}</h2>
          <p className={styles.laneWindow}>
            {t("laneActionCount", { count: actions.length })}
            <span aria-hidden="true"> · </span>
            {t(LANE_WINDOW_KEY[lane])}
            {hasMore ? (
              <span className={styles.lanePartial}>
                {` · ${t("loadedScope")}`}
              </span>
            ) : null}
          </p>
        </div>
      </header>

      {sharesBlockedExplanation ? (
        <p
          id={sharedBlockedExplanationId}
          role="note"
          className={styles.laneBlockedNote}
          data-testid="plan-lane-blocked-note"
        >
          <ShieldCheck aria-hidden="true" size={17} />
          <span>
            <strong>{t("blocked")}</strong>
            {t("blockedExplanation")}
          </span>
        </p>
      ) : null}

      <div
        className={styles.laneBody}
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
              action={action}
              onOpen={onOpenAction}
              showBlockedExplanation={!sharesBlockedExplanation}
              {...(sharesBlockedExplanation
                ? { blockedExplanationId: sharedBlockedExplanationId }
                : {})}
            />
          ))
        )}
      </div>
    </section>
  );
}

// -------------------------------------------------------------- Drawer ------

interface PriorityDimension {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly available: boolean;
  readonly tone: "cobalt" | "mint";
}

function PriorityContext({
  action,
  finding,
  evidenceLoading,
}: {
  readonly action: Action;
  readonly finding: Finding | null;
  readonly evidenceLoading: boolean;
}) {
  const t = useTranslations("plan");
  const tCommon = useTranslations("common");
  const tStatus = useTranslations("actionStatus");
  const tPriority = useTranslations("priorityBand");
  const evidence = finding === null ? [] : uniqueEvidence(finding.evidence);
  const outcomeAvailable = action.expectedOutcome.trim().length > 0;
  const evidenceAvailable = finding !== null;

  const dimensions: readonly PriorityDimension[] = [
    {
      key: "priority",
      label: t("dimension.priority"),
      value: tPriority(action.priorityBand),
      detail: t("dimension.priorityHint"),
      available: true,
      tone: "cobalt",
    },
    {
      key: "lane",
      label: t("dimension.lane"),
      value: t(`laneTitle.${action.roadmapLane}`),
      detail: t("dimension.laneHint"),
      available: true,
      tone: "cobalt",
    },
    {
      key: "status",
      label: t("dimension.status"),
      value: tStatus(action.status),
      detail: t("dimension.statusHint"),
      available: true,
      tone: "cobalt",
    },
    {
      key: "effort",
      label: t("dimension.effort"),
      value: t(`effortValue.${action.effort}`),
      detail: t("dimension.effortHint"),
      available: true,
      tone: "mint",
    },
    {
      key: "risk",
      label: t("dimension.risk"),
      value: t(`riskValue.${action.risk}`),
      detail: t("dimension.riskHint"),
      available: true,
      tone: "mint",
    },
    {
      key: "evidence",
      label: t("dimension.evidence"),
      value: evidenceLoading
        ? tCommon("loading")
        : evidenceAvailable
          ? t("evidenceCount", { count: evidence.length })
          : tCommon("unavailable"),
      detail: evidenceAvailable
        ? t("dimension.evidenceHint")
        : t("dimension.unavailableHint"),
      available: evidenceAvailable,
      tone: "cobalt",
    },
    {
      key: "outcome",
      label: t("dimension.outcome"),
      value: outcomeAvailable ? t("available") : tCommon("unavailable"),
      detail: outcomeAvailable
        ? action.expectedOutcome
        : t("dimension.unavailableHint"),
      available: outcomeAvailable,
      tone: "cobalt",
    },
    {
      key: "dependencies",
      label: t("dimension.dependencies"),
      value: tCommon("unavailable"),
      detail: t("dimension.unavailableHint"),
      available: false,
      tone: "mint",
    },
  ];

  return (
    <section className={styles.prioritySection}>
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.sectionKicker}>
            {t("priorityContextKicker")}
          </span>
          <h3>{t("priorityContextTitle")}</h3>
          <p>{t("priorityContextCopy")}</p>
        </div>
        <ShieldCheck aria-hidden="true" size={21} />
      </div>

      <div className={styles.priorityGrid} data-testid="plan-priority-grid">
        {dimensions.map((dimension) => (
          <article
            key={dimension.key}
            className={cx(
              styles.dimension,
              dimension.tone === "mint" && styles.dimensionMint,
              !dimension.available && styles.dimensionUnavailable,
            )}
            data-available={dimension.available ? "true" : "false"}
          >
            <div className={styles.dimensionHead}>
              <span>{dimension.label}</span>
              <strong>{dimension.value}</strong>
            </div>
            <p>{dimension.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function FindingRelation({
  projectId,
  action,
  finding,
  findingQuery,
}: {
  readonly projectId: string;
  readonly action: Action;
  readonly finding: Finding | null;
  readonly findingQuery: ReturnType<typeof useProjectFindings>;
}) {
  const t = useTranslations("plan");
  const tCommon = useTranslations("common");
  const tPriority = useTranslations("priorityBand");
  const tDomain = useTranslations("domain");
  const tProvider = useTranslations("provider");
  const evidence = useMemo(
    () => (finding === null ? [] : uniqueEvidence(finding.evidence)),
    [finding],
  );
  const findingUrl =
    finding?.subjectRefs.find(
      (subject) => subject.type === "url" && subject.value.trim().length > 0,
    )?.value ?? null;

  return (
    <section className={styles.findingSection}>
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.sectionKicker}>
            {t("linkedFindingsKicker")}
          </span>
          <h3>{t("linkedFindingsTitle")}</h3>
        </div>
        <Link2 aria-hidden="true" size={21} />
      </div>

      {findingQuery.isLoading ? (
        <div className={styles.findingState} role="status">
          <Spinner size="sm" label={tCommon("loading")} />
          <span>{t("findingLoading")}</span>
        </div>
      ) : findingQuery.isError && findingQuery.data === undefined ? (
        <div className={styles.findingError}>
          <ProblemNotice
            error={findingQuery.error}
            message={t("findingReadError")}
            compact
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void findingQuery.refetch()}
          >
            {tCommon("retry")}
          </Button>
        </div>
      ) : finding !== null ? (
        <article className={styles.findingCard}>
          <header className={styles.findingHead}>
            <div>
              <span className={styles.findingRule}>
                {`${tDomain(finding.domain)} · ${finding.ruleId}`}
              </span>
              <h4>{finding.summary}</h4>
            </div>
            <div className={styles.findingPills}>
              <StatusPill tone={PRIORITY_TONE[finding.severity]}>
                {`${t("severityLabel")}: ${tPriority(finding.severity)}`}
              </StatusPill>
              <Badge>{`${t("confidenceLabel")}: ${t(`confidence.${finding.confidence}`)}`}</Badge>
            </div>
          </header>

          <div className={styles.evidenceHead}>
            <strong>{t("evidenceTitle")}</strong>
            <span>{t("evidenceCount", { count: evidence.length })}</span>
          </div>
          {evidence.length > 0 ? (
            <ul className={styles.evidenceList}>
              {evidence.slice(0, 3).map((item) => {
                const provider = evidenceProviderLabel(
                  item.sourceProvider,
                  tProvider,
                  tCommon("unavailable"),
                );

                return (
                  <li key={item.id}>
                    <span className={styles.evidenceGrade}>{item.grade}</span>
                    <div>
                      <p>{item.claim}</p>
                      <span>{`${provider} · ${t(`evidenceAvailability.${item.availability}`)}`}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.evidenceEmpty}>{t("noEvidence")}</p>
          )}
          {evidence.length > 3 ? (
            <p className={styles.evidenceMore}>
              {t("evidenceMore", { count: evidence.length - 3 })}
            </p>
          ) : null}

          <Link
            href={growthMapFindingRoute(projectId, finding.id, findingUrl)}
            className={styles.findingLink}
          >
            {t("openDiagnosis")}
            <ArrowUpRight aria-hidden="true" size={16} />
          </Link>
        </article>
      ) : (
        <div className={styles.findingUnavailable}>
          <FileSearch aria-hidden="true" size={20} />
          <div>
            <strong>
              {findingQuery.hasNextPage
                ? t("findingOutsideLoaded")
                : t("findingUnavailable")}
            </strong>
            <code>{action.findingId}</code>
            {findingQuery.isFetchNextPageError ? (
              <p className={styles.findingPaginationError} role="alert">
                {tCommon("loadMoreError")}
              </p>
            ) : null}
          </div>
          {findingQuery.hasNextPage ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void findingQuery.fetchNextPage()}
              disabled={findingQuery.isFetchingNextPage}
            >
              {findingQuery.isFetchingNextPage
                ? tCommon("loadingMore")
                : findingQuery.isFetchNextPageError
                  ? tCommon("retry")
                  : t("loadRelatedFinding")}
            </Button>
          ) : (
            <Link
              href={`/p/${projectId}/growth-map?object=pages`}
              className={styles.findingLink}
            >
              {t("openDiagnosis")}
              <ArrowUpRight aria-hidden="true" size={16} />
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

function ActionDrawer({
  projectId,
  action,
  onClose,
  onConflict,
}: {
  readonly projectId: string;
  readonly action: Action;
  readonly onClose: () => void;
  readonly onConflict: () => void;
}) {
  const t = useTranslations("plan");
  const tCommon = useTranslations("common");
  const tStatus = useTranslations("actionStatus");
  const tPriority = useTranslations("priorityBand");
  const findingQuery = useProjectFindings(projectId);
  const findingEnvelope = mergeFindingPages(findingQuery.data);
  const finding =
    findingEnvelope?.data.find((item) => item.id === action.findingId) ?? null;
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  function trapFocus(event: ReactKeyboardEvent<HTMLElement>): void {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      className={styles.drawerBackdrop}
      data-testid="plan-action-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={drawerRef}
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-action-drawer-title"
        aria-describedby="plan-action-drawer-description"
        onKeyDown={trapFocus}
        data-testid="plan-action-drawer"
      >
        <header className={styles.drawerHead}>
          <div className={styles.drawerEyebrow}>
            <span>{t("detailKicker")}</span>
            <StatusPill tone={STATUS_TONE[action.status]}>
              {tStatus(action.status)}
            </StatusPill>
          </div>
          <h2 id="plan-action-drawer-title">{action.title}</h2>
          <p id="plan-action-drawer-description">{action.description}</p>
          <button
            ref={closeButtonRef}
            type="button"
            className={styles.drawerClose}
            onClick={onClose}
            aria-label={tCommon("close")}
          >
            <X aria-hidden="true" size={21} />
          </button>
        </header>

        <dl className={styles.drawerSummary}>
          <div>
            <dt>{t("summaryPriority")}</dt>
            <dd className={styles.drawerPriority}>
              {tPriority(action.priorityBand)}
            </dd>
          </div>
          <div>
            <dt>{t("summaryLane")}</dt>
            <dd>
              <CalendarRange aria-hidden="true" size={17} />
              {t(`laneTitle.${action.roadmapLane}`)}
            </dd>
          </div>
          <div>
            <dt>{t("summaryFinding")}</dt>
            <dd>
              <Link2 aria-hidden="true" size={17} />
              {t("linkedFindingCount", { count: 1 })}
            </dd>
          </div>
        </dl>

        <div className={styles.drawerBody}>
          <PriorityContext
            action={action}
            finding={finding}
            evidenceLoading={findingQuery.isLoading}
          />

          <section className={styles.outcomeSection}>
            <span className={styles.sectionKicker}>{t("outcomeKicker")}</span>
            <h3>{t("expectedOutcome")}</h3>
            <p>
              {action.expectedOutcome.trim().length > 0
                ? action.expectedOutcome
                : tCommon("unavailable")}
            </p>
          </section>

          <FindingRelation
            projectId={projectId}
            action={action}
            finding={finding}
            findingQuery={findingQuery}
          />

          {editing ? (
            <OverrideForm
              projectId={projectId}
              action={action}
              onCancel={() => setEditing(false)}
              onApplied={onClose}
              onConflict={onConflict}
            />
          ) : null}
        </div>

        <footer className={styles.drawerFoot}>
          <p>
            <ShieldCheck aria-hidden="true" size={16} />
            <span>{t("drawerAudit")}</span>
          </p>
          <div>
            <Button
              variant="secondary"
              onClick={() => setEditing((value) => !value)}
              aria-expanded={editing}
              aria-controls="plan-override-controls"
            >
              <SlidersHorizontal aria-hidden="true" size={17} />
              {editing ? t("hideAdjustment") : t("override")}
            </Button>
            <Link
              href={`/p/${projectId}/studio`}
              className={styles.primaryLink}
            >
              {t("openStudio")}
              <ArrowRight aria-hidden="true" size={17} />
            </Link>
          </div>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}

// --------------------------------------------------------------- Screen -----

export function PlanClient({ projectId }: { readonly projectId: string }) {
  const t = useTranslations("plan");
  const tCommon = useTranslations("common");
  const query = useProjectActions(projectId);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const onConflict = useCallback(() => {
    void query.refetch();
  }, [query.refetch]);
  const closeDrawer = useCallback(() => setSelectedActionId(null), []);

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
  const grouped = groupActionsByLane(actions);
  const highPriorityCount = actions.filter(
    (action) =>
      action.priorityBand === "critical" || action.priorityBand === "high",
  ).length;
  const inDeliveryCount = actions.filter(
    (action) => action.status === "in_progress" || action.status === "done",
  ).length;
  const selectedAction =
    selectedActionId === null
      ? null
      : (actions.find((action) => action.id === selectedActionId) ?? null);
  return (
    <>
      <div className={styles.page}>
        <header className={styles.hero}>
          <div className={styles.heroText}>
            <div className={styles.heroKickers}>
              <span className="sf-eyebrow">{t("kicker")}</span>
              {actions.length > 0 ? (
                <StatusPill tone="success">{t("heroBadge")}</StatusPill>
              ) : null}
            </div>
            <h1 className={styles.title}>{t("title")}</h1>
            <p className={styles.subtitle}>
              {t("subtitle", {
                count: actions.length,
                suffix: query.hasNextPage ? "+" : "",
              })}
            </p>
          </div>
          <div className={styles.heroActions}>
            <Link
              href={`/p/${projectId}/growth-map?object=pages`}
              className={styles.secondaryLink}
            >
              <ArrowLeft aria-hidden="true" size={17} />
              {t("backToDiagnosis")}
            </Link>
            <Link
              href={`/p/${projectId}/studio`}
              className={styles.primaryLink}
            >
              {t("openStudio")}
              <ArrowRight aria-hidden="true" size={17} />
            </Link>
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
                  <Layers3 aria-hidden="true" size={19} />
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
                <span className={cx(styles.summaryIcon, styles.summaryIconMint)}>
                  <CheckCircle2 aria-hidden="true" size={19} />
                </span>
                <span className={styles.summaryMetric}>{inDeliveryCount}</span>
                <div className={styles.summaryText}>
                  <span className={styles.summaryLabel}>
                    {t("summaryInDelivery")}
                  </span>
                  <p className={styles.summaryHint}>
                    {query.hasNextPage
                      ? t("summaryLoadedHint")
                      : t("summaryInDeliveryHint")}
                  </p>
                </div>
              </article>
              <article className={styles.summaryCard}>
                <span className={cx(styles.summaryIcon, styles.summaryIconAmber)}>
                  <Flame aria-hidden="true" size={19} />
                </span>
                <span className={styles.summaryMetric}>{highPriorityCount}</span>
                <div className={styles.summaryText}>
                  <span className={styles.summaryLabel}>
                    {t("summaryHighPriority")}
                  </span>
                  <p className={styles.summaryHint}>
                    {query.hasNextPage
                      ? t("summaryLoadedHint")
                      : t("summaryHighPriorityHint")}
                  </p>
                </div>
              </article>
              <article className={styles.methodCard}>
                <span className={styles.methodIcon}>
                  <ShieldCheck aria-hidden="true" size={20} />
                </span>
                <div>
                  <span className={styles.methodTitle}>{t("methodTitle")}</span>
                  <p className={styles.methodCopy}>{t("methodCopy")}</p>
                </div>
              </article>
            </section>

            <div
              className={styles.board}
              data-testid="plan-board"
              data-lane-count={LANES.length}
              data-populated-lane-count={LANES.filter(
                (lane) => grouped[lane].length > 0,
              ).length}
            >
              {LANES.map((lane) => (
                <LaneColumn
                  key={lane}
                  lane={lane}
                  actions={grouped[lane]}
                  hasMore={query.hasNextPage}
                  onOpenAction={setSelectedActionId}
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

            <footer className={styles.planFootnote}>
              <ShieldCheck aria-hidden="true" size={16} />
              <span>{t("planFootnote")}</span>
            </footer>
          </>
        )}
      </div>

      {selectedAction !== null ? (
        <ActionDrawer
          projectId={projectId}
          action={selectedAction}
          onClose={closeDrawer}
          onConflict={onConflict}
        />
      ) : null}
    </>
  );
}
