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
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bcp47Locale,
  MAX_ARTIFACT_CONTENT_CHARS,
} from "@sf/contracts";
import {
  CircleCheckBig,
  ClipboardList,
  FilePenLine,
  FileStack,
  FileText,
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
import { uniqueCursorItems } from "@/lib/api/cursor-pages";
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
  canDiscardArtifactChanges,
  isArtifactEditorDirty,
  shouldConfirmArtifactNavigation,
} from "./_artifact-editor-state.ts";
import styles from "./studio.module.css";

// ----------------------------------------------------------- Tone helpers ----

const ARTIFACT_TYPES: readonly ArtifactType[] = [
  "content_brief",
  "metadata_rewrite",
  "technical_ticket",
];

/** Per-type lucide glyph — a quiet visual anchor on cards and group heads. */
const ARTIFACT_TYPE_ICON: Record<ArtifactType, LucideIcon> = {
  content_brief: FileText,
  metadata_rewrite: SquarePen,
  technical_ticket: ClipboardList,
};

const GENERATION_MODES: readonly GenerationMode[] = [
  "template",
  "structured_llm",
];

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

/** Group artifacts by type, preserving the canonical type order. */
function groupByType(
  artifacts: readonly Artifact[],
): readonly (readonly [ArtifactType, readonly Artifact[]])[] {
  return ARTIFACT_TYPES.map(
    (type) => [type, artifacts.filter((a) => a.artifactType === type)] as const,
  ).filter(([, list]) => list.length > 0);
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
          opensNewContext: target !== null && target !== "" && target !== "_self",
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
  return (
    window as typeof window & { readonly navigation?: BrowserNavigation }
  ).navigation;
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

// --------------------------------------------------------- Artifact card -----

interface ArtifactCardProps {
  readonly artifact: Artifact;
  readonly actionTitle: string | undefined;
  readonly selected: boolean;
  readonly onOpen: () => void;
  readonly onRegenerate: (() => void) | undefined;
}

function ArtifactCard({
  artifact,
  actionTitle,
  selected,
  onOpen,
  onRegenerate,
}: ArtifactCardProps) {
  const t = useTranslations("studio");
  const tRun = useTranslations("runState");
  const generating =
    artifact.status === "generating" || artifact.activeRun !== null;
  const TypeIcon = ARTIFACT_TYPE_ICON[artifact.artifactType];

  return (
    <Card
      padding="md"
      className={cx(styles.artCard, selected && styles.artCardSelected)}
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
        <StatusPill tone={artifactStatusTone(artifact.status)}>
          {t(`status.${artifact.status}`)}
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

      {generating && artifact.activeRun !== null ? (
        <div className={styles.artRun} aria-live="polite">
          <Spinner size="sm" label={t("generating")} />
          <span className={styles.metaLabel}>
            {tRun(artifact.activeRun.status)}
          </span>
        </div>
      ) : null}

      <div className={styles.artActions}>
        <Button variant="secondary" size="sm" onClick={onOpen}>
          {selected ? t("openSelected") : t("open")}
        </Button>
        {onRegenerate !== undefined ? (
          <Button
            variant="text"
            size="sm"
            onClick={onRegenerate}
            disabled={generating}
          >
            {t("regenerate")}
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
  const cannotReady =
    artifact.validationState === "invalid" || validationErrors.length > 0;
  const isJson = current?.contentFormat === "json";

  const discardLocalChanges = useCallback((): void => {
    setDraft(savedDraft);
    setNote("");
  }, [savedDraft]);

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
                <div key={field.key} className={styles.fieldRow}>
                  <dt className={styles.fieldKey}>{field.key}</dt>
                  <dd className={styles.fieldVal}>{field.value}</dd>
                </div>
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
            {artifact.status === "ready" ? (
              <Button
                variant="ghost"
                onClick={() => void onSetStatus("draft")}
                disabled={busy || dirty}
                aria-describedby={dirty ? "sf-status-dirty-hint" : undefined}
              >
                {t("backToDraft")}
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => void onSetStatus("ready")}
                disabled={busy || dirty || cannotReady}
                aria-describedby={
                  dirty
                    ? "sf-status-dirty-hint"
                    : cannotReady
                      ? "sf-ready-hint"
                      : undefined
                }
                title={
                  dirty
                    ? t("saveBeforeStatusChange")
                    : cannotReady
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
          {dirty ? (
            <p id="sf-status-dirty-hint" className={styles.readyHint}>
              {t("saveBeforeStatusChange")}
            </p>
          ) : cannotReady ? (
            <p id="sf-ready-hint" className={styles.readyHint}>
              {t("markReadyHint")}
            </p>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

// --------------------------------------------------------- Generate form -----

interface GenerateFormProps {
  readonly projectId: string;
  readonly action: ArtifactAction;
  readonly onQueued: (run: AsyncRun, artifactId: string | null) => void;
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
      onQueued(data.run, artifactId);
    } catch (caught) {
      if (caught instanceof ApiError) {
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
            const hasLive =
              type !== null && liveKeys.has(`${action.id}:${type}`);
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
                >
                  {hasLive ? t("regenerate") : t("generateSubmit")}
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

// --------------------------------------------------------------- Screen ------

function StateWrap({ children }: { readonly children: ReactNode }) {
  return <div className={styles.state}>{children}</div>;
}

export function StudioClient({ projectId }: { readonly projectId: string }) {
  const t = useTranslations("studio");
  const tCommon = useTranslations("common");

  const artifactsQuery = useProjectArtifacts(projectId);
  const actionsQuery = useProjectActions(projectId);
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirtyArtifactId, setDirtyArtifactId] = useState<string | null>(null);
  const [generateAction, setGenerateAction] = useState<ArtifactAction | null>(
    null,
  );
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [failedRunId, setFailedRunId] = useState<string | null>(null);
  const onEditorDirtyChange = useCallback(
    (artifactId: string, dirty: boolean): void => {
      setDirtyArtifactId((value) => {
        if (dirty) return artifactId;
        return value === artifactId ? null : value;
      });
    },
    [],
  );

  const runQuery = useProjectRun(projectId, activeRunId);
  const runOutcome = studioRunQueryOutcome(runQuery.data, runQuery.error);
  // Runs already observed terminal, so a stale artifact list can't re-seed them.
  const finishedRuns = useRef<Set<string>>(new Set<string>());

  // Resume polling a run that is still generating on load.
  useEffect(() => {
    if (activeRunId !== null) return;
    const live = uniqueCursorItems(artifactsQuery.data).find(
      (a) =>
        a.activeRun !== null &&
        !isTerminalRun(a.activeRun.status) &&
        !finishedRuns.current.has(a.activeRun.id),
    );
    if (live?.activeRun) setActiveRunId(live.activeRun.id);
  }, [artifactsQuery.data, activeRunId]);

  // When the tracked run reaches a terminal state, refetch and stop polling.
  // A final status-query error follows the same cleanup path, but leaves a
  // visible, actionable notice and prevents a stale artifact projection from
  // immediately re-seeding the same failed poll.
  useEffect(() => {
    const run = runQuery.data;
    if (runOutcome === "terminal" && run) {
      finishedRuns.current.add(run.id);
      setFailedRunId(null);
      void queryClient.invalidateQueries({
        queryKey: ["artifacts", projectId],
      });
      setActiveRunId(null);
      return;
    }
    if (
      runOutcome === "query_error" &&
      activeRunId !== null &&
      !finishedRuns.current.has(activeRunId)
    ) {
      finishedRuns.current.add(activeRunId);
      setFailedRunId(activeRunId);
      void queryClient.invalidateQueries({
        queryKey: ["artifacts", projectId],
        refetchType: "active",
      });
      setActiveRunId(null);
    }
  }, [runOutcome, runQuery.data, activeRunId, queryClient, projectId]);

  const artifacts = uniqueCursorItems(artifactsQuery.data);
  const actions = uniqueCursorItems(actionsQuery.data);
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
  const liveKeys = new Set(
    artifacts
      .filter((a) => a.status !== "archived")
      .map((a) => `${a.actionId}:${a.artifactType}`),
  );
  const selected = artifacts.find((a) => a.id === selectedId) ?? null;
  const groups = groupByType(artifacts);
  const readyCount = artifacts.filter((a) => a.status === "ready").length;
  const draftCount = artifacts.filter((a) => a.status === "draft").length;
  const selectedEditorDirty =
    selectedId !== null && dirtyArtifactId === selectedId;
  const generationUnavailable =
    artifactsInitialLoading ||
    artifactsInitialError ||
    actionsInitialLoading ||
    actionsInitialError;

  function confirmEditorDiscard(): boolean {
    return canDiscardArtifactChanges(selectedEditorDirty, () =>
      window.confirm(t("unsavedLeaveWarning")),
    );
  }

  function selectArtifact(artifactId: string): void {
    if (artifactId === selectedId) return;
    if (!confirmEditorDiscard()) return;
    setSelectedId(artifactId);
  }

  function closeEditor(): void {
    if (!confirmEditorDiscard()) return;
    setSelectedId(null);
  }

  function openGenerate(action: ArtifactAction): void {
    setGenerateAction(action);
    setPickerOpen(false);
  }

  function onQueued(run: AsyncRun, artifactId: string | null): void {
    setFailedRunId(null);
    setActiveRunId(run.id);
    setGenerateAction(null);
    setPickerOpen(false);
    if (artifactId !== null) selectArtifact(artifactId);
  }

  function retryFailedRun(): void {
    if (failedRunId === null) return;
    finishedRuns.current.delete(failedRunId);
    setActiveRunId(failedRunId);
    setFailedRunId(null);
    void artifactsQuery.refetch();
  }

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroText}>
          <span className="sf-eyebrow">{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("title")}</h1>
          <p className={styles.subtitle}>{t("subtitle")}</p>
        </div>
        <div className={styles.heroActions}>
          <Button
            variant="primary"
            onClick={() => {
              setPickerOpen(true);
              setGenerateAction(null);
            }}
            disabled={
              generationUnavailable ||
              (eligibleActions.length === 0 && !actionsQuery.hasNextPage)
            }
            aria-busy={generationUnavailable}
            aria-describedby={
              actionsInitialLoading ||
              (!actionsInitialError &&
                eligibleActions.length === 0 &&
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
            eligibleActions.length === 0 &&
            !actionsQuery.hasNextPage ? (
            <p id="sf-gen-note" className={styles.heroNote}>
              {t("noActions")}
            </p>
          ) : null}
        </div>
      </header>

      {actionsInitialError ? (
        <ProblemNotice
          error={actionsQuery.error ?? new Error("unknown")}
          message={tCommon("errorHint")}
          onRetry={() => void actionsQuery.refetch()}
          compact
        />
      ) : null}

      {artifacts.length > 0 ? (
        <section className={styles.statStrip} aria-label={t("summaryTitle")}>
          <article className={styles.statCard}>
            <span className={styles.statIcon}>
              <FileStack aria-hidden="true" size={18} />
            </span>
            <span className={styles.statMetric}>
              {artifacts.length}
              {artifactsQuery.hasNextPage ? "+" : ""}
            </span>
            <span className={styles.statLabel}>{t("statOutputs")}</span>
          </article>
          <article className={styles.statCard}>
            <span className={cx(styles.statIcon, styles.statIconMint)}>
              <CircleCheckBig aria-hidden="true" size={18} />
            </span>
            <span className={styles.statMetric}>
              {readyCount}
              {artifactsQuery.hasNextPage ? "+" : ""}
            </span>
            <span className={styles.statLabel}>{t("statReady")}</span>
          </article>
          <article className={styles.statCard}>
            <span className={cx(styles.statIcon, styles.statIconAmber)}>
              <FilePenLine aria-hidden="true" size={18} />
            </span>
            <span className={styles.statMetric}>
              {draftCount}
              {artifactsQuery.hasNextPage ? "+" : ""}
            </span>
            <span className={styles.statLabel}>{t("statDrafts")}</span>
          </article>
        </section>
      ) : null}

      {activeRunId !== null && runQuery.data !== undefined ? (
        <RunBanner run={runQuery.data} message={t("generating")} />
      ) : null}

      {failedRunId !== null ? (
        <Panel tone="coral" padding="md" className={styles.banner} role="alert">
          <span className={styles.bannerLabel}>
            {t("runStatusUnavailable")}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={retryFailedRun}
          >
            {t("retryGenerationStatus")}
          </Button>
        </Panel>
      ) : null}

      {generateAction !== null ? (
        <GenerateForm
          projectId={projectId}
          action={generateAction}
          onQueued={onQueued}
          onCancel={() => setGenerateAction(null)}
        />
      ) : pickerOpen ? (
        <ActionPicker
          actions={eligibleActions}
          liveKeys={liveKeys}
          hasMore={actionsQuery.hasNextPage}
          loadingMore={actionsQuery.isFetchingNextPage}
          loadMoreError={actionsQuery.isFetchNextPageError}
          onPick={openGenerate}
          onLoadMore={() => void actionsQuery.fetchNextPage()}
          onCancel={() => setPickerOpen(false)}
        />
      ) : null}

      {selected !== null ? (
        <ArtifactEditor
          key={selected.id}
          projectId={projectId}
          artifact={selected}
          onClose={closeEditor}
          onDirtyChange={onEditorDirtyChange}
        />
      ) : null}

      {artifactsInitialLoading ? (
        <StateWrap>
          <Spinner size="lg" label={tCommon("loading")} />
          <p className={styles.stateText}>{tCommon("loading")}</p>
        </StateWrap>
      ) : artifactsInitialError ? (
        <StateWrap>
          <ProblemState
            error={artifactsQuery.error ?? new Error("unknown")}
            onRetry={() => void artifactsQuery.refetch()}
          />
        </StateWrap>
      ) : artifacts.length === 0 ? (
        <StateWrap>
          <EmptyState title={t("emptyTitle")} description={t("emptyHint")} />
        </StateWrap>
      ) : (
        <div className={styles.groups}>
          {groups.map(([type, list]) => {
            const GroupIcon = ARTIFACT_TYPE_ICON[type];
            return (
              <section
                key={type}
                className={styles.group}
                aria-label={t(`artifactType.${type}`)}
              >
                <div className={styles.groupHead}>
                  <span className={styles.groupIcon}>
                    <GroupIcon aria-hidden="true" size={18} />
                  </span>
                  <h2 className={styles.groupTitle}>
                    {t(`artifactType.${type}`)}
                  </h2>
                  <Badge>
                    {String(list.length)}
                    {artifactsQuery.hasNextPage ? "+" : ""}
                  </Badge>
                </div>
                <div className={styles.cardGrid}>
                  {list.map((artifact) => {
                    const action = actionById.get(artifact.actionId);
                    return (
                      <ArtifactCard
                        key={artifact.id}
                        artifact={artifact}
                        actionTitle={action?.title}
                        selected={selected?.id === artifact.id}
                        onOpen={() => selectArtifact(artifact.id)}
                        onRegenerate={
                          action !== undefined && action.status !== "dismissed"
                            ? () => openGenerate(action)
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {artifactsQuery.hasNextPage || artifactsQuery.isFetchNextPageError ? (
        <div className={styles.pagination}>
          {artifactsQuery.isFetchNextPageError ? (
            <p className={styles.paginationError} role="alert">
              {tCommon("loadMoreError")}
            </p>
          ) : null}
          <Button
            variant="secondary"
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
    </div>
  );
}
