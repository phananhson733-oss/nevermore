"use client";

/**
 * The Growth Map Analysis Refresh trigger (R1). First run and re-run are one
 * control: the server owns the fixed Crawl → optional sources → Growth Audit
 * plan behind one POST. The component owns no server state — sources, the
 * mutation, and the run poll live in TanStack Query, and every transition goes
 * through the closed reducer in
 * `_run-diagnosis-view-model.ts` (blueprint D1-D9).
 */

import { useEffect, useReducer, useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Spinner,
  StatusPill,
  cx,
  type StatusTone,
} from "@/components/ui";
import {
  invalidateAnalysisRefreshTerminalQueries,
  isTerminalRunStatus,
  useCreateAnalysisRefreshRun,
  useProjectRun,
  useProjectSources,
  type RunStatus,
} from "@/lib/api/hooks-sources";
import {
  INITIAL_RUN_DIAGNOSIS_STATE,
  reduceRunDiagnosis,
  runDiagnosisButtonLabelKey,
  runDiagnosisEventFromError,
  runDiagnosisLocked,
  runDiagnosisStatusPill,
  shouldRefreshAfterTerminal,
  showRunStatusReadError,
} from "./_run-diagnosis-view-model.ts";
import styles from "./growth-map.module.css";

type SourceReadState = "loading" | "error" | "ready";

function runStatusTone(status: RunStatus): StatusTone {
  switch (status) {
    case "completed":
      return "success";
    case "partial":
      return "warning";
    case "failed":
      return "danger";
    case "cancelled":
      return "neutral";
    default:
      return "info";
  }
}

