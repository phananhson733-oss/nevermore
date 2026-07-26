"use client";

/**
 * "Adjust action" — the Execution rail's Action override entry (R2 blueprint
 * 2026-07-27, D1-D6). The rail carries only a trigger; the full form lives in
 * a modal dialog that replicates the product-profile modal contract
 * (aria-modal, focus trap, Escape, inert background, focus returned to the
 * trigger). Form logic is the Plan OverrideForm ported onto the closed
 * reducer in _action-override-view-model.ts; the dialog content is keyed by
 * `action.id` so no local state can survive across Actions (D3).
 */

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { AlertTriangle, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import { Button, Field, TextArea, cx, useFieldControl } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { uniqueCursorItems } from "@/lib/api/cursor-pages";
import { actionsQueryKey, useUpdateAction } from "@/lib/api/hooks-plan";
import type { ListEnvelope } from "@/lib/api/types";
import type { ArtifactAction } from "@/lib/api/hooks-studio";
import { allowedActionStatusTargets } from "../_action-status-transitions";
import { ProblemNotice } from "../_problem-display";
import { useUnsavedNavigationGuard } from "../_unsaved-navigation-guard.ts";
import {
  OVERRIDE_NOTE_MAX,
  OVERRIDE_REASON_MAX,
  adoptActionIntoPages,
  initialOverrideState,
  isOverrideFormDirty,
  overrideControlsLocked,
  overrideRetryAvailable,
  planOverrideSubmit,
  reduceOverride,
} from "./_action-override-view-model";
import styles from "./studio.module.css";

const PRIORITY_OPTIONS = ["critical", "high", "medium", "low"] as const;
const LANE_OPTIONS = ["now", "next", "later"] as const;

type ActionsCache = InfiniteData<ListEnvelope<ArtifactAction>, string | null>;

// ------------------------------------------------------------ modal frame --

function focusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.getAttribute("aria-hidden") !== "true");
}

/**
 * Modal chrome copied from the product-profile ModalFrame contract: scroll
 * lock, inert + aria-hidden background, focus trap, Escape to request close.
 * Local on purpose — the precedent is a private component of another feature.
 */
