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

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
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
import { ApiError, useProject } from "@/lib/api";
import type { Project } from "@/lib/api";
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
import styles from "./studio.module.css";

// ----------------------------------------------------------- Tone helpers ----

const ARTIFACT_TYPES: readonly ArtifactType[] = [
  "content_brief",
  "metadata_rewrite",
  "technical_ticket",
];

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

  return (
    <Card
      padding="md"
      className={cx(styles.artCard, selected && styles.artCardSelected)}
    >
      <div className={styles.artHead}>
        <span className={styles.artType}>
          {t(`artifactType.${artifact.artifactType}`)}
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
}

interface EditorFeedback {
  readonly top: string | null;
  readonly errors: readonly string[];
}

const NO_FEEDBACK: EditorFeedback = { top: null, errors: [] };

/**
 * Detail + editor for one artifact. Mounted with a
 * `${id}:${currentRevision}` key so a saved revision remounts fresh, but typing
 * (which never changes `currentRevision`) is preserved across background
 * refetches.
 */
function ArtifactEditor({ projectId, artifact, onClose }: ArtifactEditorProps) {
  const t = useTranslations("studio");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const update = useUpdateArtifact(projectId, artifact.id);

  const current = artifact.current;
  const [draft, setDraft] = useState<string>(
    current ? contentToText(current.content) : "",
  );
  const [note, setNote] = useState<string>("");
  const [feedback, setFeedback] = useState<EditorFeedback>(NO_FEEDBACK);

  const busy = update.isPending;
  const validationErrors = current?.validationErrors ?? [];
  const cannotReady =
    artifact.validationState === "invalid" || validationErrors.length > 0;
  const isJson = current?.contentFormat === "json";

  function handleError(error: unknown): void {
    if (error instanceof ApiError) {
      if (error.status === 409 || error.code === "STALE_REVISION") {
        setFeedback({ top: t("staleRevision"), errors: [] });
        void queryClient.invalidateQueries({
          queryKey: ["artifacts", projectId],
        });
        return;
      }
      if (error.code === "ARTIFACT_VALIDATION_FAILED" || error.status === 422) {
        const errors = error
          .fieldErrors()
          .map((fieldError) => fieldError.message);
        setFeedback({ top: t("validationFailed"), errors });
        return;
      }
      setFeedback({ top: error.message, errors: [] });
      return;
    }
    setFeedback({ top: tCommon("error"), errors: [] });
  }

  async function onSaveRevision(): Promise<void> {
    if (!current) return;
    const parsed = parseEditedContent(draft, current.contentFormat);
    if (!parsed.ok) {
      setFeedback({ top: t("jsonInvalid"), errors: [] });
      return;
    }
    setFeedback(NO_FEEDBACK);
    const trimmedNote = note.trim();
    try {
      await update.mutateAsync({
        baseRevision: artifact.currentRevision,
        contentFormat: current.contentFormat,
        content: parsed.content,
        ...(trimmedNote.length > 0 ? { editorNote: trimmedNote } : {}),
      });
    } catch (error) {
      handleError(error);
    }
  }

  async function onSetStatus(
    status: "draft" | "ready" | "archived",
  ): Promise<void> {
    setFeedback(NO_FEEDBACK);
    try {
      await update.mutateAsync({
        baseRevision: artifact.currentRevision,
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
          <Button variant="text" size="sm" onClick={onClose}>
            {tCommon("close")}
          </Button>
        </div>
      </div>

      {feedback.top !== null ? (
        <p className={styles.alert} role="alert">
          {feedback.top}
        </p>
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
              spellCheck={false}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </Field>

          <Field label={t("editorNote")} htmlFor="sf-artifact-note">
            <TextArea
              id="sf-artifact-note"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>

          <div className={styles.editorActions}>
            <Button
              variant="secondary"
              onClick={() => void onSaveRevision()}
              disabled={busy}
            >
              {t("saveRevision")}
            </Button>
            {artifact.status === "ready" ? (
              <Button
                variant="ghost"
                onClick={() => void onSetStatus("draft")}
                disabled={busy}
              >
                {t("backToDraft")}
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => void onSetStatus("ready")}
                disabled={busy || cannotReady}
                aria-describedby={cannotReady ? "sf-ready-hint" : undefined}
                title={cannotReady ? t("markReadyHint") : undefined}
              >
                {t("markReady")}
              </Button>
            )}
            <Button
              variant="text"
              onClick={() => void onSetStatus("archived")}
              disabled={busy}
            >
              {t("archive")}
            </Button>
          </div>
          {cannotReady ? (
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
  readonly project: Project | undefined;
  readonly onQueued: (run: AsyncRun, artifactId: string | null) => void;
  readonly onCancel: () => void;
}

function localeOptions(project: Project | undefined): readonly string[] {
  const set = new Set<string>();
  if (project) {
    set.add(project.defaultDeliveryLocale);
    for (const code of project.site.languageCodes) set.add(code);
  }
  if (set.size === 0) set.add("en");
  return [...set];
}

function GenerateForm({
  projectId,
  action,
  project,
  onQueued,
  onCancel,
}: GenerateFormProps) {
  const t = useTranslations("studio");
  const tCommon = useTranslations("common");
  const create = useCreateArtifact(projectId, action.id);

  const expected = expectedArtifactType(action);
  const locales = localeOptions(project);
  const [artifactType, setArtifactType] = useState<ArtifactType>(
    expected ?? "content_brief",
  );
  const [mode, setMode] = useState<GenerationMode>("template");
  const [locale, setLocale] = useState<string>(
    project?.defaultDeliveryLocale ?? locales[0] ?? "en",
  );
  const [instructions, setInstructions] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const type = expected ?? artifactType;

  async function onSubmit(): Promise<void> {
    setError(null);
    const trimmed = instructions.trim();
    try {
      const data = await create.mutateAsync({
        artifactType: type,
        generationMode: mode,
        outputLocale: locale,
        ...(trimmed.length > 0 ? { operatorInstructions: trimmed } : {}),
      });
      const artifactId =
        data.resourceRef?.type === "artifact" ? data.resourceRef.id : null;
      onQueued(data.run, artifactId);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : tCommon("error"));
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
        <p className={styles.alert} role="alert">
          {error}
        </p>
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

        <Field label={t("outputLocale")}>
          <StudioSelect
            value={locale}
            onChange={setLocale}
            options={locales.map((value) => ({ value, label: value }))}
          />
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
          disabled={create.isPending}
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
  readonly onPick: (action: ArtifactAction) => void;
  readonly onCancel: () => void;
}

function ActionPicker({
  actions,
  liveKeys,
  onPick,
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
        <p className={styles.editorEmpty}>{t("noActions")}</p>
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
  const projectQuery = useProject(projectId);
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generateAction, setGenerateAction] = useState<ArtifactAction | null>(
    null,
  );
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const runQuery = useProjectRun(projectId, activeRunId);
  // Runs already observed terminal, so a stale artifact list can't re-seed them.
  const finishedRuns = useRef<Set<string>>(new Set<string>());

  // Resume polling a run that is still generating on load.
  useEffect(() => {
    if (activeRunId !== null) return;
    const live = (artifactsQuery.data?.data ?? []).find(
      (a) =>
        a.activeRun !== null &&
        !isTerminalRun(a.activeRun.status) &&
        !finishedRuns.current.has(a.activeRun.id),
    );
    if (live?.activeRun) setActiveRunId(live.activeRun.id);
  }, [artifactsQuery.data, activeRunId]);

  // When the tracked run reaches a terminal state, refetch and stop polling.
  useEffect(() => {
    const run = runQuery.data;
    if (run && isTerminalRun(run.status)) {
      finishedRuns.current.add(run.id);
      void queryClient.invalidateQueries({
        queryKey: ["artifacts", projectId],
      });
      setActiveRunId(null);
    }
  }, [runQuery.data, queryClient, projectId]);

  if (artifactsQuery.isLoading) {
    return (
      <StateWrap>
        <Spinner size="lg" label={tCommon("loading")} />
        <p className={styles.stateText}>{tCommon("loading")}</p>
      </StateWrap>
    );
  }

  if (artifactsQuery.error !== null || artifactsQuery.data === undefined) {
    return (
      <StateWrap>
        <EmptyState title={tCommon("error")}>
          <Button
            variant="secondary"
            onClick={() => void artifactsQuery.refetch()}
          >
            {tCommon("retry")}
          </Button>
        </EmptyState>
      </StateWrap>
    );
  }

  const artifacts = artifactsQuery.data.data;
  const actions = actionsQuery.data?.data ?? [];
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

  function openGenerate(action: ArtifactAction): void {
    setGenerateAction(action);
    setPickerOpen(false);
  }

  function onQueued(run: AsyncRun, artifactId: string | null): void {
    setActiveRunId(run.id);
    setGenerateAction(null);
    setPickerOpen(false);
    if (artifactId !== null) setSelectedId(artifactId);
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
            disabled={eligibleActions.length === 0}
            aria-describedby={
              eligibleActions.length === 0 ? "sf-gen-note" : undefined
            }
          >
            {t("generate")}
          </Button>
          {eligibleActions.length === 0 ? (
            <p id="sf-gen-note" className={styles.heroNote}>
              {t("noActions")}
            </p>
          ) : null}
        </div>
      </header>

      {activeRunId !== null && runQuery.data !== undefined ? (
        <RunBanner run={runQuery.data} message={t("generating")} />
      ) : null}

      {generateAction !== null ? (
        <GenerateForm
          projectId={projectId}
          action={generateAction}
          project={projectQuery.data}
          onQueued={onQueued}
          onCancel={() => setGenerateAction(null)}
        />
      ) : pickerOpen ? (
        <ActionPicker
          actions={eligibleActions}
          liveKeys={liveKeys}
          onPick={openGenerate}
          onCancel={() => setPickerOpen(false)}
        />
      ) : null}

      {selected !== null ? (
        <ArtifactEditor
          key={`${selected.id}:${selected.currentRevision}`}
          projectId={projectId}
          artifact={selected}
          onClose={() => setSelectedId(null)}
        />
      ) : null}

      {artifacts.length === 0 ? (
        <StateWrap>
          <EmptyState title={t("emptyTitle")} description={t("emptyHint")} />
        </StateWrap>
      ) : (
        <div className={styles.groups}>
          {groups.map(([type, list]) => (
            <section
              key={type}
              className={styles.group}
              aria-label={t(`artifactType.${type}`)}
            >
              <div className={styles.groupHead}>
                <h2 className={styles.groupTitle}>
                  {t(`artifactType.${type}`)}
                </h2>
                <Badge>{String(list.length)}</Badge>
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
                      onOpen={() => setSelectedId(artifact.id)}
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
          ))}
        </div>
      )}
    </div>
  );
}
