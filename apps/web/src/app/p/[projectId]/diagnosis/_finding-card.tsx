// No "use client" here: this component inherits the client boundary from its
// parent (_diagnosis.tsx). A redundant directive makes it a client ENTRY, which
// forbids the non-serializable `onRefetch` function prop (Next INVALID_CLIENT_ENTRY_PROP).

/**
 * A single diagnostic finding with its evidence and review controls (spec §8).
 * Evidence honesty (spec §1.3): grade A/B/C is shown verbatim and an unavailable
 * measure reads "unavailable", never 0. Review carries `baseRevision` for
 * optimistic concurrency; a 409 `VERSION_CONFLICT` refetches the list + informs.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
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
import { evidenceForFinding } from "../_view-model.ts";
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

export function FindingCard({
  projectId,
  finding,
  onRefetch,
}: {
  readonly projectId: string;
  readonly finding: Finding;
  readonly onRefetch: () => void;
}) {
  const t = useTranslations("diagnosis");
  const tCommon = useTranslations("common");
  const tReview = useTranslations("reviewState");
  const tSeverity = useTranslations("priorityBand");
  const tRule = useTranslations("ruleTitle");
  const review = useReviewFinding(projectId);

  const [mode, setMode] = useState<ReviewMode>("idle");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [createdAction, setCreatedAction] = useState<string | null>(null);

  function handleReviewError(err: unknown): void {
    if (err instanceof ApiError) {
      if (err.code === "VERSION_CONFLICT") {
        setError(t("reviewConflict"));
        onRefetch();
        return;
      }
      const fieldErrors = err.fieldErrors();
      setError(fieldErrors[0]?.message ?? err.message);
      return;
    }
    setError(t("reviewError"));
  }

  async function submit(body: ReviewFindingRequest): Promise<void> {
    setError(null);
    try {
      const result = await review.mutateAsync({ findingId: finding.id, body });
      setMode("idle");
      setText("");
      setCreatedAction(
        body.reviewState === "confirmed"
          ? (result.action?.title ?? null)
          : null,
      );
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
  }

  const isAutoNeedsData = finding.reviewState === "needs_more_data";
  const busy = review.isPending;

  return (
    <article
      className={cx(
        styles.findingCard,
        isAutoNeedsData && styles.findingCardMuted,
      )}
      aria-labelledby={`sf-finding-${finding.id}`}
    >
      <header className={styles.findingHead}>
        <div className={styles.findingTitleWrap}>
          <h3 id={`sf-finding-${finding.id}`} className={styles.findingTitle}>
            {tRule(finding.ruleId)}
          </h3>
          <div className={styles.findingMeta}>
            <StatusPill tone={severityTone(finding.severity)}>
              {`${t("severityLabel")}: ${tSeverity(finding.severity)}`}
            </StatusPill>
            <StatusPill tone={confidenceTone(finding.confidence)}>
              {`${t("confidenceLabel")}: ${t(`confidence.${finding.confidence}`)}`}
            </StatusPill>
            <StatusPill tone={reviewStateTone(finding.reviewState)}>
              {tReview(finding.reviewState)}
            </StatusPill>
            {finding.regressed ? (
              <Badge tone="coral">{t("regressed")}</Badge>
            ) : null}
          </div>
        </div>
      </header>

      <p className={styles.findingSummary}>{finding.summary}</p>

      {isAutoNeedsData ? (
        <p className={styles.autoNote}>{t("autoNote")}</p>
      ) : null}

      {finding.subjectRefs.length > 0 ? (
        <div className={styles.subSection}>
          <span className={styles.subLabel}>{t("subjectsLabel")}</span>
          <ul className={styles.subjectList}>
            {finding.subjectRefs.map((ref, index) => (
              <li key={`${ref.type}:${index}`} className={styles.subjectItem}>
                <Badge>{ref.type}</Badge>
                <span className={styles.subjectValue}>{ref.value}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className={styles.subSection}>
        <span className={styles.subLabel}>{t("evidenceLabel")}</span>
        <ul className={styles.evidenceList}>
          {evidenceForFinding(finding.evidence).map((ev) => (
            <li key={ev.id} className={styles.evidenceItem}>
              <div className={styles.evidenceHead}>
                <Badge tone="accent">
                  {t("gradeLabel", { grade: ev.grade })}
                </Badge>
                <span
                  className={styles.evidenceOrigin}
                >{`${ev.origin} · ${ev.method}`}</span>
                {ev.availability === "unavailable" ? (
                  <StatusPill tone="neutral">
                    {tCommon("unavailable")}
                  </StatusPill>
                ) : null}
              </div>
              <p className={styles.evidenceClaim}>{ev.claim}</p>
            </li>
          ))}
        </ul>
      </div>

      {createdAction !== null ? (
        <p className={styles.actionCreated} role="status">
          {`${t("actionCreated")} ${createdAction}`}
        </p>
      ) : null}

      <div className={styles.reviewBar}>
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
          <p className={styles.reviewError} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </article>
  );
}
