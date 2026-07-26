"use client";

/**
 * Studio (execution artifacts) client view — spec §4.2, §10.1, §10.3. Operators
 * generate the three artifact types from confirmed plan actions, poll the async
 * run, then edit an immutable revision chain and promote a validated draft to
 * `ready`. TanStack Query owns server-state (spec §3.2).
 *
 * Safety: model output is untrusted and is ALWAYS rendered as text (a `<pre>` or
 * an editable `<textarea>`) — never injected as HTML. `status` is conveyed by a
 * text label, never color alone (spec §4.4). Concurrency rides on `baseRevision`
 * (409 `STALE_REVISION` → refetch + inform); `ready` needs an empty
 * `validationErrors` set (422 `ARTIFACT_VALIDATION_FAILED` → surface the errors).
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Bcp47Locale, MAX_ARTIFACT_CONTENT_CHARS } from "@sf/contracts";
import {
  Clock3,
  CircleAlert,
  CircleCheckBig,
  ClipboardList,
  FileText,
  Languages,
  Link2,
  Newspaper,
  ShieldCheck,
  Sparkles,
  SquarePen,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Panel,
  Spinner,
  StatusPill,
  TextInput,
  TextArea,
  cx,
  useFieldControl,
  type StatusTone,
} from "@/components/ui";
import { ApiError, useProject } from "@/lib/api";
import type { Project } from "@/lib/api";
import {
  COMPLETE_CURSOR_MAX_PAGES,
  uniqueCursorItems,
} from "@/lib/api/cursor-pages";
import {
  expectedArtifactType,
  isTerminalRun,
  useCreateArtifact,
  useProjectActions,
  useProjectArtifacts,
  useProjectRun,
  useUpdateArtifact,
} from "@/lib/api/hooks-studio";
import type {
  Artifact,
  ArtifactAction,
  ArtifactContent,
  ArtifactStatus,
  ArtifactType,
  AsyncRun,
  ContentFormat,
  GenerationMode,
  RunStatus,
  ValidationState,
} from "@/lib/api/hooks-studio";
import { ProblemNotice, ProblemState } from "../_problem-display";
import { studioRunQueryOutcome } from "../_frontend-error-state.ts";
import {
  projectHistoryPosition,
  projectHistoryTraversalDelta,
} from "../_project-history-position.ts";
import {
  activeGenerationRecoveryReleased,
  executionLocationUrl,
  executionTargetAfterQueue,
  executionUrlWithTarget,
  parseExecutionDeepLink,
  queuedActionBlocksGeneration,
  queuedActionTargetAfterQueue,
  queuedActionTargetAfterRefresh,
  queuedActionTargetAfterTerminal,
  recoveryAttemptCanCommit,
  recoveryOwnsExecutionTarget,
  resolveActiveGenerationRecovery,
  resolveQueuedActionProjection,
  resolveExecutionDeepLink,
  type ExecutionDeepLink,
  type ExecutionDeepLinkResolution,
  type QueuedActionTarget,
} from "../execution/_execution-deep-link.ts";
import { claimLabelKey } from "../execution/_qa-view.ts";
import {
  canDiscardArtifactChanges,
  isArtifactEditorDirty,
  markReadyBlock,
  shouldConfirmArtifactNavigation,
} from "./_artifact-editor-state.ts";
import styles from "./studio.module.css";

// ----------------------------------------------------------- Tone helpers ----

/**
 * The types an operator may ask for.
 *
 * `english_blog_draft` is deliberately absent: it is minted only by the Content
 * Shadow worker from a frozen brief revision, and offering it in a generate form
 * would create a second, unfrozen way to produce one.
 */
const ARTIFACT_TYPES: readonly ArtifactType[] = [
  "content_brief",
  "metadata_rewrite",
  "technical_ticket",
];

/**
 * Every type the queue can DISPLAY, in canonical order.
 *
 * Wider than the creatable list on purpose: a deliverable this screen cannot
 * name is a deliverable a customer meets as a crash, and a Content Shadow draft
 * is a real deliverable of the project whoever made it.
 */
const ARTIFACT_TYPE_ORDER: readonly ArtifactType[] = [
  ...ARTIFACT_TYPES,
  "english_blog_draft",
];

/** Per-type lucide glyph — a quiet visual anchor on cards and group heads. */
const ARTIFACT_TYPE_ICON: Record<ArtifactType, LucideIcon> = {
  content_brief: FileText,
  metadata_rewrite: SquarePen,
  technical_ticket: ClipboardList,
  english_blog_draft: Newspaper,
};

/**
 * The type filter chips, in the queue's own canonical order.
 *
 * `all` leads, then `ARTIFACT_TYPE_ORDER` — the same order the queue sorts by,
 * so a chip and the rows it reveals never disagree about where a type sits.
 */
const ARTIFACT_FILTERS = ["all", ...ARTIFACT_TYPE_ORDER] as const;

type ArtifactFilter = (typeof ARTIFACT_FILTERS)[number];

const GENERATION_MODES: readonly GenerationMode[] = [
  "template",
  "structured_llm",
];

function artifactGenerationKey(
  actionId: string,
  artifactType: ArtifactType,
): string {
  return `${actionId}:${artifactType}`;
}

function executionDeepLinkKey(deepLink: ExecutionDeepLink): string {
  switch (deepLink.kind) {
    case "none":
      return "none";
    case "invalid":
      return `invalid:${deepLink.invalidKeys.join(",")}`;
    case "target":
      return `target:${deepLink.actionId ?? ""}:${deepLink.artifactId ?? ""}`;
  }
}

function executionDeepLinkResolutionKey(
  resolution: ExecutionDeepLinkResolution,
): string {
  switch (resolution.kind) {
    case "pending":
      return `pending:${resolution.resource}`;
    case "artifact":
      return `artifact:${resolution.artifactId}`;
    case "action":
      return `action:${resolution.actionId}`;
    case "ambiguous":
      return `ambiguous:${resolution.actionId}`;
    case "default":
    case "invalid":
    case "not_found":
      return resolution.kind;
  }
}

type ExecutionTargetStateKind =
  | "loading"
  | "ambiguous"
  | "unavailable"
  | "queued";

function executionQueryValue(
  searchParams: { readonly getAll: (name: string) => readonly string[] },
  key: "actionId" | "artifactId",
): string | readonly string[] | undefined {
  const values = searchParams.getAll(key);
  if (values.length === 0) return undefined;
  return values.length === 1 ? values[0] : values;
}

interface ActiveGenerationRecovery {
  readonly key: string;
  readonly actionId: string;
  readonly artifactType: ArtifactType;
  readonly refreshing: boolean;
}

function artifactStatusTone(status: ArtifactStatus): StatusTone {
  switch (status) {
    case "ready":
      return "success";
    case "draft":
      return "warning";
    case "failed":
      return "danger";
    case "generating":
      return "info";
    default:
      return "neutral";
  }
}

function validationTone(state: ValidationState): StatusTone {
  switch (state) {
    case "valid":
      return "success";
    case "invalid":
      return "danger";
    default:
      return "neutral";
  }
}

function runTone(status: RunStatus): StatusTone {
  switch (status) {
    case "completed":
      return "success";
    case "partial":
      return "warning";
    case "failed":
    case "cancelled":
      return "danger";
    default:
      return "info";
  }
}

// --------------------------------------------------------- Content helpers ----

/** Render any revision content as text (JSON is pretty-printed). Never HTML. */
function contentToText(content: ArtifactContent): string {
  return typeof content === "string"
    ? content
    : JSON.stringify(content, null, 2);
}

interface MetadataField {
  readonly key: string;
  readonly value: string;
}

/** Flatten a JSON-object revision into displayable key/value rows. */
function metadataFields(content: ArtifactContent): readonly MetadataField[] {
  if (typeof content === "string") return [];
  return Object.entries(content).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value, null, 2),
  }));
}

type ParsedContent =
  | { readonly ok: true; readonly content: ArtifactContent }
  | { readonly ok: false };

