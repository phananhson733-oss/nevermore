// This component inherits the client boundary from _diagnosis.tsx. Keeping it
// out of a separate client entry allows the canonical refetch callback prop.

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Eye, Link2 } from "lucide-react";
import {
  Badge,
  Button,
  Field,
  StatusPill,
  TextArea,
  cx,
  type StatusTone,
} from "@/components/ui";
import { ApiError } from "@/lib/api";
import {
  useReviewFinding,
  type Confidence,
  type Finding,
  type ReviewFindingRequest,
  type Severity,
} from "@/lib/api/hooks-diagnosis";
import { ProblemNotice } from "../_problem-display";
import { evidenceForFinding } from "../_view-model.ts";
import { EvidenceDrawer } from "./_evidence-drawer.tsx";
import styles from "./diagnosis.module.css";

function severityTone(severity: Severity): StatusTone {
  switch (severity) {
    case "critical":
      return "danger";
    case "high":
      return "warning";
    case "medium":
      return "info";
    default:
      return "neutral";
  }
}

function confidenceTone(confidence: Confidence): StatusTone {
  switch (confidence) {
    case "high":
      return "success";
    case "medium":
      return "info";
    case "low":
      return "warning";
    default:
      return "neutral";
  }
}

function reviewStateTone(state: Finding["reviewState"]): StatusTone {
  switch (state) {
    case "confirmed":
      return "success";
    case "ignored":
      return "neutral";
    case "needs_more_data":
      return "warning";
    default:
      return "info";
  }
}

type ReviewMode = "idle" | "ignore" | "needs_more_data";

interface CreatedAction {
  readonly id: string;
  readonly title: string;
}

/**
 * One compact diagnostic row. Canonical finding and review fields stay in the
 * row; the denser provenance tree opens in the modal evidence drawer.
 */