export function RunDiagnosis({ projectId }: { readonly projectId: string }) {
  const t = useTranslations("growthMap");
  const tCommon = useTranslations("common");
  const tNav = useTranslations("nav");
  const tProvider = useTranslations("provider");
  const tRun = useTranslations("runState");
  const tSources = useTranslations("sources");
  const queryClient = useQueryClient();
  const sources = useProjectSources(projectId);
  const createRun = useCreateAnalysisRefreshRun(projectId);
  const [state, dispatch] = useReducer(
    reduceRunDiagnosis,
    INITIAL_RUN_DIAGNOSIS_STATE,
  );
  // Synchronous single-flight fence (blueprint D2): the hook mints a fresh
  // Idempotency-Key per attempt, so two racing handler entries would be two
  // server commands. `createRun.isPending` is only the visual disabled state.
  const submitInFlight = useRef(false);

  const runQuery = useProjectRun(
    projectId,
    state.phase === "tracking" && state.trackedRunId !== null
      ? state.trackedRunId
      : "",
  );

  const polledId = runQuery.data?.id;
  const polledStatus = runQuery.data?.status;
  useEffect(() => {
    if (state.phase !== "tracking") return;
    if (polledId === undefined || polledStatus === undefined) return;
    if (polledId !== state.trackedRunId) return;
    if (!isTerminalRunStatus(polledStatus)) return;
    const refresh = shouldRefreshAfterTerminal(state, polledId, polledStatus);
    dispatch({ type: "runTerminal", runId: polledId, status: polledStatus });
    if (refresh) {
      void invalidateAnalysisRefreshTerminalQueries(queryClient, projectId);
    }
  }, [state, polledId, polledStatus, queryClient, projectId]);

  // Keep the existing source read/retry UX, but do not require a previously
  // collected Crawl snapshot: Analysis Refresh owns its required Crawl step.
  const sourceReadState: SourceReadState = sources.isError
    ? "error"
    : sources.data === undefined || sources.isFetching
      ? "loading"
      : "ready";
  const locked = runDiagnosisLocked(state);
  const canRun =
    sourceReadState === "ready" &&
    state.serverGate === null &&
    !locked &&
    !createRun.isPending;

  async function onRun(): Promise<void> {
    if (submitInFlight.current) return;
    if (!canRun) return;
    submitInFlight.current = true;
    dispatch({ type: "submit" });
    try {
      const accepted = await createRun.mutateAsync();
      dispatch({ type: "accepted", runId: accepted.run.id });
    } catch (error) {
      const event = runDiagnosisEventFromError(error);
      dispatch(event);
      if (event.type === "conflict" && event.pointer === null) {
        // The conflict named no locatable run. Refresh the portfolio once so
        // any newly readable audit surfaces; recovery stays explicit (D7).
        void queryClient.invalidateQueries({
          queryKey: ["growth-map", projectId],
          refetchType: "active",
        });
      }
    } finally {
      submitInFlight.current = false;
    }
  }

  // The source gate releases only after a fresh, successful source read: the
  // recheck itself never POSTs, and a failed refetch keeps the gate shut.
  async function onRecheckCrawl(): Promise<void> {
    const refreshed = await sources.refetch();
    if (refreshed.isSuccess) {
      dispatch({ type: "recheckGate", gate: "crawl" });
    }
  }

  const pollErrorVisible = showRunStatusReadError(state, runQuery.isError);
  const showSpinner =
    state.phase === "submitting" || state.phase === "tracking";
  const pillStatus = runDiagnosisStatusPill(state, polledStatus);
  const labelKey = runDiagnosisButtonLabelKey(state);

  const noteId = "sf-growth-map-run-note";
  const note =
    state.serverGate === "context" ? (
      <>
        {t("runNeedsContext")}{" "}
        <Link
          href={`/p/${projectId}/context`}
          className={styles.runDiagnosisLink}
        >
          {tNav("context")}
        </Link>
      </>
    ) : state.serverGate === "crawl" ? (
      <>
        {`${tProvider("crawl")}: ${tSources("connect")} `}
        <Link
          href={`/p/${projectId}/sources`}
          className={styles.runDiagnosisLink}
        >
          {tNav("sources")}
        </Link>
      </>
    ) : sourceReadState === "loading" ? (
      <>{`${tNav("sources")}: ${tCommon("loading")}`}</>
    ) : sourceReadState === "error" ? (
      <>{`${tNav("sources")}: ${tCommon("error")}`}</>
    ) : null;

  return (
    <div className={styles.runDiagnosis} data-run-diagnosis="">
      <div className={styles.runDiagnosisControl}>
        <Button
          variant="primary"
          className={styles.runDiagnosisButton}
          onClick={() => void onRun()}
          disabled={!canRun}
          aria-describedby={note === null ? undefined : noteId}
        >
          {showSpinner || createRun.isPending ? (
            // Decorative here: the button's visible label already announces
            // the busy state, and the named status region below is the single
            // live region this control owns. role comes after Spinner's own
            // default, so it wins; aria-hidden drops the node from the tree.
            <Spinner size="sm" aria-hidden="true" role="presentation" />
          ) : null}
          {t(labelKey)}
        </Button>
        {/* One stable live region (D8); the pill mounts inside it. */}
        <div
          className={styles.runDiagnosisStatus}
          role="status"
          aria-live="polite"
          aria-label={t("runStatusLabel")}
          data-run-diagnosis-status=""
        >
          {pillStatus === null ? null : (
            <StatusPill tone={runStatusTone(pillStatus)}>
              {tRun(pillStatus)}
            </StatusPill>
          )}
        </div>
      </div>
      {note === null ? null : (
        <p id={noteId} className={styles.runDiagnosisNote}>
          {note}
        </p>
      )}
      {state.serverGate === "context" ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => dispatch({ type: "recheckGate", gate: "context" })}
        >
          {t("runRecheckContext")}
        </Button>
      ) : null}
      {state.serverGate === "crawl" ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void onRecheckCrawl()}
          disabled={sources.isFetching}
        >
          {t("runRecheckContext")}
        </Button>
      ) : null}
      {sourceReadState === "error" && state.serverGate === null ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void sources.refetch()}
          disabled={sources.isFetching}
        >
          {tCommon("retry")}
        </Button>
      ) : null}
      {state.runActiveNotice ? (
        <p className={styles.runDiagnosisNotice} data-run-diagnosis-notice="">
          {t("runActive")}
        </p>
      ) : null}
      {state.phase === "conflictUnknown" ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => dispatch({ type: "conflictRecovery" })}
        >
          {tCommon("retry")}
        </Button>
      ) : null}
      {state.submitNotice === null ? null : (
        <p
          className={cx(
            styles.runDiagnosisNotice,
            styles.runDiagnosisNoticeError,
          )}
          data-run-diagnosis-notice=""
        >
          {tCommon("error")}
        </p>
      )}
      {state.terminal?.status === "failed" ? (
        <p
          className={cx(
            styles.runDiagnosisNotice,
            styles.runDiagnosisNoticeError,
          )}
          data-run-diagnosis-notice=""
        >
          {t("runError")}
        </p>
      ) : null}
      {pollErrorVisible ? (
        <>
          <p
            className={cx(
              styles.runDiagnosisNotice,
              styles.runDiagnosisNoticeError,
            )}
            data-run-diagnosis-notice=""
          >
            {t("runStatusReadError")}
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void runQuery.refetch()}
            disabled={runQuery.isFetching}
          >
            {tCommon("retry")}
          </Button>
        </>
      ) : null}
    </div>
  );
}