/** Parse edited text back into content: JSON must be a plain object. */
function parseEditedContent(
  text: string,
  format: ContentFormat,
): ParsedContent {
  if (format !== "json") return { ok: true, content: text };
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return { ok: true, content: parsed as Record<string, unknown> };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * Order the queue by type without cutting it into per-type sections.
 *
 * The queue used to be N headed `<section>`s, one per type. That made the type
 * a piece of page structure a reader had to re-orient inside, and it meant the
 * count a reader saw ("3") was a count of one section rather than of the work.
 * The queue is now ONE list: type moves to the chip row above it and to the
 * badge already on each row, and this function only decides the order. Sort is
 * stable, so the server's ordering survives inside each type; an artifact of a
 * type this build does not know is sorted last rather than dropped, because a
 * deliverable the queue silently omits is worse than one it lists plainly.
 */
function orderByType(artifacts: readonly Artifact[]): readonly Artifact[] {
  const rank = new Map(
    ARTIFACT_TYPE_ORDER.map((type, index) => [type, index] as const),
  );
  const unknown = ARTIFACT_TYPE_ORDER.length;
  return [...artifacts].sort(
    (left, right) =>
      (rank.get(left.artifactType) ?? unknown) -
      (rank.get(right.artifactType) ?? unknown),
  );
}

/** The rows a given chip reveals. `all` reveals the whole queue. */
function artifactsForFilter(
  artifacts: readonly Artifact[],
  filter: ArtifactFilter,
): readonly Artifact[] {
  return filter === "all"
    ? artifacts
    : artifacts.filter((artifact) => artifact.artifactType === filter);
}

/**
 * Guard browser unloads and in-app anchor navigation while this mounted editor
 * owns unsaved state. This is intentionally local to Studio and independent of
 * the Context editor's browser-local navigation bridge.
 */
function useUnsavedArtifactNavigationGuard(
  dirty: boolean,
  confirmationMessage: string,
  discardChanges: () => void,
): void {
  useLayoutEffect(() => {
    if (!dirty) return;
    const guardedUrl = window.location.href;
    const guardedState: unknown = window.history.state;
    const guardedPosition = projectHistoryPosition(window.history.state);
    const guardedNavigationIndex = browserNavigationIndex();
    let restoringTraversal = false;
    let guardActive = true;

    function beforeUnload(event: BeforeUnloadEvent): void {
      if (!guardActive) return;
      event.preventDefault();
      event.returnValue = "";
    }

    function documentClick(event: MouseEvent): void {
      if (
        !guardActive ||
        event.defaultPrevented ||
        !(event.target instanceof Element)
      ) {
        return;
      }
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (anchor === null) return;

      const current = new URL(window.location.href);
      const destination = new URL(anchor.href, current);
      const sameDocument =
        destination.origin === current.origin &&
        destination.pathname === current.pathname &&
        destination.search === current.search;
      const internalNavigation = destination.origin === current.origin;
      const target = anchor.getAttribute("target");
      const modified =
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;

      if (
        !shouldConfirmArtifactNavigation({
          dirty,
          willLeaveEditor: internalNavigation && !sameDocument,
          button: event.button,
          modified,
          opensNewContext:
            target !== null && target !== "" && target !== "_self",
          download: anchor.hasAttribute("download"),
        })
      ) {
        return;
      }
      if (window.confirm(confirmationMessage)) {
        guardActive = false;
        discardChanges();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }

    function popState(event: PopStateEvent): void {
      if (!guardActive) return;
      if (restoringTraversal) {
        restoringTraversal = false;
        return;
      }
      const delta = projectHistoryTraversalDelta(
        guardedPosition,
        event.state,
        guardedNavigationIndex,
        browserNavigationIndex(),
      );
      if (delta === 0) {
        return;
      }
      if (delta === null) {
        // Older browsers may expose neither Navigation API indices nor a stamp
        // on the entry that predates the project shell. Never interpret that
        // uncertainty as permission to discard edits. If the operator cancels,
        // suppress downstream router listeners and recreate the guarded entry
        // from its exact Next history state without reloading the document.
        if (window.confirm(confirmationMessage)) {
          guardActive = false;
          discardChanges();
          return;
        }
        event.stopImmediatePropagation();
        window.history.pushState(guardedState, "", guardedUrl);
        return;
      }
      if (window.confirm(confirmationMessage)) {
        guardActive = false;
        discardChanges();
        return;
      }

      // popstate itself is not cancelable. Stop Next's restore handler, then
      // traverse the exact inverse delta. The restoration event is allowed
      // through so router state and URL settle back on the guarded entry.
      event.stopImmediatePropagation();
      restoringTraversal = true;
      window.history.go(-delta);
    }

    function navigate(event: Event): void {
      if (!guardActive) return;
      const navigationEvent = event as BrowserNavigateEvent;
      if (
        navigationEvent.navigationType !== "traverse" ||
        !navigationEvent.destination.sameDocument
      ) {
        return;
      }
      if (window.confirm(confirmationMessage)) {
        guardActive = false;
        discardChanges();
        return;
      }
      if (event.cancelable) event.preventDefault();
    }

    const navigation = browserNavigation();
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", popState, true);
    navigation?.addEventListener("navigate", navigate);
    document.addEventListener("click", documentClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("popstate", popState, true);
      navigation?.removeEventListener("navigate", navigate);
      document.removeEventListener("click", documentClick, true);
    };
  }, [confirmationMessage, dirty, discardChanges]);
}

interface BrowserNavigateEvent extends Event {
  readonly navigationType: string;
  readonly destination: {
    readonly sameDocument: boolean;
  };
}

interface BrowserNavigation extends EventTarget {
  readonly currentEntry?: {
    readonly index: number;
  };
}

function browserNavigation(): BrowserNavigation | undefined {
  return (window as typeof window & { readonly navigation?: BrowserNavigation })
    .navigation;
}

/** Navigation API fallback for entries created before the project shell. */
function browserNavigationIndex(): number | null {
  const navigation = browserNavigation();
  const index = navigation?.currentEntry?.index;
  return typeof index === "number" && index >= 0 ? index : null;
}

// ------------------------------------------------------------- Select --------

interface SelectOption {
  readonly value: string;
  readonly label: string;
}

interface StudioSelectProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly SelectOption[];
}

/** Field-wired native select (mirrors the Context form's control). */
function StudioSelect({ value, onChange, options }: StudioSelectProps) {
  const field = useFieldControl();
  return (
    <select
      className={styles.select}
      id={field?.controlId}
      aria-describedby={field?.describedBy}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

// ----------------------------------------------------------- Run banner ------

function RunBanner({
  run,
  message,
}: {
  readonly run: AsyncRun;
  readonly message: string;
}) {
  const tRun = useTranslations("runState");
  const active = !isTerminalRun(run.status);
  return (
    <Panel
      tone="cobalt"
      padding="md"
      className={styles.banner}
      aria-live="polite"
    >
      <div className={styles.bannerText}>
        {active ? <Spinner size="sm" label={message} /> : null}
        <span className={styles.bannerLabel}>{message}</span>
      </div>
      <StatusPill tone={runTone(run.status)}>{tRun(run.status)}</StatusPill>
    </Panel>
  );
}

/**
 * One independent observer per active artifact run. Keeping the hook in a keyed
 * child lets Studio poll every concurrent run without changing hook order when
 * artifacts are added or settle.
 */
function ArtifactRunMonitor({
  projectId,
  runId,
  onTerminal,
  onQueryError,
}: {
  readonly projectId: string;
  readonly runId: string;
  readonly onTerminal: (run: AsyncRun) => void;
  readonly onQueryError: (runId: string) => void;
}) {
  const t = useTranslations("studio");
  const query = useProjectRun(projectId, runId);
  const outcome = studioRunQueryOutcome(query.data, query.error);

  useEffect(() => {
    if (outcome === "terminal" && query.data !== undefined) {
      onTerminal(query.data);
      return;
    }
    if (outcome === "query_error") onQueryError(runId);
  }, [onQueryError, onTerminal, outcome, query.data, runId]);

  if (outcome !== "active" || query.data === undefined) return null;
  return (
    <div data-studio-active-run={runId}>
      <RunBanner run={query.data} message={t("generating")} />
    </div>
  );
}

// --------------------------------------------------------- Artifact card -----

interface ArtifactCardProps {
  readonly artifact: Artifact;
  readonly actionTitle: string | undefined;
  readonly generationActive: boolean;
  readonly selectionBlocked: boolean;
  readonly selected: boolean;
  readonly onOpen: () => void;
  readonly onRegenerate: (() => void) | undefined;
}

function ArtifactCard({
  artifact,
  actionTitle,
  generationActive,
  selectionBlocked,
  selected,
  onOpen,
  onRegenerate,
}: ArtifactCardProps) {
  const t = useTranslations("studio");
  const tRun = useTranslations("runState");
  const generating =
    generationActive ||
    artifact.status === "generating" ||
    artifact.activeRun !== null;
  const displayedStatus = generating ? "generating" : artifact.status;
  const TypeIcon = ARTIFACT_TYPE_ICON[artifact.artifactType];

  return (
    <Card
      padding="sm"
      className={cx(styles.artCard, selected && styles.artCardSelected)}
      data-studio-artifact-id={artifact.id}
      data-studio-artifact-type={artifact.artifactType}
    >
      <div className={styles.artHead}>
        <span className={styles.artTypeWrap}>
          <span className={styles.artIcon}>
            <TypeIcon aria-hidden="true" size={16} />
          </span>
          <span className={styles.artType}>
            {t(`artifactType.${artifact.artifactType}`)}
          </span>
        </span>
        <StatusPill tone={artifactStatusTone(displayedStatus)}>
          {t(`status.${displayedStatus}`)}
        </StatusPill>
      </div>

      {actionTitle !== undefined ? (
        <p className={styles.artAction}>{actionTitle}</p>
      ) : null}

      <div className={styles.artMeta}>
        <span className={styles.metaItem}>
          <span className={styles.metaLabel}>{t("validation")}</span>
          <StatusPill tone={validationTone(artifact.validationState)}>
            {t(`validationState.${artifact.validationState}`)}
          </StatusPill>
        </span>
        <span className={styles.metaItem}>
          <span className={styles.metaLabel}>{t("revision")}</span>
          <Badge>{String(artifact.currentRevision)}</Badge>
        </span>
        <span className={styles.metaItem}>
          <span className={styles.metaLabel}>{t("outputLocale")}</span>
          <Badge>{artifact.outputLocale}</Badge>
        </span>
      </div>

      {generating ? (
        <div className={styles.artRun} aria-live="polite">
          <Spinner size="sm" label={t("generating")} />
          <span className={styles.metaLabel}>
            {artifact.activeRun === null
              ? t("generating")
              : tRun(artifact.activeRun.status)}
          </span>
        </div>
      ) : null}

      <div className={styles.artActions}>
        <Button
          variant="secondary"
          size="sm"
          onClick={onOpen}
          disabled={selectionBlocked}
        >
          {selected ? t("openSelected") : t("open")}
        </Button>
        {onRegenerate !== undefined ? (
          <Button
            variant="text"
            size="sm"
            onClick={onRegenerate}
            disabled={generating}
          >
            {generating ? t("generating") : t("regenerate")}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

// -------------------------------------------------------- Artifact editor ----

interface ArtifactEditorProps {
  readonly projectId: string;
  readonly artifact: Artifact;
  readonly onClose: () => void;
  readonly onDirtyChange: (artifactId: string, dirty: boolean) => void;
}

interface EditorFeedback {
  readonly top: string | null;
  readonly errors: readonly string[];
}

const NO_FEEDBACK: EditorFeedback = { top: null, errors: [] };

/**
 * Detail + editor for one artifact. It remains mounted across revision
 * refetches so a background server update can never erase the local draft.
 */
function ArtifactEditor({
  projectId,
  artifact,
  onClose,
  onDirtyChange,
}: ArtifactEditorProps) {
  const t = useTranslations("studio");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const update = useUpdateArtifact(projectId, artifact.id);

  const current = artifact.current;
  const initialDraft = current ? contentToText(current.content) : "";
  const [draft, setDraft] = useState<string>(initialDraft);
  const [savedDraft, setSavedDraft] = useState<string>(initialDraft);
  const [note, setNote] = useState<string>("");
  const [baseRevision, setBaseRevision] = useState<number>(
    artifact.currentRevision,
  );
  const [feedback, setFeedback] = useState<EditorFeedback>(NO_FEEDBACK);
  const [feedbackProblem, setFeedbackProblem] = useState<unknown | null>(null);
  const awaitingRevision = useRef<number | null>(null);

  const busy = update.isPending;
  const dirty = isArtifactEditorDirty({ draft, note, savedDraft });
  const validationErrors = current?.validationErrors ?? [];
  /**
   * Why "Mark ready" cannot be pressed, decided in one place.
   *
   * `adoption` is the server's own judgement, produced by the module both
   * `draft -> ready` write paths consult. Before it reached the wire this
   * control could only learn the refusal by making the request, which is the
   * opposite of the pattern the review surface established one screen up.
   */
  const readyBlock = markReadyBlock({
    dirty,
    validationState: artifact.validationState,
    validationErrorCount: validationErrors.length,
    adoptionBlocked: artifact.adoption?.blocked === true,
  });
  const readyBlockId =
    readyBlock === "unsaved_edits"
      ? "sf-status-dirty-hint"
      : readyBlock === "validation"
        ? "sf-ready-hint"
        : readyBlock === "adoption_blocked"
          ? "sf-ready-blocked-hint"
          : undefined;
  const isJson = current?.contentFormat === "json";

  const discardLocalChanges = useCallback((): void => {
    setDraft(savedDraft);
    setNote("");
    // Keep the parent selection guard in lock-step with the editor-level
    // browser/navigation guard so a confirmed URL transition is not prompted
    // a second time and can never race an apparently dirty parent state.
    onDirtyChange(artifact.id, false);
  }, [artifact.id, onDirtyChange, savedDraft]);

  useUnsavedArtifactNavigationGuard(
    dirty,
    t("unsavedLeaveWarning"),
    discardLocalChanges,
  );

  useEffect(() => {
    onDirtyChange(artifact.id, dirty);
  }, [artifact.id, dirty, onDirtyChange]);

  useEffect(
    () => () => onDirtyChange(artifact.id, false),
    [artifact.id, onDirtyChange],
  );

  // Adopt a newer server revision only while clean. While dirty, keep both the
  // local text and its original baseRevision so optimistic concurrency fails
  // safely instead of overwriting somebody else's edit.
  useEffect(() => {
    if (
      dirty ||
      current === null ||
      artifact.currentRevision === baseRevision ||
      (awaitingRevision.current !== null &&
        artifact.currentRevision < awaitingRevision.current)
    ) {
      return;
    }
    const nextDraft = contentToText(current.content);
    setDraft(nextDraft);
    setSavedDraft(nextDraft);
    setNote("");
    setBaseRevision(artifact.currentRevision);
    awaitingRevision.current = null;
    setFeedback(NO_FEEDBACK);
    setFeedbackProblem(null);
  }, [artifact.currentRevision, baseRevision, current, dirty]);

  function handleError(error: unknown): void {
    if (error instanceof ApiError) {
      if (error.status === 409 || error.code === "STALE_REVISION") {
        setFeedback({ top: t("staleRevision"), errors: [] });
        setFeedbackProblem(error);
        void queryClient.invalidateQueries({
          queryKey: ["artifacts", projectId],
        });
        return;
      }
      if (error.code === "ARTIFACT_VALIDATION_FAILED" || error.status === 422) {
        setFeedback({ top: t("validationFailed"), errors: [] });
        setFeedbackProblem(error);
        return;
      }
      setFeedback({ top: tCommon("error"), errors: [] });
      setFeedbackProblem(error);
      return;
    }
    setFeedback({ top: tCommon("error"), errors: [] });
    setFeedbackProblem(null);
  }

  async function onSaveRevision(): Promise<void> {
    if (!current) return;
    if (draft.length > MAX_ARTIFACT_CONTENT_CHARS) {
      setFeedback({ top: t("contentTooLong"), errors: [] });
      setFeedbackProblem(null);
      return;
    }
    const parsed = parseEditedContent(draft, current.contentFormat);
    if (!parsed.ok) {
      setFeedback({ top: t("jsonInvalid"), errors: [] });
      setFeedbackProblem(null);
      return;
    }
    setFeedback(NO_FEEDBACK);
    setFeedbackProblem(null);
    const trimmedNote = note.trim();
    try {
      const updated = await update.mutateAsync({
        baseRevision,
        contentFormat: current.contentFormat,
        content: parsed.content,
        ...(trimmedNote.length > 0 ? { editorNote: trimmedNote } : {}),
      });
      const nextSavedDraft = updated.current
        ? contentToText(updated.current.content)
        : contentToText(parsed.content);
      awaitingRevision.current = updated.currentRevision;
      setBaseRevision(updated.currentRevision);
      setSavedDraft(nextSavedDraft);
      // Preserve any keystrokes that happened after submission; otherwise the
      // accepted server projection becomes the clean baseline immediately.
      setDraft((value) => (value === draft ? nextSavedDraft : value));
      setNote((value) => (value === note ? "" : value));
    } catch (error) {
      handleError(error);
    }
  }

  async function onSetStatus(
    status: "draft" | "ready" | "archived",
  ): Promise<void> {
    if (dirty) return;
    setFeedback(NO_FEEDBACK);
    setFeedbackProblem(null);
    try {
      await update.mutateAsync({
        baseRevision,
        status,
      });
    } catch (error) {
      handleError(error);
    }
  }

  return (
    <Panel
      padding="lg"
      className={styles.editor}
      aria-labelledby="sf-editor-title"
      data-studio-editor=""
    >
      <div className={styles.editorHead}>
        <div className={styles.editorHeadText}>
          <span className="sf-eyebrow">
            {t(`artifactType.${artifact.artifactType}`)}
          </span>
          <h2 id="sf-editor-title" className={styles.editorTitle}>
            {t("revisionLabel", { n: artifact.currentRevision })}
          </h2>
        </div>
        <div className={styles.editorHeadMeta}>
          <StatusPill tone={artifactStatusTone(artifact.status)}>
            {t(`status.${artifact.status}`)}
          </StatusPill>
          <StatusPill tone={validationTone(artifact.validationState)}>
            {t(`validationState.${artifact.validationState}`)}
          </StatusPill>
          <span aria-live="polite">
            <StatusPill tone={dirty ? "warning" : "success"}>
              {dirty ? t("editorUnsaved") : t("editorSaved")}
            </StatusPill>
          </span>
          <Button variant="text" size="sm" onClick={onClose}>
            {tCommon("close")}
          </Button>
        </div>
      </div>

      {feedback.top !== null ? (
        feedbackProblem !== null ? (
          <ProblemNotice
            className={styles.alert}
            error={feedbackProblem}
            message={feedback.top}
            compact
          />
        ) : (
          <p className={styles.alert} role="alert">
            {feedback.top}
          </p>
        )
      ) : null}

      {validationErrors.length > 0 || feedback.errors.length > 0 ? (
        <div className={styles.errorsBox}>
          <p className={styles.errorsTitle}>{t("validationErrors")}</p>
          <ul className={styles.errorsList}>
            {[...validationErrors, ...feedback.errors].map((message, index) => (
              <li key={`${index}:${message}`}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {artifact.status === "generating" ? (
        <div className={styles.editorState}>
          <Spinner size="md" label={t("generating")} />
          <span className={styles.metaLabel}>{t("generating")}</span>
        </div>
      ) : current === null ? (
        <p className={styles.editorEmpty}>{t("noRevision")}</p>
      ) : (
        <div className={styles.editorBody}>
          {isJson ? (
            <dl className={styles.fields}>
              {metadataFields(current.content).map((field) => (
                <Fragment key={field.key}>
                  <dt className={styles.fieldKey}>{field.key}</dt>
                  <dd className={styles.fieldVal}>{field.value}</dd>
                </Fragment>
              ))}
            </dl>
          ) : null}

          <Field
            label={t("editContent")}
            help={t("editContentHelp")}
            htmlFor="sf-artifact-content"
          >
            <TextArea
              id="sf-artifact-content"
              className={styles.contentArea}
              rows={isJson ? 12 : 16}
              maxLength={MAX_ARTIFACT_CONTENT_CHARS}
              spellCheck={false}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={busy}
            />
          </Field>

          <Field label={t("editorNote")} htmlFor="sf-artifact-note">
            <TextArea
              id="sf-artifact-note"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={busy}
            />
          </Field>

          <div className={styles.editorActions}>
            <Button
              variant="secondary"
              onClick={() => void onSaveRevision()}
              disabled={busy || !dirty}
            >
              {t("saveRevision")}
            </Button>
            {/*
              There is deliberately no "back to draft" control here.

              `MANUAL_STATUS_TRANSITIONS.ready` is `["archived"]`
              (`apps/web/src/lib/services/artifact-state.ts`), so a
              `ready -> draft` PATCH can only ever return `VERSION_CONFLICT`.
              A button whose sole outcome is a refusal is the simulated-control
              pattern this slice refused to build anywhere else; the real path
              back is the editor above — saving a revision always returns the
              deliverable to `draft` — and the hint below says so.
            */}
            {artifact.status === "ready" ? null : (
              <Button
                variant="primary"
                onClick={() => void onSetStatus("ready")}
                disabled={busy || readyBlock !== null}
                aria-describedby={readyBlockId}
                title={
                  /*
                   * No `title` for the adoption refusal, deliberately. That
                   * reason is stated in place below, and duplicating it into a
                   * hover would teach the reader that hovering is where reasons
                   * live — the habit the review surface refused to build.
                   */
                  readyBlock === "unsaved_edits"
                    ? t("saveBeforeStatusChange")
                    : readyBlock === "validation"
                      ? t("markReadyHint")
                      : undefined
                }
              >
                {t("markReady")}
              </Button>
            )}
            <Button
              variant="text"
              onClick={() => void onSetStatus("archived")}
              disabled={busy || dirty}
              aria-describedby={dirty ? "sf-status-dirty-hint" : undefined}
            >
              {t("archive")}
            </Button>
          </div>
          {readyBlock === "unsaved_edits" ? (
            <p id="sf-status-dirty-hint" className={styles.readyHint}>
              {t("saveBeforeStatusChange")}
            </p>
          ) : artifact.status === "ready" ? (
            /* `ready` is not a dead end. The forward path exists, it is just
               not a status button: editing appends a new immutable revision
               and the service sends the deliverable back to `draft`. Say it,
               so the absent control does not read as an absent path. */
            <p data-studio-ready-path="" className={styles.readyHint}>
              {t("readyEditPath")}
            </p>
          ) : readyBlock === "validation" ? (
            <p id="sf-ready-hint" className={styles.readyHint}>
              {t("markReadyHint")}
            </p>
          ) : readyBlock === "adoption_blocked" ? (
            <AdoptionBlockedHint
              claimIds={artifact.adoption?.blockingClaimIds ?? []}
            />
          ) : null}
        </div>
      )}
    </Panel>
  );
}

/**
 * Why this draft cannot be marked ready, beside the control that cannot be
 * pressed.
 *
 * Every sentence here is a `studio.qa.*` key the Execution screen's blocked
 * block already renders — not a paraphrase of one. Two surfaces describing the
 * same verdict in wording that can drift apart is how a reader ends up
 * believing they are two different problems, and this slice produced that
 * defect more than once by copying a rule instead of sharing it.
 *
 * It reads as "these could not be checked", never as an accusation: the run
 * finished, the draft exists, and what happened is that the gate held back
 * references it has nothing to check them against. It is deliberately NOT
 * painted red or with any danger token — the Task 7/8 ruling that made the
 * Execution blocker amber applies to the same verdict stated here.
 */
function AdoptionBlockedHint({
  claimIds,
}: {
  readonly claimIds: readonly string[];
}) {
  const t = useTranslations("studio.qa");
  return (
    <div
      id="sf-ready-blocked-hint"
      className={styles.readyHint}
      data-studio-ready-blocked=""
    >
      {/* A count is only claimed when the itemised claims were readable. With
          an unreadable claim array the verdict still stands on its own, and
          "0 reference(s)" would be a number nobody measured. */}
      <p className={styles.readyHintLine}>
        {claimIds.length > 0
          ? t("blocker.body", { count: claimIds.length })
          : t("blocker.title")}
      </p>
      {claimIds.length > 0 ? (
        <ul className={styles.readyHintCauses}>
          {claimIds.map((claimId) => {
            const key = claimLabelKey(claimId);
            return (
              <li key={claimId} data-studio-ready-blocked-cause="">
                <span>
                  {key === null ? t("claimUnnamed") : t(`claimLabels.${key}`)}
                </span>
                {/* The state word is DOM text beside the label, exactly as in
                    the Execution blocker block: a claim label names a PROPERTY
                    and the properties are mixed in polarity, so a bare label
                    can read like a pass in a list of reasons a draft is held.
                    Every id here is a blocking check the gate recorded as not
                    passed — that is what the wire field carries — so the state
                    is a fact about the field, not a second judgement. */}
                <span>{` \u00b7 ${t("claimStatus.failed")}`}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className={styles.readyHintLine}>{t("blocker.next")}</p>
    </div>
  );
}

// ----------------------------------------------------- Workspace support ----

function EditorPlaceholder({
  generationUnavailable,
  canGenerate,
  onGenerate,
}: {
  readonly generationUnavailable: boolean;
  readonly canGenerate: boolean;
  readonly onGenerate: () => void;
}) {
  const t = useTranslations("studio");
  return (
    <Panel
      padding="lg"
      className={styles.editorPlaceholder}
      data-studio-editor="empty"
    >
      <span className={styles.placeholderIcon}>
        <Sparkles aria-hidden="true" size={24} />
      </span>
      <span className="sf-eyebrow">{t("editorCanvas")}</span>
      <h2 className={styles.placeholderTitle}>{t("selectArtifactTitle")}</h2>
      <p className={styles.placeholderText}>{t("selectArtifactHint")}</p>
      <Button
        variant="primary"
        onClick={onGenerate}
        disabled={generationUnavailable || !canGenerate}
      >
        {t("generate")}
      </Button>
    </Panel>
  );
}

function ExecutionTargetState({
  kind,
  retryable,
  onRetry,
  onClear,
}: {
  readonly kind: ExecutionTargetStateKind;
  readonly retryable: boolean;
  readonly onRetry: () => void;
  readonly onClear: () => void;
}) {
  const t = useTranslations("studio");
  const title =
    kind === "loading"
      ? t("deepLinkLoading")
      : kind === "ambiguous"
        ? t("deepLinkAmbiguous")
        : kind === "queued"
          ? t("deepLinkQueued")
          : t("deepLinkUnavailable");

  return (
    <Panel
      padding="lg"
      className={styles.editorPlaceholder}
      data-studio-editor={`deep-link-${kind}`}
      data-studio-deep-link-state={kind}
      role={kind === "loading" || kind === "queued" ? "status" : "alert"}
    >
      <span className={styles.placeholderIcon}>
        {kind === "loading" ? (
          <Spinner size="sm" label={title} />
        ) : kind === "queued" ? (
          <Clock3 aria-hidden="true" size={24} />
        ) : (
          <CircleAlert aria-hidden="true" size={24} />
        )}
      </span>
      <span className="sf-eyebrow">{t("editorCanvas")}</span>
      <h2 className={styles.placeholderTitle}>{title}</h2>
      <div className={styles.heroActions}>
        {retryable ? (
          <Button variant="secondary" onClick={onRetry}>
            {t("retryDeepLink")}
          </Button>
        ) : null}
        <Button variant="text" onClick={onClear}>
          {t("clearDeepLink")}
        </Button>
      </div>
    </Panel>
  );
}

function EvidenceRail({
  artifact,
  action,
}: {
  readonly artifact: Artifact | null;
  readonly action: ArtifactAction | undefined;
}) {
  const t = useTranslations("studio");
  const tLane = useTranslations("lane");
  const tBand = useTranslations("priorityBand");

  return (
    <Panel
      padding="none"
      className={styles.evidenceRail}
      data-studio-evidence-rail=""
      aria-labelledby="sf-studio-evidence-title"
    >
      <div className={styles.railHead}>
        <span className="sf-eyebrow">{t("evidenceRailEyebrow")}</span>
        <h2 id="sf-studio-evidence-title" className={styles.railTitle}>
          {t("evidenceRailTitle")}
        </h2>
      </div>

      {artifact === null ? (
        <div className={styles.railEmpty}>
          <Link2 aria-hidden="true" size={19} />
          <p>{t("evidenceRailEmpty")}</p>
        </div>
      ) : (
        <>
          <section className={styles.railSection}>
            <span className={styles.railLabel}>{t("linkedAction")}</span>
            <h3 className={styles.linkedActionTitle}>
              {action?.title ?? t("linkedActionUnavailable")}
            </h3>
            {action !== undefined ? (
              <>
                <p className={styles.linkedActionDescription}>
                  {action.description}
                </p>
                <div className={styles.railBadges}>
                  <Badge tone="accent">{tLane(action.roadmapLane)}</Badge>
                  <Badge>{tBand(action.priorityBand)}</Badge>
                </div>
              </>
            ) : null}
          </section>

          <section className={styles.railSection}>
            <span className={styles.railLabel}>{t("deliveryChecks")}</span>
            <div className={styles.checkList}>
              {/*
                These two rows used to print the raw `actionId` and `findingId`
                UUIDs. A customer cannot do anything with a UUID, and a screen
                that shows one is telling them the binding exists without
                letting them check it. The rows now name what the deliverable is
                bound TO — which is the question the row was always answering.
              */}
              <div className={styles.checkRow}>
                <Link2 aria-hidden="true" size={17} />
                <div>
                  <strong>{t("actionBinding")}</strong>
                  <span>{action?.title ?? t("linkedActionUnavailable")}</span>
                </div>
              </div>
              {action !== undefined ? (
                <div className={styles.checkRow}>
                  <ShieldCheck aria-hidden="true" size={17} />
                  <div>
                    <strong>{t("findingBinding")}</strong>
                    <span>{t("findingBindingConfirmed")}</span>
                  </div>
                </div>
              ) : null}
              <div className={styles.checkRow}>
                <CircleCheckBig aria-hidden="true" size={17} />
                <div>
                  <strong>{t("validation")}</strong>
                  <span>
                    {t(`validationState.${artifact.validationState}`)}
                  </span>
                </div>
              </div>
              <div className={styles.checkRow}>
                <Clock3 aria-hidden="true" size={17} />
                <div>
                  <strong>{t("revision")}</strong>
                  <span>
                    {t("revisionLabel", { n: artifact.currentRevision })}
                  </span>
                </div>
              </div>
              <div className={styles.checkRow}>
                <Languages aria-hidden="true" size={17} />
                <div>
                  <strong>{t("outputLocale")}</strong>
                  <span>{artifact.outputLocale}</span>
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      <div className={styles.railFoot}>
        <ShieldCheck aria-hidden="true" size={17} />
        <p>{t("manualHandoff")}</p>
      </div>
    </Panel>
  );
}

// --------------------------------------------------------- Generate form -----

interface GenerateFormProps {
  readonly projectId: string;
  readonly action: ArtifactAction;
  readonly onQueued: (
    run: AsyncRun,
    artifactId: string | null,
    artifactType: ArtifactType,
  ) => void;
  readonly onAlreadyActive: (artifactType: ArtifactType) => Promise<void>;
  readonly onCancel: () => void;
}

function localeOptions(
  project: Project | undefined,
  actionLocale: string,
): readonly string[] {
  const set = new Set<string>();
  set.add(actionLocale);
  if (project) {
    set.add(project.defaultDeliveryLocale);
    for (const code of project.site.languageCodes) set.add(code);
  }
  if (set.size === 0) set.add("en");
  return [...set];
}

function normalizeStudioOutputLocale(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Bcp47Locale.safeParse(trimmed);
  return parsed.success ? parsed.data : null;
}

/** Deterministic templates have reviewed copy only for these two locales. */
function normalizeTemplateOutputLocale(value: string): "en" | "zh-CN" | null {
  const normalized = value.toLowerCase();
  if (normalized === "en") return "en";
  if (normalized === "zh-cn") return "zh-CN";
  return null;
}

function GenerateForm({
  projectId,
  action,
  onQueued,
  onAlreadyActive,
  onCancel,
}: GenerateFormProps) {
  const t = useTranslations("studio");
  const tCommon = useTranslations("common");
  const create = useCreateArtifact(projectId, action.id);
  // Project metadata is needed only after the operator chooses an action. Keep
  // it out of Studio's first-paint request set; the action locale remains a
  // truthful immediate fallback while the richer project recommendations load.
  const projectQuery = useProject(projectId);
  const project = projectQuery.data;

  const expected = expectedArtifactType(action);
  const locales = localeOptions(project, action.contentLocale);
  const [artifactType, setArtifactType] = useState<ArtifactType>(
    expected ?? "content_brief",
  );
  const [mode, setMode] = useState<GenerationMode>("template");
  const [locale, setLocale] = useState<string>(
    project?.defaultDeliveryLocale ?? action.contentLocale,
  );
  const localeEdited = useRef(false);
  const [instructions, setInstructions] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [problemError, setProblemError] = useState<unknown | null>(null);
  const type = expected ?? artifactType;
  const localeId = "sf-generate-output-locale";
  const localeListId = "sf-generate-output-locale-options";
  const normalizedLocale = normalizeStudioOutputLocale(locale);
  const templateLocale =
    normalizedLocale === null
      ? null
      : normalizeTemplateOutputLocale(normalizedLocale);
  const localeError =
    normalizedLocale === null
      ? t("invalidOutputLocale")
      : mode === "template" && templateLocale === null
        ? t("templateLocaleRequiresStructuredLlm")
        : null;
  const submittedLocale =
    mode === "template" ? templateLocale : normalizedLocale;

  useEffect(() => {
    if (project !== undefined && !localeEdited.current) {
      setLocale(project.defaultDeliveryLocale);
    }
  }, [project]);

  async function onSubmit(): Promise<void> {
    setError(null);
    setProblemError(null);
    const trimmed = instructions.trim();
    if (localeError !== null || submittedLocale === null) return;
    try {
      const data = await create.mutateAsync({
        artifactType: type,
        generationMode: mode,
        outputLocale: submittedLocale,
        ...(trimmed.length > 0 ? { operatorInstructions: trimmed } : {}),
      });
      const artifactId =
        data.resourceRef?.type === "artifact" ? data.resourceRef.id : null;
      onQueued(data.run, artifactId, type);
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.code === "RUN_ALREADY_ACTIVE") {
          // The server exposes the winning run only as a Location response
          // header, while ApiError intentionally carries the problem body. Do
          // not infer an id: refresh the canonical artifact projection and let
          // the parent adopt its activeRun when it becomes visible.
          await onAlreadyActive(type);
          return;
        }
        setError(tCommon("error"));
        setProblemError(caught);
        return;
      }
      setError(tCommon("error"));
    }
  }

  return (
    <Panel
      padding="lg"
      className={styles.generate}
      aria-labelledby="sf-generate-title"
    >
      <div className={styles.editorHead}>
        <div className={styles.editorHeadText}>
          <span className="sf-eyebrow">{t("generateHeading")}</span>
          <h2 id="sf-generate-title" className={styles.editorTitle}>
            {action.title}
          </h2>
        </div>
        <Button variant="text" size="sm" onClick={onCancel}>
          {tCommon("cancel")}
        </Button>
      </div>

      {error !== null ? (
        problemError !== null ? (
          <ProblemNotice
            className={styles.alert}
            error={problemError}
            message={error}
            compact
          />
        ) : (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        )
      ) : null}

      <div className={styles.formGrid}>
        {expected === null ? (
          <Field label={t("artifactTypeLabel")}>
            <StudioSelect
              value={artifactType}
              onChange={(value) => setArtifactType(value as ArtifactType)}
              options={ARTIFACT_TYPES.map((value) => ({
                value,
                label: t(`artifactType.${value}`),
              }))}
            />
          </Field>
        ) : (
          <Field label={t("artifactTypeLabel")}>
            <div className={styles.staticValue}>
              {t(`artifactType.${expected}`)}
            </div>
          </Field>
        )}

        <Field label={t("generationMode")} help={t("generationModeHelp")}>
          <StudioSelect
            value={mode}
            onChange={(value) => setMode(value as GenerationMode)}
            options={GENERATION_MODES.map((value) => ({
              value,
              label: t(value === "template" ? "template" : "structuredLlm"),
            }))}
          />
        </Field>

        <Field
          label={t("outputLocale")}
          help={t("outputLocaleHelp")}
          error={localeError}
          htmlFor={localeId}
        >
          <TextInput
            id={localeId}
            value={locale}
            list={locales.length > 0 ? localeListId : undefined}
            onChange={(event) => {
              localeEdited.current = true;
              setLocale(event.target.value);
            }}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {locales.length > 0 ? (
            <datalist id={localeListId}>
              {locales.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          ) : null}
        </Field>
      </div>

      <Field
        label={t("operatorInstructions")}
        help={t("operatorInstructionsHelp")}
        htmlFor="sf-operator-instructions"
      >
        <TextArea
          id="sf-operator-instructions"
          rows={3}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
        />
      </Field>

      <div className={styles.editorActions}>
        <Button
          variant="primary"
          onClick={() => void onSubmit()}
          disabled={create.isPending || localeError !== null}
        >
          {create.isPending ? t("generating") : t("generateSubmit")}
        </Button>
        <Button variant="text" onClick={onCancel} disabled={create.isPending}>
          {tCommon("cancel")}
        </Button>
      </div>
    </Panel>
  );
}

// -------------------------------------------------------- Action picker ------

interface ActionPickerProps {
  readonly actions: readonly ArtifactAction[];
  readonly liveKeys: ReadonlySet<string>;
  readonly activeKeys: ReadonlySet<string>;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly loadMoreError: boolean;
  readonly onPick: (action: ArtifactAction) => void;
  readonly onLoadMore: () => void;
  readonly onCancel: () => void;
}

function ActionPicker({
  actions,
  liveKeys,
  activeKeys,
  hasMore,
  loadingMore,
  loadMoreError,
  onPick,
  onLoadMore,
  onCancel,
}: ActionPickerProps) {
  const t = useTranslations("studio");
  const tCommon = useTranslations("common");
  const tLane = useTranslations("lane");
  const tBand = useTranslations("priorityBand");

  return (
    <Panel
      padding="lg"
      className={styles.picker}
      aria-labelledby="sf-picker-title"
    >
      <div className={styles.editorHead}>
        <div className={styles.editorHeadText}>
          <h2 id="sf-picker-title" className={styles.editorTitle}>
            {t("pickAction")}
          </h2>
          <p className={styles.pickerHint}>{t("pickActionHelp")}</p>
        </div>
        <Button variant="text" size="sm" onClick={onCancel}>
          {tCommon("cancel")}
        </Button>
      </div>

      {actions.length === 0 ? (
        <p className={styles.editorEmpty}>
          {hasMore ? t("moreActionsHint") : t("noActions")}
        </p>
      ) : (
        <ul className={styles.pickerList}>
          {actions.map((action) => {
            const type = expectedArtifactType(action);
            const key =
              type === null ? null : artifactGenerationKey(action.id, type);
            const hasLive = key !== null && liveKeys.has(key);
            const active = key !== null && activeKeys.has(key);
            return (
              <li key={action.id} className={styles.pickerRow}>
                <div className={styles.pickerText}>
                  <span className={styles.pickerTitle}>{action.title}</span>
                  <span className={styles.pickerMeta}>
                    {type !== null ? (
                      <Badge tone="accent">{t(`artifactType.${type}`)}</Badge>
                    ) : null}
                    <Badge>{tBand(action.priorityBand)}</Badge>
                    <Badge>{tLane(action.roadmapLane)}</Badge>
                  </span>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onPick(action)}
                  disabled={active}
                >
                  {active
                    ? t("generating")
                    : hasLive
                      ? t("regenerate")
                      : t("generateSubmit")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {hasMore || loadMoreError ? (
        <div className={styles.pagination}>
          {loadMoreError ? (
            <p className={styles.paginationError} role="alert">
              {tCommon("loadMoreError")}
            </p>
          ) : null}
          <Button
            variant="secondary"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore
              ? tCommon("loadingMore")
              : loadMoreError
                ? tCommon("retry")
                : tCommon("loadMore")}
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}

export function StudioClient({
  projectId,
  initialDeepLink,
  afterHero,
}: {
  readonly projectId: string;
  readonly initialDeepLink: ExecutionDeepLink;
  /**
   * Rendered between the page heading and the delivery workspace.
   *
   * The Execution route puts the deliverable's own body here, so the first
   * thing after the heading is the work rather than a queue of links to it.
   * Studio passes nothing and is unchanged.
   */
  readonly afterHero?: ReactNode;
}) {
  const t = useTranslations("studio");
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentExecutionLocation = executionLocationUrl(pathname, searchParams);
  const currentUrlDeepLinkKey = executionDeepLinkKey(
    parseExecutionDeepLink({
      actionId: executionQueryValue(searchParams, "actionId"),
      artifactId: executionQueryValue(searchParams, "artifactId"),
    }),
  );

  const artifactsQuery = useProjectArtifacts(projectId);
  const actionsQuery = useProjectActions(projectId);
  const refetchArtifacts = artifactsQuery.refetch;
  const queryClient = useQueryClient();
  const artifacts = uniqueCursorItems(artifactsQuery.data);
  const actions = uniqueCursorItems(actionsQuery.data);

  const [activeDeepLink, setActiveDeepLink] =
    useState<ExecutionDeepLink>(initialDeepLink);
  const activeDeepLinkRef = useRef<ExecutionDeepLink>(initialDeepLink);
  const latestExecutionSearch = useRef<string>(searchParams.toString());
  latestExecutionSearch.current = searchParams.toString();
  const [artifactProjectionSettlements, setArtifactProjectionSettlements] =
    useState<readonly QueuedActionTarget[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<ArtifactFilter>("all");
  const filterTabsRef = useRef<HTMLDivElement | null>(null);
  const [dirtyArtifactId, setDirtyArtifactId] = useState<string | null>(null);
  const [generateAction, setGenerateAction] = useState<ArtifactAction | null>(
    null,
  );
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [trackedRunIds, setTrackedRunIds] = useState<readonly string[]>([]);
  const [runQueryFailureIds, setRunQueryFailureIds] = useState<
    readonly string[]
  >([]);
  const [terminalRunFailures, setTerminalRunFailures] = useState<
    readonly AsyncRun[]
  >([]);
  // A 202 response precedes the artifact-list projection. Preserve the
  // action/type binding locally so the picker cannot present a second Generate
  // affordance during that window.
  const [localActiveKeysByRun, setLocalActiveKeysByRun] = useState<
    Readonly<Record<string, string>>
  >({});
  // RUN_ALREADY_ACTIVE does not put the winning run id in the problem body.
  // Keep a conservative fence until a refreshed artifact projection reveals it.
  const [activeGenerationRecoveries, setActiveGenerationRecoveries] = useState<
    readonly ActiveGenerationRecovery[]
  >([]);
  const autoSelectedArtifact = useRef<boolean>(false);
  const lastServerDeepLinkKey = useRef<string>(
    executionDeepLinkKey(initialDeepLink),
  );
  const lastServerExecutionLocation = useRef<string>(currentExecutionLocation);
  const acceptedExecutionLocation = useRef<string>(currentExecutionLocation);
  const deepLinkAutoFetchRequestKey = useRef<string | null>(null);
  const recoveryAttemptSequence = useRef<number>(0);
  const recoveryAttemptByKey = useRef<Map<string, number>>(new Map());
  const recoveryProjectRef = useRef<string | null>(null);
  // Runs already observed terminal/error, so a stale artifact list cannot
  // re-seed a settled monitor before the canonical list refetch completes.
  const finishedRuns = useRef<Set<string>>(new Set<string>());

  useLayoutEffect(() => {
    recoveryProjectRef.current = projectId;
    return () => {
      if (recoveryProjectRef.current === projectId) {
        recoveryProjectRef.current = null;
      }
      recoveryAttemptByKey.current.clear();
    };
  }, [projectId]);

  const onEditorDirtyChange = useCallback(
    (artifactId: string, dirty: boolean): void => {
      setDirtyArtifactId((value) => {
        if (dirty) return artifactId;
        return value === artifactId ? null : value;
      });
    },
    [],
  );

  // Resume every projected live run on load/refetch. Locally queued runs remain
  // in this set even before their artifact projection becomes visible.
  useEffect(() => {
    const projectedArtifacts = artifacts.filter(
      (artifact) =>
        artifact.activeRun !== null &&
        !isTerminalRun(artifact.activeRun.status),
    );
    const projected = projectedArtifacts.flatMap((artifact) =>
      artifact.activeRun !== null &&
      !finishedRuns.current.has(artifact.activeRun.id)
        ? [artifact.activeRun.id]
        : [],
    );
    setTrackedRunIds((current) => {
      const next = [...current];
      for (const runId of projected) {
        if (!next.includes(runId)) next.push(runId);
      }
      return next.length === current.length ? current : next;
    });
  }, [artifacts]);

  const onRunTerminal = useCallback(
    (run: AsyncRun): void => {
      if (finishedRuns.current.has(run.id)) return;
      finishedRuns.current.add(run.id);
      setTrackedRunIds((current) => current.filter((id) => id !== run.id));
      setRunQueryFailureIds((current) => current.filter((id) => id !== run.id));
      setLocalActiveKeysByRun((current) => {
        if (!(run.id in current)) return current;
        return Object.fromEntries(
          Object.entries(current).filter(([id]) => id !== run.id),
        );
      });
      if (run.status !== "completed") {
        setTerminalRunFailures((current) => {
          const withoutRun = current.filter((item) => item.id !== run.id);
          return [...withoutRun, run].slice(-3);
        });
      }
      const terminalStatus = run.status;
      if (
        terminalStatus === "completed" ||
        terminalStatus === "partial" ||
        terminalStatus === "failed" ||
        terminalStatus === "cancelled"
      ) {
        const resultArtifactId =
          run.resultRef?.type === "artifact" ? run.resultRef.id : null;
        setArtifactProjectionSettlements((current) =>
          current.flatMap((settlement) => {
            const next = queuedActionTargetAfterTerminal(settlement, {
              runId: run.id,
              status: terminalStatus,
              resultArtifactId,
            });
            return next === null ? [] : [next];
          }),
        );
      }
      const artifactRefresh = refetchArtifacts();
      const finishArtifactRefresh = (failed: boolean): void => {
        setArtifactProjectionSettlements((current) =>
          current.map(
            (settlement) =>
              queuedActionTargetAfterRefresh(settlement, run.id, failed) ??
              settlement,
          ),
        );
      };
      void artifactRefresh.then(
        (result) => finishArtifactRefresh(result.isError),
        () => finishArtifactRefresh(true),
      );
    },
    [refetchArtifacts],
  );

  const onRunQueryError = useCallback(
    (runId: string): void => {
      if (finishedRuns.current.has(runId)) return;
      finishedRuns.current.add(runId);
      setTrackedRunIds((current) => current.filter((id) => id !== runId));
      setRunQueryFailureIds((current) =>
        current.includes(runId) ? current : [...current, runId],
      );
      void queryClient.invalidateQueries({
        queryKey: ["artifacts", projectId],
        refetchType: "active",
      });
    },
    [projectId, queryClient],
  );

  const artifactsInitialLoading =
    artifactsQuery.isLoading && artifactsQuery.data === undefined;
  const artifactsInitialError =
    artifactsQuery.isError && artifactsQuery.data === undefined;
  const actionsInitialLoading =
    actionsQuery.isLoading && actionsQuery.data === undefined;
  const actionsInitialError =
    actionsQuery.isError && actionsQuery.data === undefined;
  const actionById = new Map(
    actions.map((action) => [action.id, action] as const),
  );
  const eligibleActions = actions.filter(
    (action) => action.status !== "dismissed",
  );
  const generationEligibleActions = eligibleActions.filter(
    (action) =>
      !queuedActionBlocksGeneration(artifactProjectionSettlements, action.id) &&
      !activeGenerationRecoveries.some(
        (recovery) => recovery.actionId === action.id,
      ),
  );
  const settlementKeys = new Set(
    artifactProjectionSettlements.map((settlement) =>
      artifactGenerationKey(
        settlement.actionId,
        settlement.artifactType as ArtifactType,
      ),
    ),
  );
  const recoveryKeys = new Set(
    activeGenerationRecoveries.map((recovery) => recovery.key),
  );
  const recoveryPaginationKey = JSON.stringify([...recoveryKeys].sort());
  const generationFenceKeys = new Set([...settlementKeys, ...recoveryKeys]);
  const canonicalLiveKeys = new Set(
    artifacts
      .filter((a) => a.status !== "archived")
      .map((a) => artifactGenerationKey(a.actionId, a.artifactType)),
  );
  const liveKeys = new Set([
    ...canonicalLiveKeys,
    ...Object.values(localActiveKeysByRun),
    ...recoveryKeys,
    ...settlementKeys,
  ]);
  const activeKeys = new Set(
    artifacts
      .filter(
        (artifact) =>
          artifact.status === "generating" || artifact.activeRun !== null,
      )
      .map((artifact) =>
        artifactGenerationKey(artifact.actionId, artifact.artifactType),
      ),
  );
  for (const key of Object.values(localActiveKeysByRun)) activeKeys.add(key);
  const selected = artifacts.find((a) => a.id === selectedId) ?? null;
  const selectedAction =
    selected === null ? undefined : actionById.get(selected.actionId);
  const orderedArtifacts = orderByType(artifacts);
  const queuedArtifacts = artifactsForFilter(orderedArtifacts, typeFilter);
  const readyCount = artifacts.filter((a) => a.status === "ready").length;
  const draftCount = artifacts.filter((a) => a.status === "draft").length;
  const selectedEditorDirty =
    selectedId !== null && dirtyArtifactId === selectedId;
  const generationUnavailable =
    artifactsInitialLoading ||
    artifactsInitialError ||
    actionsInitialLoading ||
    actionsInitialError;
  const activeDeepLinkKey = executionDeepLinkKey(activeDeepLink);
  const initialDeepLinkKey = executionDeepLinkKey(initialDeepLink);
  const artifactsComplete =
    artifactsQuery.data !== undefined && artifactsQuery.hasNextPage === false;
  const actionsComplete =
    actionsQuery.data !== undefined && actionsQuery.hasNextPage === false;
  const deepLinkResolution = resolveExecutionDeepLink(
    activeDeepLink,
    artifacts,
    actions,
    { artifactsComplete, actionsComplete },
  );
  const deepLinkResolutionKey =
    executionDeepLinkResolutionKey(deepLinkResolution);
  const actionTargetFormOpen =
    activeDeepLink.kind === "target" &&
    activeDeepLink.artifactId === null &&
    activeDeepLink.actionId !== null &&
    activeDeepLink.actionId === generateAction?.id;
  const activeDeepLinkArtifact =
    activeDeepLink.kind === "target" && activeDeepLink.artifactId !== null
      ? (artifacts.find(
          (artifact) => artifact.id === activeDeepLink.artifactId,
        ) ?? null)
      : null;
  const activeTargetSettlement =
    activeDeepLink.kind !== "target"
      ? null
      : activeDeepLink.artifactId === null && activeDeepLink.actionId !== null
        ? (artifactProjectionSettlements.find(
            (settlement) => settlement.actionId === activeDeepLink.actionId,
          ) ?? null)
        : activeDeepLinkArtifact === null
          ? null
          : (artifactProjectionSettlements.find(
              (settlement) =>
                settlement.actionId === activeDeepLinkArtifact.actionId &&
                settlement.artifactType === activeDeepLinkArtifact.artifactType,
            ) ?? null);
  const activeTargetRecovery =
    activeDeepLink.kind !== "target"
      ? null
      : activeDeepLink.artifactId === null && activeDeepLink.actionId !== null
        ? (activeGenerationRecoveries.find(
            (recovery) => recovery.actionId === activeDeepLink.actionId,
          ) ?? null)
        : activeDeepLinkArtifact === null
          ? null
          : (activeGenerationRecoveries.find(
              (recovery) =>
                recovery.actionId === activeDeepLinkArtifact.actionId &&
                recovery.artifactType === activeDeepLinkArtifact.artifactType,
            ) ?? null);
  const artifactProjectionIdentities = artifacts.map((artifact) => ({
    id: artifact.id,
    actionId: artifact.actionId,
    artifactType: artifact.artifactType,
    activeRunId: artifact.activeRun?.id ?? null,
  }));
  const artifactSettlementProofs = artifactProjectionSettlements.flatMap(
    (settlement) => {
      const resolution = resolveQueuedActionProjection(
        settlement,
        artifactProjectionIdentities,
      );
      return resolution.kind === "artifact"
        ? [
            {
              runId: settlement.runId,
              actionId: settlement.actionId,
              artifactId: resolution.artifactId,
            },
          ]
        : [];
    },
  );
  const artifactSettlementProofKey = JSON.stringify(artifactSettlementProofs);
  const actionTargetQueued =
    activeTargetSettlement !== null || activeTargetRecovery !== null;
  const deepLinkPendingBlocked =
    deepLinkResolution.kind === "pending" &&
    (deepLinkResolution.resource === "artifacts"
      ? !artifactsQuery.isFetching &&
        (artifactsInitialError ||
          artifactsQuery.isFetchNextPageError ||
          (artifactsQuery.hasNextPage === true &&
            (artifactsQuery.data?.pages.length ?? 0) >=
              COMPLETE_CURSOR_MAX_PAGES))
      : !actionsQuery.isFetching &&
        (actionsInitialError ||
          actionsQuery.isFetchNextPageError ||
          (actionsQuery.hasNextPage === true &&
            (actionsQuery.data?.pages.length ?? 0) >=
              COMPLETE_CURSOR_MAX_PAGES)));
  const deepLinkNoticeKind = (() => {
    if (actionTargetFormOpen) return null;
    if (actionTargetQueued) return "queued" as const;
    if (deepLinkResolution.kind === "ambiguous") return "ambiguous" as const;
    if (
      deepLinkResolution.kind === "invalid" ||
      deepLinkResolution.kind === "not_found" ||
      deepLinkPendingBlocked
    ) {
      return "unavailable" as const;
    }
    if (deepLinkResolution.kind === "pending") return "loading" as const;
    return null;
  })() satisfies ExecutionTargetStateKind | null;
  const deepLinkRetryable =
    activeTargetSettlement !== null
      ? activeTargetSettlement.phase === "settling" &&
        !activeTargetSettlement.refreshing
      : activeTargetRecovery !== null
        ? !activeTargetRecovery.refreshing
        : deepLinkResolution.kind === "pending" &&
          deepLinkPendingBlocked &&
          (deepLinkResolution.resource === "artifacts"
            ? artifactsInitialError || artifactsQuery.isFetchNextPageError
            : actionsInitialError || actionsQuery.isFetchNextPageError);

  useEffect(() => {
    // The URL hook can update before the async server page prop. Only accept a
    // location after both views describe the same target; otherwise a dirty
    // rollback could snapshot the attempted URL instead of the last accepted one.
    if (currentUrlDeepLinkKey !== initialDeepLinkKey) return;
    const selectionChanged =
      lastServerDeepLinkKey.current !== initialDeepLinkKey;
    const locationChanged =
      lastServerExecutionLocation.current !== currentExecutionLocation;
    if (!selectionChanged && !locationChanged) return;
    lastServerDeepLinkKey.current = initialDeepLinkKey;
    lastServerExecutionLocation.current = currentExecutionLocation;
    if (!selectionChanged) {
      acceptedExecutionLocation.current = currentExecutionLocation;
      return;
    }
    const keepsCurrentSelection =
      initialDeepLink.kind === "target" &&
      ((initialDeepLink.artifactId !== null &&
        initialDeepLink.artifactId === selectedId &&
        (initialDeepLink.actionId === null ||
          initialDeepLink.actionId === selected?.actionId)) ||
        (initialDeepLink.artifactId === null &&
          initialDeepLink.actionId !== null &&
          (initialDeepLink.actionId === generateAction?.id ||
            artifactProjectionSettlements.some(
              (settlement) => settlement.actionId === initialDeepLink.actionId,
            ) ||
            activeGenerationRecoveries.some(
              (recovery) => recovery.actionId === initialDeepLink.actionId,
            ))));
    if (keepsCurrentSelection) {
      acceptedExecutionLocation.current = currentExecutionLocation;
      commitActiveDeepLink(initialDeepLink);
      autoSelectedArtifact.current = true;
      return;
    }
    if (selectedEditorDirty && !confirmEditorDiscard()) {
      if (selected !== null) {
        commitActiveDeepLink({
          kind: "target",
          actionId: selected.actionId,
          artifactId: selected.id,
        });
        autoSelectedArtifact.current = true;
        router.replace(acceptedExecutionLocation.current, { scroll: false });
      }
      return;
    }
    acceptedExecutionLocation.current = currentExecutionLocation;
    commitActiveDeepLink(initialDeepLink);
    autoSelectedArtifact.current = true;
    setDirtyArtifactId(null);
    setSelectedId(null);
    setGenerateAction(null);
    setPickerOpen(false);
  }, [
    currentExecutionLocation,
    currentUrlDeepLinkKey,
    artifactProjectionSettlements,
    activeGenerationRecoveries,
    generateAction?.id,
    initialDeepLinkKey,
    selectedEditorDirty,
    selectedId,
  ]);

  useEffect(() => {
    if (
      activeGenerationRecoveries.length > 0 &&
      artifactsQuery.data !== undefined &&
      artifactsQuery.hasNextPage === true
    ) {
      if (
        artifactsQuery.isFetching ||
        artifactsQuery.data.pages.length >= COMPLETE_CURSOR_MAX_PAGES
      ) {
        return;
      }
      const pages = artifactsQuery.data.pages;
      const requestKey = JSON.stringify([
        recoveryPaginationKey,
        "recovery-artifacts",
        pages.length,
        pages.at(-1)?.meta.nextCursor ?? "",
        artifactsQuery.dataUpdatedAt,
      ]);
      if (deepLinkAutoFetchRequestKey.current === requestKey) return;
      deepLinkAutoFetchRequestKey.current = requestKey;
      void artifactsQuery.fetchNextPage();
      return;
    }
    if (
      deepLinkResolution.kind !== "pending" ||
      deepLinkPendingBlocked ||
      actionTargetFormOpen
    ) {
      return;
    }
    if (deepLinkResolution.resource === "artifacts") {
      if (
        artifactsQuery.data === undefined ||
        artifactsQuery.hasNextPage !== true ||
        artifactsQuery.isFetching
      ) {
        return;
      }
      const pages = artifactsQuery.data.pages;
      const requestKey = JSON.stringify([
        activeDeepLinkKey,
        "artifacts",
        pages.length,
        pages.at(-1)?.meta.nextCursor ?? "",
        artifactsQuery.dataUpdatedAt,
      ]);
      if (deepLinkAutoFetchRequestKey.current === requestKey) return;
      deepLinkAutoFetchRequestKey.current = requestKey;
      void artifactsQuery.fetchNextPage();
      return;
    }
    if (
      actionsQuery.data === undefined ||
      actionsQuery.hasNextPage !== true ||
      actionsQuery.isFetching
    ) {
      return;
    }
    const pages = actionsQuery.data.pages;
    const requestKey = JSON.stringify([
      activeDeepLinkKey,
      "actions",
      pages.length,
      pages.at(-1)?.meta.nextCursor ?? "",
      actionsQuery.dataUpdatedAt,
    ]);
    if (deepLinkAutoFetchRequestKey.current === requestKey) return;
    deepLinkAutoFetchRequestKey.current = requestKey;
    void actionsQuery.fetchNextPage();
  }, [
    activeDeepLinkKey,
    activeGenerationRecoveries.length,
    actionTargetFormOpen,
    actionsQuery.data,
    actionsQuery.dataUpdatedAt,
    actionsQuery.fetchNextPage,
    actionsQuery.hasNextPage,
    actionsQuery.isFetching,
    artifactsQuery.data,
    artifactsQuery.dataUpdatedAt,
    artifactsQuery.fetchNextPage,
    artifactsQuery.hasNextPage,
    artifactsQuery.isFetching,
    deepLinkPendingBlocked,
    deepLinkResolutionKey,
    recoveryPaginationKey,
  ]);

  useEffect(() => {
    if (artifactSettlementProofs.length === 0) return;
    const provenRunIds = new Set(
      artifactSettlementProofs.map((proof) => proof.runId),
    );
    setArtifactProjectionSettlements((current) =>
      current.filter((settlement) => !provenRunIds.has(settlement.runId)),
    );
    if (
      activeDeepLink.kind !== "target" ||
      activeDeepLink.artifactId !== null ||
      activeDeepLink.actionId === null
    ) {
      return;
    }
    const activeProof = artifactSettlementProofs.find(
      (proof) => proof.actionId === activeDeepLink.actionId,
    );
    if (activeProof === undefined) return;
    const artifact = artifacts.find(
      (item) => item.id === activeProof.artifactId,
    );
    if (artifact === undefined) return;
    autoSelectedArtifact.current = true;
    setDirtyArtifactId(null);
    setSelectedId(artifact.id);
    setGenerateAction(null);
    setPickerOpen(false);
    replaceExecutionTarget(artifact.actionId, artifact.id);
  }, [activeDeepLinkKey, artifactSettlementProofKey]);

  useEffect(() => {
    if (
      actionTargetFormOpen ||
      activeTargetSettlement !== null ||
      activeTargetRecovery !== null
    ) {
      return;
    }
    switch (deepLinkResolution.kind) {
      case "artifact": {
        const artifact = artifacts.find(
          (item) => item.id === deepLinkResolution.artifactId,
        );
        if (artifact === undefined) return;
        autoSelectedArtifact.current = true;
        if (selectedId !== artifact.id) {
          setDirtyArtifactId(null);
          setSelectedId(artifact.id);
          setGenerateAction(null);
          setPickerOpen(false);
        }
        if (
          activeDeepLink.kind !== "target" ||
          activeDeepLink.actionId !== artifact.actionId ||
          activeDeepLink.artifactId !== artifact.id
        ) {
          replaceExecutionTarget(artifact.actionId, artifact.id);
        }
        return;
      }
      case "action": {
        if (actionTargetQueued) return;
        const action = actions.find(
          (item) => item.id === deepLinkResolution.actionId,
        );
        if (action === undefined || generateAction?.id === action.id) return;
        autoSelectedArtifact.current = true;
        setDirtyArtifactId(null);
        setSelectedId(null);
        setPickerOpen(false);
        setGenerateAction(action);
        return;
      }
      case "invalid":
      case "ambiguous":
      case "not_found":
        autoSelectedArtifact.current = true;
        if (selectedId !== null) {
          setDirtyArtifactId(null);
          setSelectedId(null);
        }
        if (generateAction !== null) setGenerateAction(null);
        setPickerOpen(false);
        return;
      case "default":
      case "pending":
        return;
    }
  }, [
    actionTargetFormOpen,
    activeTargetSettlement?.runId,
    activeTargetRecovery?.key,
    activeDeepLinkKey,
    deepLinkResolutionKey,
    generateAction?.id,
    selectedId,
  ]);

  useEffect(() => {
    if (
      deepLinkResolution.kind !== "default" ||
      autoSelectedArtifact.current ||
      selectedId !== null ||
      artifacts.length === 0
    ) {
      return;
    }
    autoSelectedArtifact.current = true;
    const artifact = artifacts[0];
    if (artifact === undefined) return;
    setSelectedId(artifact.id);
    replaceExecutionTarget(artifact.actionId, artifact.id);
  }, [
    artifacts[0]?.actionId,
    artifacts[0]?.id,
    deepLinkResolution.kind,
    selectedId,
  ]);

  function commitActiveDeepLink(next: ExecutionDeepLink): void {
    activeDeepLinkRef.current = next;
    setActiveDeepLink(next);
  }

  function replaceExecutionTarget(
    actionId: string,
    artifactId: string | null,
  ): void {
    commitActiveDeepLink({ kind: "target", actionId, artifactId });
    const nextLocation = executionUrlWithTarget(
      pathname,
      new URLSearchParams(latestExecutionSearch.current),
      {
        actionId,
        artifactId,
      },
    );
    acceptedExecutionLocation.current = nextLocation;
    router.replace(nextLocation, { scroll: false });
  }

  function clearExecutionTarget(): void {
    autoSelectedArtifact.current = true;
    commitActiveDeepLink({ kind: "none" });
    setDirtyArtifactId(null);
    setSelectedId(null);
    setGenerateAction(null);
    setPickerOpen(false);
    const nextLocation = executionUrlWithTarget(
      pathname,
      new URLSearchParams(latestExecutionSearch.current),
      null,
    );
    acceptedExecutionLocation.current = nextLocation;
    router.replace(nextLocation, { scroll: false });
  }

  function retryExecutionTarget(): void {
    if (activeTargetSettlement !== null) {
      if (
        activeTargetSettlement.phase !== "settling" ||
        activeTargetSettlement.refreshing
      ) {
        return;
      }
      const runId = activeTargetSettlement.runId;
      setArtifactProjectionSettlements((current) =>
        current.map((settlement) =>
          settlement.runId === runId
            ? {
                ...settlement,
                refreshing: true,
                lastRefreshFailed: false,
              }
            : settlement,
        ),
      );
      const artifactRefresh = refetchArtifacts();
      const finishArtifactRefresh = (failed: boolean): void => {
        setArtifactProjectionSettlements((current) =>
          current.map(
            (settlement) =>
              queuedActionTargetAfterRefresh(settlement, runId, failed) ??
              settlement,
          ),
        );
      };
      void artifactRefresh.then(
        (result) => finishArtifactRefresh(result.isError),
        () => finishArtifactRefresh(true),
      );
      return;
    }
    if (activeTargetRecovery !== null) {
      if (activeTargetRecovery.refreshing) return;
      void recoverAlreadyActive(
        activeTargetRecovery.actionId,
        activeTargetRecovery.artifactType,
      );
      return;
    }
    if (deepLinkResolution.kind !== "pending") return;
    const resource = deepLinkResolution.resource;

    if (resource === "artifacts") {
      if (artifactsQuery.data === undefined) {
        void artifactsQuery.refetch();
      } else if (artifactsQuery.isFetchNextPageError) {
        void artifactsQuery.fetchNextPage();
      }
      return;
    }
    if (actionsQuery.data === undefined) {
      void actionsQuery.refetch();
    } else if (actionsQuery.isFetchNextPageError) {
      void actionsQuery.fetchNextPage();
    }
  }

  function confirmEditorDiscard(): boolean {
    return canDiscardArtifactChanges(selectedEditorDirty, () =>
      window.confirm(t("unsavedLeaveWarning")),
    );
  }

  function selectArtifact(artifactId: string): void {
    if (artifactId === selectedId) return;
    const artifact = artifacts.find((item) => item.id === artifactId);
    if (artifact === undefined) return;
    if (
      generationFenceKeys.has(
        artifactGenerationKey(artifact.actionId, artifact.artifactType),
      )
    ) {
      return;
    }
    if (!confirmEditorDiscard()) return;
    setGenerateAction(null);
    setPickerOpen(false);
    setSelectedId(artifactId);
    replaceExecutionTarget(artifact.actionId, artifact.id);
  }

  function closeEditor(): void {
    if (!confirmEditorDiscard()) return;
    clearExecutionTarget();
  }

  /**
   * Apply a type chip, and never leave the editor showing a deliverable the
   * queue beside it no longer lists.
   *
   * Two deliberate narrowings of the reference behaviour:
   *  - Unsaved edits win. If the open editor is dirty the filter still applies,
   *    but the selection is left alone: a chip is not a mandate to discard a
   *    revision the operator has typed and not saved.
   *  - Nothing selected stays nothing selected. The reference workbench always
   *    has a document open, so its fallback opens the first row; here a chip
   *    click that silently opened a deliverable would start network reads the
   *    operator never asked for.
   */
  function applyTypeFilter(next: ArtifactFilter): void {
    setTypeFilter(next);
    if (selectedId === null || selectedEditorDirty) return;
    const visible = artifactsForFilter(orderedArtifacts, next);
    if (visible.some((artifact) => artifact.id === selectedId)) return;
    const fallback = visible[0];
    if (
      fallback === undefined ||
      generationFenceKeys.has(
        artifactGenerationKey(fallback.actionId, fallback.artifactType),
      )
    ) {
      clearExecutionTarget();
      return;
    }
    setGenerateAction(null);
    setPickerOpen(false);
    setSelectedId(fallback.id);
    replaceExecutionTarget(fallback.actionId, fallback.id);
  }

  /** Roving-tabindex keyboard model for the chip row (one tab stop). */
  function onFilterKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const index = ARTIFACT_FILTERS.indexOf(typeFilter);
    const last = ARTIFACT_FILTERS.length - 1;
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = index === last ? 0 : index + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = index === 0 ? last : index - 1;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = ARTIFACT_FILTERS[nextIndex];
    if (next === undefined) return;
    applyTypeFilter(next);
    requestAnimationFrame(() => {
      filterTabsRef.current
        ?.querySelector<HTMLButtonElement>(`[data-studio-filter="${next}"]`)
        ?.focus();
    });
  }

  function openGenerate(action: ArtifactAction): void {
    if (
      queuedActionBlocksGeneration(artifactProjectionSettlements, action.id) ||
      activeGenerationRecoveries.some(
        (recovery) => recovery.actionId === action.id,
      )
    ) {
      return;
    }
    if (!confirmEditorDiscard()) return;
    setGenerateAction(action);
    setPickerOpen(false);
    replaceExecutionTarget(action.id, null);
  }

  function cancelGenerate(): void {
    if (
      activeDeepLink.kind === "target" &&
      activeDeepLink.artifactId === null &&
      activeDeepLink.actionId === generateAction?.id
    ) {
      if (selected !== null) {
        setGenerateAction(null);
        replaceExecutionTarget(selected.actionId, selected.id);
      } else {
        clearExecutionTarget();
      }
      return;
    }
    setGenerateAction(null);
  }

  function openPicker(): void {
    if (!confirmEditorDiscard()) return;
    setPickerOpen(true);
    setGenerateAction(null);
  }

  function onQueued(
    run: AsyncRun,
    artifactId: string | null,
    actionId: string,
    artifactType: ArtifactType,
  ): void {
    const key = artifactGenerationKey(actionId, artifactType);
    finishedRuns.current.delete(run.id);
    setRunQueryFailureIds((current) => current.filter((id) => id !== run.id));
    setTerminalRunFailures((current) =>
      current.filter((item) => item.id !== run.id),
    );
    setTrackedRunIds((current) =>
      current.includes(run.id) ? current : [...current, run.id],
    );
    setLocalActiveKeysByRun((current) => ({
      ...current,
      [run.id]: key,
    }));
    setActiveGenerationRecoveries((current) =>
      current.filter((recovery) => recovery.key !== key),
    );
    setGenerateAction(null);
    setPickerOpen(false);
    const queuedTarget = executionTargetAfterQueue(actionId, artifactId);
    if (queuedTarget.artifactId !== null) {
      setDirtyArtifactId(null);
      setSelectedId(queuedTarget.artifactId);
      replaceExecutionTarget(queuedTarget.actionId, queuedTarget.artifactId);
      return;
    }
    // A 202 can precede the artifact projection. Keep the accepted action-only
    // identity in both state and URL, but suppress reopening the submitted form.
    autoSelectedArtifact.current = true;
    setDirtyArtifactId(null);
    setSelectedId(null);
    commitActiveDeepLink({ kind: "target", ...queuedTarget });
    const settlement = queuedActionTargetAfterQueue(
      actionId,
      run.id,
      artifactType,
    );
    setArtifactProjectionSettlements((current) => [
      ...current.filter(
        (candidate) =>
          candidate.actionId !== actionId ||
          candidate.artifactType !== artifactType,
      ),
      run.resultRef?.type === "artifact"
        ? { ...settlement, expectedArtifactId: run.resultRef.id }
        : settlement,
    ]);
    const nextLocation = executionUrlWithTarget(
      pathname,
      new URLSearchParams(latestExecutionSearch.current),
      queuedTarget,
    );
    acceptedExecutionLocation.current = nextLocation;
    if (nextLocation !== currentExecutionLocation) {
      router.replace(nextLocation, { scroll: false });
    }
  }

  async function recoverAlreadyActive(
    actionId: string,
    artifactType: ArtifactType,
  ): Promise<void> {
    const recovery: ActiveGenerationRecovery = {
      key: artifactGenerationKey(actionId, artifactType),
      actionId,
      artifactType,
      refreshing: true,
    };
    const attemptId = recoveryAttemptSequence.current + 1;
    recoveryAttemptSequence.current = attemptId;
    recoveryAttemptByKey.current.set(recovery.key, attemptId);
    const attemptIsCurrent = (): boolean =>
      recoveryAttemptCanCommit(
        { attemptId, projectId },
        {
          attemptId: recoveryAttemptByKey.current.get(recovery.key),
          projectId: recoveryProjectRef.current,
        },
      );
    const leaveRecoveryPending = (): void => {
      if (!attemptIsCurrent()) return;
      setActiveGenerationRecoveries((current) =>
        current.map((item) =>
          item.key === recovery.key ? { ...item, refreshing: false } : item,
        ),
      );
    };
    // The conflicting run is proven finished, so the fence is dropped outright.
    // Nothing else can drop it: the fenced row is rendered without a regenerate
    // handler, so `onQueued` is unreachable from here.
    const releaseRecoveryFence = (): void => {
      if (!attemptIsCurrent()) return;
      recoveryAttemptByKey.current.delete(recovery.key);
      setActiveGenerationRecoveries((current) =>
        current.filter((item) => item.key !== recovery.key),
      );
    };
    setActiveGenerationRecoveries((current) => {
      const withoutKey = current.filter((item) => item.key !== recovery.key);
      return [...withoutKey, recovery];
    });
    autoSelectedArtifact.current = true;
    setDirtyArtifactId(null);
    setSelectedId(null);
    setGenerateAction(null);
    setPickerOpen(false);

    const refreshed = await artifactsQuery.refetch();
    // A refetch error can retain the previous successful pages in `data`.
    // Never treat that stale cache as proof that the conflicting run settled.
    if (!refreshed.isSuccess) {
      leaveRecoveryPending();
      return;
    }
    const refreshedArtifacts = uniqueCursorItems(refreshed.data);
    const projectionIdentities = refreshedArtifacts.map((artifact) => ({
      id: artifact.id,
      actionId: artifact.actionId,
      artifactType: artifact.artifactType,
      artifactLive: artifact.status !== "archived",
      liveRunId:
        artifact.activeRun !== null && !isTerminalRun(artifact.activeRun.status)
          ? artifact.activeRun.id
          : null,
    }));
    const projectionComplete =
      refreshed.data.pages.at(-1)?.meta.nextCursor === null;
    const resolution = resolveActiveGenerationRecovery(
      actionId,
      artifactType,
      projectionIdentities,
      projectionComplete,
    );
    if (resolution.kind !== "active") {
      if (
        activeGenerationRecoveryReleased(
          actionId,
          artifactType,
          projectionIdentities,
          projectionComplete,
        )
      ) {
        releaseRecoveryFence();
        return;
      }
      leaveRecoveryPending();
      return;
    }
    const recoveredArtifact = refreshedArtifacts.find(
      (artifact) => artifact.id === resolution.artifactId,
    );
    const recoveredRun = recoveredArtifact?.activeRun ?? null;
    if (
      recoveredArtifact === undefined ||
      recoveredRun === null ||
      recoveredRun.id !== resolution.runId ||
      isTerminalRun(recoveredRun.status)
    ) {
      leaveRecoveryPending();
      return;
    }
    if (!attemptIsCurrent()) return;
    recoveryAttemptByKey.current.delete(recovery.key);

    // This id comes from the canonical artifact projection, not from parsing
    // provider detail or guessing the Location header hidden by ApiError.
    finishedRuns.current.delete(recoveredRun.id);
    setRunQueryFailureIds((current) =>
      current.filter((id) => id !== recoveredRun.id),
    );
    setTerminalRunFailures((current) =>
      current.filter((run) => run.id !== recoveredRun.id),
    );
    setTrackedRunIds((current) =>
      current.includes(recoveredRun.id)
        ? current
        : [...current, recoveredRun.id],
    );
    setLocalActiveKeysByRun((current) => ({
      ...current,
      [recoveredRun.id]: recovery.key,
    }));
    setActiveGenerationRecoveries((current) =>
      current.filter((item) => item.key !== recovery.key),
    );
    const currentTarget = activeDeepLinkRef.current;
    const latestSearchParams = new URLSearchParams(
      latestExecutionSearch.current,
    );
    const currentUrlTarget = parseExecutionDeepLink({
      actionId: executionQueryValue(latestSearchParams, "actionId"),
      artifactId: executionQueryValue(latestSearchParams, "artifactId"),
    });
    const stillOwnsTarget =
      recoveryOwnsExecutionTarget(actionId, currentTarget) &&
      recoveryOwnsExecutionTarget(actionId, currentUrlTarget);
    if (!stillOwnsTarget) return;
    setDirtyArtifactId(null);
    setSelectedId(recoveredArtifact.id);
    replaceExecutionTarget(recoveredArtifact.actionId, recoveredArtifact.id);
  }

  function retryFailedRun(runId: string): void {
    finishedRuns.current.delete(runId);
    queryClient.removeQueries({
      queryKey: ["run", projectId, runId],
      exact: true,
    });
    setRunQueryFailureIds((current) => current.filter((id) => id !== runId));
    setTrackedRunIds((current) =>
      current.includes(runId) ? current : [...current, runId],
    );
    void artifactsQuery.refetch();
  }

  return (
    <div className={styles.page}>
      <header className={styles.hero} data-studio-page-hero="">
        <div className={styles.heroText}>
          <span className="sf-eyebrow">
            {t("title")} · {t("eyebrow")}
          </span>
          <h1 className={styles.title}>{t("heroTitle")}</h1>
          <p className={styles.subtitle}>{t("subtitle")}</p>
          <div className={styles.heroActions}>
            <Button
              variant="primary"
              onClick={openPicker}
              disabled={
                generationUnavailable ||
                (generationEligibleActions.length === 0 &&
                  !actionsQuery.hasNextPage)
              }
              aria-busy={generationUnavailable}
              aria-describedby={
                actionsInitialLoading ||
                (!actionsInitialError &&
                  generationEligibleActions.length === 0 &&
                  !actionsQuery.hasNextPage)
                  ? "sf-gen-note"
                  : undefined
              }
            >
              {t("generate")}
            </Button>
            {actionsInitialLoading ? (
              <p id="sf-gen-note" className={styles.heroNote}>
                {tCommon("loading")}
              </p>
            ) : !actionsInitialError &&
              generationEligibleActions.length === 0 &&
              !actionsQuery.hasNextPage ? (
              <p id="sf-gen-note" className={styles.heroNote}>
                {t("noActions")}
              </p>
            ) : null}
          </div>
        </div>

        <section className={styles.statStrip} aria-label={t("summaryTitle")}>
          <article className={styles.statCard}>
            <span className={styles.statMetric}>
              {artifactsInitialLoading
                ? "—"
                : `${artifacts.length}${artifactsQuery.hasNextPage ? "+" : ""}`}
            </span>
            <span className={styles.statLabel}>{t("statOutputs")}</span>
          </article>
          <article className={styles.statCard}>
            <span className={styles.statMetric}>
              {artifactsInitialLoading
                ? "—"
                : `${readyCount}${artifactsQuery.hasNextPage ? "+" : ""}`}
            </span>
            <span className={styles.statLabel}>{t("statReady")}</span>
          </article>
          <article className={styles.statCard}>
            <span className={styles.statMetric}>
              {artifactsInitialLoading
                ? "—"
                : `${draftCount}${artifactsQuery.hasNextPage ? "+" : ""}`}
            </span>
            <span className={styles.statLabel}>{t("statDrafts")}</span>
          </article>
        </section>
      </header>

      {afterHero}

      {actionsInitialError ? (
        <ProblemNotice
          error={actionsQuery.error ?? new Error("unknown")}
          message={tCommon("errorHint")}
          onRetry={() => void actionsQuery.refetch()}
          compact
        />
      ) : null}

      {trackedRunIds.length > 0 ? (
        <div className={styles.runStack} aria-label={t("activeRuns")}>
          {trackedRunIds.map((runId) => (
            <ArtifactRunMonitor
              key={runId}
              projectId={projectId}
              runId={runId}
              onTerminal={onRunTerminal}
              onQueryError={onRunQueryError}
            />
          ))}
        </div>
      ) : null}

      {terminalRunFailures.map((run) => (
        <div key={run.id} data-studio-terminal-run-failure={run.id}>
          <RunBanner run={run} message={t("generationDidNotComplete")} />
        </div>
      ))}

      {runQueryFailureIds.map((runId) => (
        <Panel
          key={runId}
          tone="coral"
          padding="md"
          className={styles.banner}
          role="alert"
          data-studio-run-query-error={runId}
        >
          <span className={styles.bannerLabel}>
            {t("runStatusUnavailable")}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => retryFailedRun(runId)}
          >
            {t("retryGenerationStatus")}
          </Button>
        </Panel>
      ))}
      {activeGenerationRecoveries.map((recovery) => (
        <Panel
          key={recovery.key}
          padding="md"
          className={styles.runQueryError}
          data-studio-conflict-recovery={recovery.key}
        >
          <span className={styles.bannerLabel}>
            {t("runStatusUnavailable")}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={recovery.refreshing}
            onClick={() =>
              void recoverAlreadyActive(
                recovery.actionId,
                recovery.artifactType,
              )
            }
          >
            {t("retryGenerationStatus")}
          </Button>
        </Panel>
      ))}

      <section className={styles.filterBar} data-studio-filter-bar="">
        <div
          ref={filterTabsRef}
          className={styles.filterTabs}
          role="tablist"
          aria-label={t("filterLabel")}
          onKeyDown={onFilterKeyDown}
        >
          {ARTIFACT_FILTERS.map((filter) => {
            const active = filter === typeFilter;
            return (
              <button
                key={filter}
                type="button"
                role="tab"
                id={`sf-artifact-filter-${filter}`}
                aria-controls="sf-artifact-workspace"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                data-studio-filter={filter}
                className={cx(
                  styles.filterTab,
                  active && styles.filterTabActive,
                )}
                onClick={() => applyTypeFilter(filter)}
              >
                {filter === "all"
                  ? t("filterAll")
                  : t(`artifactType.${filter}`)}
              </button>
            );
          })}
        </div>
        {/* Both numbers are read off the queue itself. `+` is not decoration:
            it says a further page exists, so the total is a floor and not a
            claim. The second number is the deliverables whose next legal move
            is a human one — `draft` is the only status `MANUAL_STATUS_TRANSITIONS`
            lets an operator act on, so this counts work actually waiting on a
            person rather than work that merely looks unfinished. */}
        <p className={styles.filterCount} data-studio-filter-count="">
          {artifactsInitialLoading
            ? tCommon("loading")
            : draftCount === 0
              ? t("filterCountNone", {
                  total: `${artifacts.length}${artifactsQuery.hasNextPage ? "+" : ""}`,
                })
              : t("filterCount", {
                  total: `${artifacts.length}${artifactsQuery.hasNextPage ? "+" : ""}`,
                  review: draftCount,
                })}
        </p>
      </section>

      <div
        className={styles.workspace}
        id="sf-artifact-workspace"
        role="tabpanel"
        aria-labelledby={`sf-artifact-filter-${typeFilter}`}
        data-studio-workspace=""
        aria-label={t("workspaceLabel")}
      >
        <Panel
          padding="none"
          className={styles.queuePanel}
          data-studio-queue=""
          aria-labelledby="sf-studio-queue-title"
        >
          <div className={styles.queueHead}>
            <div>
              <span className="sf-eyebrow">{t("queueEyebrow")}</span>
              <h2 id="sf-studio-queue-title" className={styles.queueTitle}>
                {t("queueTitle")}
              </h2>
            </div>
            <Badge>
              {artifactsInitialLoading
                ? "—"
                : `${queuedArtifacts.length}${artifactsQuery.hasNextPage ? "+" : ""}`}
            </Badge>
          </div>
          <div className={styles.queueScroll}>
            {artifactsInitialLoading ? (
              <div className={styles.queueState}>
                <Spinner size="lg" label={tCommon("loading")} />
                <p className={styles.stateText}>{tCommon("loading")}</p>
              </div>
            ) : artifactsInitialError ? (
              <div className={styles.queueState}>
                <ProblemState
                  error={artifactsQuery.error ?? new Error("unknown")}
                  onRetry={() => void artifactsQuery.refetch()}
                />
              </div>
            ) : artifacts.length === 0 ? (
              <div className={styles.queueState}>
                <EmptyState
                  title={t("emptyTitle")}
                  description={t("emptyHint")}
                />
              </div>
            ) : queuedArtifacts.length === 0 ? (
              <div className={styles.queueState}>
                <EmptyState
                  title={t("filterEmptyTitle")}
                  description={t("filterEmptyHint")}
                />
              </div>
            ) : (
              <div className={styles.queueList} data-studio-queue-list="">
                {queuedArtifacts.map((artifact) => {
                  const action = actionById.get(artifact.actionId);
                  const generationFenced = generationFenceKeys.has(
                    artifactGenerationKey(
                      artifact.actionId,
                      artifact.artifactType,
                    ),
                  );
                  return (
                    <ArtifactCard
                      key={artifact.id}
                      artifact={artifact}
                      actionTitle={action?.title}
                      generationActive={activeKeys.has(
                        artifactGenerationKey(
                          artifact.actionId,
                          artifact.artifactType,
                        ),
                      )}
                      selectionBlocked={generationFenced}
                      selected={selected?.id === artifact.id}
                      onOpen={() => selectArtifact(artifact.id)}
                      onRegenerate={
                        action !== undefined &&
                        action.status !== "dismissed" &&
                        !generationFenced
                          ? () => openGenerate(action)
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            )}
          </div>
          {artifactsQuery.hasNextPage || artifactsQuery.isFetchNextPageError ? (
            <div className={styles.queueFooter}>
              {artifactsQuery.isFetchNextPageError ? (
                <p className={styles.paginationError} role="alert">
                  {tCommon("loadMoreError")}
                </p>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void artifactsQuery.fetchNextPage()}
                disabled={artifactsQuery.isFetchingNextPage}
              >
                {artifactsQuery.isFetchingNextPage
                  ? tCommon("loadingMore")
                  : artifactsQuery.isFetchNextPageError
                    ? tCommon("retry")
                    : tCommon("loadMore")}
              </Button>
            </div>
          ) : null}
        </Panel>

        <section
          className={styles.editorColumn}
          data-studio-editor-column=""
          aria-label={t("editorCanvas")}
        >
          {deepLinkNoticeKind !== null ? (
            <ExecutionTargetState
              kind={deepLinkNoticeKind}
              retryable={deepLinkRetryable}
              onRetry={retryExecutionTarget}
              onClear={clearExecutionTarget}
            />
          ) : generateAction !== null ? (
            <GenerateForm
              projectId={projectId}
              action={generateAction}
              onQueued={(run, artifactId, artifactType) =>
                onQueued(run, artifactId, generateAction.id, artifactType)
              }
              onAlreadyActive={(artifactType) =>
                recoverAlreadyActive(generateAction.id, artifactType)
              }
              onCancel={cancelGenerate}
            />
          ) : pickerOpen ? (
            <ActionPicker
              actions={generationEligibleActions}
              liveKeys={liveKeys}
              activeKeys={activeKeys}
              hasMore={actionsQuery.hasNextPage}
              loadingMore={actionsQuery.isFetchingNextPage}
              loadMoreError={actionsQuery.isFetchNextPageError}
              onPick={openGenerate}
              onLoadMore={() => void actionsQuery.fetchNextPage()}
              onCancel={() => setPickerOpen(false)}
            />
          ) : selected !== null ? (
            <ArtifactEditor
              key={selected.id}
              projectId={projectId}
              artifact={selected}
              onClose={closeEditor}
              onDirtyChange={onEditorDirtyChange}
            />
          ) : (
            <EditorPlaceholder
              generationUnavailable={generationUnavailable}
              canGenerate={
                generationEligibleActions.length > 0 || actionsQuery.hasNextPage
              }
              onGenerate={openPicker}
            />
          )}
        </section>

        <EvidenceRail artifact={selected} action={selectedAction} />
      </div>
    </div>
  );
}