export function FindingCard({
  projectId,
  finding,
  index,
  onRefetch,
}: {
  readonly projectId: string;
  readonly finding: Finding;
  readonly index: number;
  readonly onRefetch: () => void;
}) {
  const t = useTranslations("diagnosis");
  const tCommon = useTranslations("common");
  const tReview = useTranslations("reviewState");
  const tSeverity = useTranslations("priorityBand");
  const tRule = useTranslations("ruleTitle");
  const tDomain = useTranslations("domain");
  const review = useReviewFinding(projectId);
  const evidenceTriggerRef = useRef<HTMLButtonElement>(null);
  const canonicalEvidence = evidenceForFinding(finding.evidence);
  const findingTitle = tRule(finding.ruleId);

  const [mode, setMode] = useState<ReviewMode>("idle");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [problemError, setProblemError] = useState<unknown | null>(null);
  const [createdAction, setCreatedAction] = useState<CreatedAction | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  function handleReviewError(err: unknown): void {
    if (err instanceof ApiError) {
      if (err.code === "VERSION_CONFLICT") {
        setError(t("reviewConflict"));
        setProblemError(err);
        onRefetch();
        return;
      }
      setError(t("reviewError"));
      setProblemError(err);
      return;
    }
    setError(t("reviewError"));
    setProblemError(null);
  }

  async function submit(body: ReviewFindingRequest): Promise<void> {
    setError(null);
    setProblemError(null);
    try {
      const result = await review.mutateAsync({ findingId: finding.id, body });
      setMode("idle");
      setText("");
      setCreatedAction(
        body.reviewState === "confirmed"
          ? result.action === null
            ? null
            : { id: result.action.id, title: result.action.title }
          : null,
      );
      onRefetch();
    } catch (err) {
      handleReviewError(err);
    }
  }

  function onConfirm(): void {
    void submit({
      reviewState: "confirmed",
      baseRevision: finding.reviewRevision,
    });
  }

  function onSubmitText(): void {
    const trimmed = text.trim();
    if (mode === "ignore") {
      if (trimmed.length < 3) {
        setError(t("reasonTooShort"));
        setProblemError(null);
        return;
      }
      void submit({
        reviewState: "ignored",
        baseRevision: finding.reviewRevision,
        reason: trimmed,
      });
    } else if (mode === "needs_more_data") {
      if (trimmed.length < 3) {
        setError(t("noteTooShort"));
        setProblemError(null);
        return;
      }
      void submit({
        reviewState: "needs_more_data",
        baseRevision: finding.reviewRevision,
        note: trimmed,
      });
    }
  }

  function openForm(next: ReviewMode): void {
    setMode(next);
    setText("");
    setError(null);
    setProblemError(null);
  }

  const isNeedsData = finding.reviewState === "needs_more_data";
  const busy = review.isPending;
  const articleId = `sf-finding-${finding.id}`;

  return (
    <article
      className={cx(
        styles.findingCard,
        isNeedsData && styles.findingCardMuted,
      )}
      data-finding-row=""
      data-severity={finding.severity}
      aria-labelledby={articleId}
    >
      <div className={styles.findingIndex} aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </div>

      <div className={styles.findingBody}>
        <header className={styles.findingHead}>
          <span className={styles.findingEyebrow}>
            {`${tDomain(finding.domain)} · ${finding.ruleId}`}
          </span>
          <h3 id={articleId} className={styles.findingTitle}>
            {findingTitle}
          </h3>
        </header>

        <p className={styles.findingSummary}>{finding.summary}</p>

        <div className={styles.findingMeta}>
          <StatusPill tone={confidenceTone(finding.confidence)}>
            {`${t("confidenceLabel")}: ${t(`confidence.${finding.confidence}`)}`}
          </StatusPill>
          <StatusPill tone={reviewStateTone(finding.reviewState)}>
            {tReview(finding.reviewState)}
          </StatusPill>
          <span className={styles.evidenceCount}>
            <Link2 aria-hidden="true" size={14} />
            {t("evidenceCount", { count: canonicalEvidence.length })}
          </span>
          {finding.regressed ? (
            <Badge tone="coral">{t("regressed")}</Badge>
          ) : null}
          {finding.subjectRefs.length > 0 ? (
            <ul
              className={styles.subjectList}
              aria-label={t("subjectsLabel")}
            >
              {finding.subjectRefs.map((ref, subjectIndex) => (
                <li
                  key={`${ref.type}:${ref.value}:${subjectIndex}`}
                  className={styles.subjectItem}
                >
                  <Badge>{ref.type}</Badge>
                  <span className={styles.subjectValue}>{ref.value}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className={styles.findingFooter}>
          {canonicalEvidence[0] !== undefined ? (
            <p className={styles.evidencePreview}>
              <span>{t("evidenceLabel")}</span>
              {canonicalEvidence[0].claim}
            </p>
          ) : (
            <p className={styles.evidenceEmpty}>{t("evidence.none")}</p>
          )}

          {createdAction !== null ? (
            <div className={styles.actionCreated} role="status">
              <span>{`${t("actionCreated")} ${createdAction.title}`}</span>
              <Link
                className={styles.actionCreatedLink}
                href={`/p/${projectId}/execution?actionId=${createdAction.id}`}
              >
                {t("generateAction")}
              </Link>
            </div>
          ) : null}

          <div className={styles.reviewBar}>
            <span className={styles.reviewLabel}>{t("reviewFinding")}</span>
            <div className={styles.reviewButtons}>
              <Button
                size="sm"
                variant="primary"
                onClick={onConfirm}
                disabled={busy}
              >
                {t("confirm")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => openForm("ignore")}
                disabled={busy}
                aria-expanded={mode === "ignore"}
              >
                {t("ignore")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => openForm("needs_more_data")}
                disabled={busy}
                aria-expanded={mode === "needs_more_data"}
              >
                {t("needsMoreData")}
              </Button>
            </div>

            {mode !== "idle" ? (
              <div className={styles.reviewForm}>
                <Field
                  label={mode === "ignore" ? t("reason") : t("note")}
                  help={mode === "ignore" ? t("reasonHelp") : t("noteHelp")}
                  required
                  error={error ?? undefined}
                >
                  <TextArea
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    rows={3}
                  />
                </Field>
                <div className={styles.reviewActions}>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={onSubmitText}
                    disabled={busy}
                  >
                    {t("submitReview")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openForm("idle")}
                    disabled={busy}
                  >
                    {tCommon("cancel")}
                  </Button>
                </div>
              </div>
            ) : null}

            {mode === "idle" && error !== null ? (
              problemError !== null ? (
                <ProblemNotice
                  className={styles.reviewError}
                  error={problemError}
                  message={error}
                  compact
                />
              ) : (
                <p className={styles.reviewError} role="alert">
                  {error}
                </p>
              )
            ) : null}
          </div>
        </div>
      </div>

      <div className={styles.findingAside}>
        <StatusPill tone={severityTone(finding.severity)}>
          {tSeverity(finding.severity)}
        </StatusPill>
        {canonicalEvidence.length > 0 ? (
          <Button
            ref={evidenceTriggerRef}
            size="sm"
            variant="text"
            className={styles.evidenceTrigger}
            aria-expanded={drawerOpen}
            aria-controls={`sf-finding-${finding.id}-evidence-drawer`}
            onClick={() => setDrawerOpen(true)}
          >
            {t("viewEvidence", { count: canonicalEvidence.length })}
            <Eye aria-hidden="true" size={15} />
          </Button>
        ) : null}
      </div>

      <EvidenceDrawer
        projectId={projectId}
        findingId={finding.id}
        findingTitle={findingTitle}
        findingSummary={finding.summary}
        evidence={canonicalEvidence}
        open={drawerOpen}
        onClose={closeDrawer}
        returnFocusRef={evidenceTriggerRef}
      />
    </article>
  );
}