function OverrideModalFrame({
  open,
  kind,
  titleId,
  describedBy,
  onRequestClose,
  children,
}: {
  readonly open: boolean;
  readonly kind: "dialog" | "confirm";
  readonly titleId: string;
  readonly describedBy?: string | undefined;
  readonly onRequestClose: () => void;
  readonly children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    // Gate on `mounted` as well: this frame is created on demand with `open`
    // already true, so the first run happens before the portal exists and
    // would otherwise mark the WHOLE document inert and never focus the
    // dialog (the product-profile original always mounts closed).
    if (!open || !mounted) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const background = Array.from(document.body.children).filter(
      (element) => !element.hasAttribute("data-action-override-backdrop"),
    );
    const backgroundState = background.map((element) => ({
      element,
      ariaHidden: element.getAttribute("aria-hidden"),
      inert: element.hasAttribute("inert"),
    }));
    background.forEach((element) => {
      element.setAttribute("aria-hidden", "true");
      element.setAttribute("inert", "");
    });
    const focusFrame = requestAnimationFrame(() =>
      focusable(frameRef.current ?? document.body)[0]?.focus(),
    );
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onRequestClose();
        return;
      }
      if (event.key !== "Tab" || !frameRef.current) return;
      const items = focusable(frameRef.current);
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      backgroundState.forEach(({ element, ariaHidden, inert }) => {
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
        if (!inert) element.removeAttribute("inert");
      });
    };
  }, [mounted, onRequestClose, open]);
  if (!mounted || !open) return null;
  return createPortal(
    <div
      className={styles.overrideBackdrop}
      data-action-override-backdrop=""
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onRequestClose();
      }}
    >
      <div
        ref={frameRef}
        className={
          kind === "dialog" ? styles.overrideDialog : styles.overrideConfirmBox
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        {...(kind === "dialog"
          ? { "data-action-override-dialog": "" }
          : { "data-action-override-discard": "" })}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

// -------------------------------------------------------------- controls ---

interface SelectOption {
  readonly value: string;
  readonly label: string;
}

/** The Plan screen's PlanSelect, ported verbatim onto studio styles (D2). */
function OverrideSelect({
  value,
  onChange,
  options,
  keepLabel,
  disabled,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly SelectOption[];
  readonly keepLabel: string;
  readonly disabled: boolean;
}) {
  const field = useFieldControl();
  return (
    <select
      className={cx(styles.select, field?.invalid && styles.selectInvalid)}
      id={field?.controlId}
      aria-describedby={field?.describedBy}
      aria-invalid={field?.invalid || undefined}
      value={value}
      disabled={disabled}
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

// ---------------------------------------------------------------- dialog ---

function OverrideDialog({
  projectId,
  action,
  onClose,
}: {
  readonly projectId: string;
  readonly action: ArtifactAction;
  readonly onClose: () => void;
}) {
  const t = useTranslations("studio.override");
  const tCommon = useTranslations("common");
  const tStatus = useTranslations("actionStatus");
  const tPriority = useTranslations("priorityBand");
  const tLane = useTranslations("lane");
  const queryClient = useQueryClient();
  const update = useUpdateAction(projectId);
  // The third-argument initializer freezes the baseline at open. Later prop
  // updates (background list refetches) never re-run it, so an in-progress
  // edit keeps measuring against the revision the operator actually saw;
  // only the reducer's own `refreshResolved` may advance the baseline.
  const [state, dispatch] = useReducer(
    reduceOverride,
    action,
    (opened: ArtifactAction) =>
      initialOverrideState({
        id: opened.id,
        title: opened.title,
        status: opened.status,
        priorityBand: opened.priorityBand,
        roadmapLane: opened.roadmapLane,
        revision: opened.revision,
      }),
  );
  const [discardOpen, setDiscardOpen] = useState(false);
  // Synchronous single-flight fence (R1 precedent): the reducer's machine
  // fence cannot reject a second click inside the same tick, this ref can.
  const submitInFlight = useRef(false);

  const baseline = state.baseline;
  const dirty = isOverrideFormDirty(state.form);
  const locked = overrideControlsLocked(state);
  const submitting = state.phase === "submitting";
  const retryAvailable = overrideRetryAvailable(state);
  const titleId = "sf-action-override-title";
  const descId = "sf-action-override-desc";

  const discardAndClose = useCallback(() => {
    setDiscardOpen(false);
    onClose();
  }, [onClose]);

  // Browser back/refresh guard for a dirty dialog. No `confirmLinkClick`:
  // the shell is inert while the modal is open, so a link-click listener
  // could never run (see _unsaved-navigation-guard.ts on R4). While the
  // PATCH is in flight the guard stays armed even for a nominally clean
  // form: the browser-level prompt is the only fence left on an unload.
  useUnsavedNavigationGuard({
    dirty: dirty || submitting,
    confirmationMessage: t("unsavedLeaveWarning"),
    discardChanges: discardAndClose,
  });

  const requestClose = useCallback(() => {
    // No exit while the PATCH is in flight: a "Discard" offered here would
    // promise to drop changes that the already-sent request may still apply.
    if (submitting) return;
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  }, [dirty, onClose, submitting]);

  const statusOptions: readonly SelectOption[] = allowedActionStatusTargets(
    baseline.status,
  ).map((value) => ({ value, label: tStatus(value) }));
  const priorityOptions: readonly SelectOption[] = PRIORITY_OPTIONS.map(
    (value) => ({ value, label: tPriority(value) }),
  );
  const laneOptions: readonly SelectOption[] = LANE_OPTIONS.map((value) => ({
    value,
    label: tLane(value),
  }));

  async function refreshConflict(): Promise<void> {
    try {
      await queryClient.refetchQueries(
        { queryKey: actionsQueryKey(projectId), type: "active" },
        { throwOnError: true },
      );
      const cached = queryClient.getQueryData<ActionsCache>(
        actionsQueryKey(projectId),
      );
      const refreshed = uniqueCursorItems(cached).find(
        (item) => item.id === action.id,
      );
      dispatch({ type: "refreshResolved", refreshed });
    } catch (caught) {
      dispatch({ type: "refreshFailed", problem: caught });
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitInFlight.current) return;
    if (locked) return;
    const plan = planOverrideSubmit(baseline, state.form);
    if (plan.kind !== "submit") {
      dispatch({ type: "reject", notice: plan.kind });
      return;
    }
    submitInFlight.current = true;
    dispatch({ type: "submit" });
    try {
      const updated = await update.mutateAsync({
        actionId: action.id,
        body: plan.body,
      });
      // The hook has already invalidated + refetched; this guarded write only
      // applies when that refetch failed or raced, so the successful response
      // is what the badge and keep labels render either way (D5).
      queryClient.setQueryData<ActionsCache>(
        actionsQueryKey(projectId),
        (data) => adoptActionIntoPages(data, updated),
      );
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "VERSION_CONFLICT") {
        dispatch({
          type: "conflict",
          submittedRevision: plan.body.baseRevision,
          problem: caught,
        });
        await refreshConflict();
      } else {
        dispatch({ type: "requestFailed", problem: caught });
      }
    } finally {
      submitInFlight.current = false;
    }
  }

  function onRetryRefresh(): void {
    if (!retryAvailable) return;
    dispatch({ type: "retryRefresh" });
    void refreshConflict();
  }

  const noticeMessage =
    state.notice === null
      ? null
      : {
          reasonRequired: t("reasonRequired"),
          reasonTooLong: t("reasonTooLong"),
          noteTooLong: t("noteTooLong"),
          noChange: t("noChange"),
          requestFailed: tCommon("error"),
          conflictStale: t("conflict"),
          conflictTransition: t("conflictTransition"),
          conflictRefreshFailed: t("conflictRefreshFailed"),
        }[state.notice];

  return (
    <>
      <OverrideModalFrame
        open={!discardOpen}
        kind="dialog"
        titleId={titleId}
        describedBy={descId}
        onRequestClose={requestClose}
      >
        <form
          className={styles.overrideForm}
          onSubmit={(event) => void onSubmit(event)}
          data-action-override-form=""
        >
          <div className={styles.overrideHead}>
            <div className={styles.overrideHeadText}>
              <span className={styles.sectionKicker}>
                {t("overrideKicker")}
              </span>
              <h2 id={titleId} className={styles.overrideTitle}>
                {t("overrideTitle")}
              </h2>
              <p id={descId} className={styles.overrideDesc}>
                {t("overrideDescription")}
              </p>
            </div>
            <button
              type="button"
              className={styles.overrideClose}
              onClick={requestClose}
              disabled={submitting}
              aria-label={tCommon("close")}
            >
              <X aria-hidden="true" size={21} />
            </button>
          </div>

          <div className={styles.overrideGrid}>
            <Field label={t("newStatus")}>
              <OverrideSelect
                value={state.form.statusSel}
                onChange={(value) =>
                  dispatch({ type: "edit", patch: { statusSel: value } })
                }
                options={statusOptions}
                keepLabel={`${t("keepUnchanged")} — ${tStatus(baseline.status)}`}
                disabled={locked}
              />
            </Field>
            <Field label={t("newPriority")}>
              <OverrideSelect
                value={state.form.prioritySel}
                onChange={(value) =>
                  dispatch({ type: "edit", patch: { prioritySel: value } })
                }
                options={priorityOptions}
                keepLabel={`${t("keepUnchanged")} — ${tPriority(baseline.priorityBand)}`}
                disabled={locked}
              />
            </Field>
            <Field label={t("newLane")}>
              <OverrideSelect
                value={state.form.laneSel}
                onChange={(value) =>
                  dispatch({ type: "edit", patch: { laneSel: value } })
                }
                options={laneOptions}
                keepLabel={`${t("keepUnchanged")} — ${tLane(baseline.roadmapLane)}`}
                disabled={locked}
              />
            </Field>
          </div>

          <Field label={t("reason")} help={t("reasonHelp")} required>
            <TextArea
              value={state.form.reason}
              onChange={(event) =>
                dispatch({
                  type: "edit",
                  patch: { reason: event.target.value },
                })
              }
              rows={3}
              maxLength={OVERRIDE_REASON_MAX}
              placeholder={t("reasonPlaceholder")}
              disabled={locked}
            />
          </Field>

          <Field label={t("note")} help={t("noteOptional")}>
            <TextArea
              value={state.form.note}
              onChange={(event) =>
                dispatch({ type: "edit", patch: { note: event.target.value } })
              }
              rows={2}
              maxLength={OVERRIDE_NOTE_MAX}
              placeholder={t("notePlaceholder")}
              disabled={locked}
            />
          </Field>

          <p className={styles.overrideKept}>
            <ShieldCheck aria-hidden="true" size={16} />
            <span>{t("overrideKept")}</span>
          </p>

          {noticeMessage !== null ? (
            state.problem !== null ? (
              <ProblemNotice
                className={styles.overrideError}
                error={state.problem}
                message={noticeMessage}
                onRetry={retryAvailable ? onRetryRefresh : undefined}
                compact
              />
            ) : (
              <p className={styles.overrideError} role="alert">
                {noticeMessage}
              </p>
            )
          ) : null}

          <div className={styles.overrideActions}>
            <Button
              type="button"
              variant="ghost"
              onClick={requestClose}
              disabled={state.phase === "submitting"}
            >
              {tCommon("cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={locked}>
              {state.phase === "submitting"
                ? t("applying")
                : t("applyOverride")}
            </Button>
          </div>
        </form>
      </OverrideModalFrame>

      <OverrideModalFrame
        open={discardOpen}
        kind="confirm"
        titleId="sf-action-override-discard-title"
        onRequestClose={() => setDiscardOpen(false)}
      >
        <div className={styles.overrideConfirm}>
          <AlertTriangle size={24} aria-hidden="true" />
          <h2 id="sf-action-override-discard-title">{t("discardTitle")}</h2>
          <p>{t("discardDescription")}</p>
          <div className={styles.overrideConfirmActions}>
            <Button variant="secondary" onClick={() => setDiscardOpen(false)}>
              {t("keepEditing")}
            </Button>
            <Button
              variant="primary"
              className={styles.overrideDanger}
              onClick={discardAndClose}
            >
              {t("discard")}
            </Button>
          </div>
        </div>
      </OverrideModalFrame>
    </>
  );
}

// --------------------------------------------------------------- trigger ---

/**
 * Rail-mounted trigger + dialog owner. Mount with `key={action.id}` so the
 * open flag itself cannot survive an Action switch.
 *
 * `editorDirty` disables the trigger while the artifact editor holds an
 * unsaved draft. Two independently dirty editors would each arm the shared
 * navigation guard, and a browser Back would then chain two confirms — the
 * first of which discards silently once the second is refused. Excluding the
 * second dirty editor at its entry point removes that state entirely.
 */
export function ActionOverride({
  projectId,
  action,
  editorDirty,
}: {
  readonly projectId: string;
  readonly action: ArtifactAction;
  readonly editorDirty: boolean;
}) {
  const t = useTranslations("studio.override");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const blockedHintId = "sf-action-override-editor-hint";

  const close = useCallback(() => {
    setOpen(false);
    // After the modal cleanup restores the inert background, hand focus back
    // to the trigger (product-profile precedent).
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.overrideTrigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby={editorDirty ? blockedHintId : undefined}
        disabled={editorDirty}
        data-studio-adjust-action=""
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal aria-hidden="true" size={15} />
        {t("override")}
      </button>
      {editorDirty ? (
        <p id={blockedHintId} className={styles.overrideTriggerHint}>
          {t("blockedByEditor")}
        </p>
      ) : null}
      {open ? (
        <OverrideDialog
          key={action.id}
          projectId={projectId}
          action={action}
          onClose={close}
        />
      ) : null}
    </>
  );
}
