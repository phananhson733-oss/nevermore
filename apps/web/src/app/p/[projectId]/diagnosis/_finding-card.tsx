// No "use client" here: this component inherits the client boundary from its
// parent (_diagnosis.tsx). A redundant directive makes it a client ENTRY, which
// forbids the non-serializable `onRefetch` function prop (Next INVALID_CLIENT_ENTRY_PROP).

/**
 * A single diagnostic finding with its evidence and review controls (spec §8).
 * Evidence honesty (spec §1.3): grade A/B/C is shown verbatim and an unavailable
 * measure reads "unavailable", never 0. Review carries `baseRevision` for
 * optimistic concurrency; a 409 `VERSION_CONFLICT` refetches the list + informs.
 */

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
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
  type Availability,
  type Confidence,
  type Evidence,
  type EvidenceSupport,
  type Finding,
  type ReviewFindingRequest,
  type Severity,
} from "@/lib/api/hooks-diagnosis";
import { ProblemNotice } from "../_problem-display";
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

function availabilityTone(availability: Availability): StatusTone {
  switch (availability) {
    case "available":
      return "success";
    case "partial":
      return "warning";
    default:
      return "neutral";
  }
}

function supportTone(support: EvidenceSupport): StatusTone {
  switch (support) {
    case "supports":
      return "success";
    case "contradicts":
      return "danger";
    default:
      return "info";
  }
}

function formatObservedAt(value: string, locale: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

function EvidenceTrace({
  evidence,
  findingId,
  open,
  onOpenChange,
}: {
  readonly evidence: Evidence;
  readonly findingId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("diagnosis");
  const tCommon = useTranslations("common");
  const tProvider = useTranslations("provider");
  const tSourceState = useTranslations("sourceState");
  const locale = useLocale();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const detailsId = `sf-finding-${findingId}-evidence-${evidence.id}-details`;
  const observedAt = formatObservedAt(evidence.observedAt, locale);
  const sourceProvider =
    evidence.sourceProvider === "system" || evidence.sourceProvider === "llm"
      ? t(`evidence.provider.${evidence.sourceProvider}`)
      : tProvider(evidence.sourceProvider);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onOpenChange(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onOpenChange, open]);

  return (
    <li className={styles.evidenceItem}>
      <div
        className={styles.evidenceTrace}
        role="group"
        aria-label={t("evidence.cardLabel", { claim: evidence.claim })}
      >
        <div className={styles.evidenceHead}>
          <Badge
            aria-label={`${t("evidence.sourceProvider")}: ${sourceProvider}`}
          >
            {sourceProvider}
          </Badge>
          <StatusPill
            tone={availabilityTone(evidence.availability)}
            aria-label={`${t("evidence.availability")}: ${tSourceState(evidence.availability)}`}
          >
            {tSourceState(evidence.availability)}
          </StatusPill>
          <StatusPill
            tone={supportTone(evidence.support)}
            aria-label={`${t("evidence.supportLabel")}: ${t(`evidence.support.${evidence.support}`)}`}
          >
            {t(`evidence.support.${evidence.support}`)}
          </StatusPill>
          <Badge>{t("gradeLabel", { grade: evidence.grade })}</Badge>
        </div>
        <p className={styles.evidenceClaim}>{evidence.claim}</p>
        <p className={styles.evidenceObserved}>
          {t("evidence.observedAt", {
            date: observedAt ?? tCommon("unavailable"),
          })}
        </p>
        <Button
          ref={triggerRef}
          size="sm"
          variant="ghost"
          className={styles.evidenceToggle}
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => onOpenChange(!open)}
        >
          {open ? t("evidence.hideDetails") : t("evidence.showDetails")}
        </Button>
        <div
          id={detailsId}
          className={styles.evidenceDetails}
          role="region"
          aria-label={t("evidence.detailsLabel", { claim: evidence.claim })}
          hidden={!open}
        >
          <dl className={styles.evidenceDetailList}>
            <div className={styles.evidenceDetailRow}>
              <dt>{t("evidence.origin")}</dt>
              <dd>{evidence.origin || tCommon("unavailable")}</dd>
            </div>
            <div className={styles.evidenceDetailRow}>
              <dt>{t("evidence.method")}</dt>
              <dd>{evidence.method || tCommon("unavailable")}</dd>
            </div>
            <div className={styles.evidenceDetailRow}>
              <dt>{t("evidence.limitation")}</dt>
              <dd>{evidence.limitation || tCommon("unavailable")}</dd>
            </div>
          </dl>
          <div className={styles.evidenceSubjects}>
            <span className={styles.subLabel}>{t("evidence.subjects")}</span>
            {evidence.subjectRefs.length > 0 ? (
              <ul className={styles.subjectList}>
                {evidence.subjectRefs.map((subject, index) => (
                  <li
                    key={`${subject.type}:${subject.value}:${index}`}
                    className={styles.subjectItem}
                  >
                    <Badge>{subject.type}</Badge>
                    <span className={styles.subjectValue}>{subject.value}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.evidenceEmptyDetail}>
                {t("evidence.noSubjects")}
              </p>
            )}
          </div>
        </div>
      </div>
    </li>
  );
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
  const tDomain = useTranslations("domain");
  const review = useReviewFinding(projectId);

  const [mode, setMode] = useState<ReviewMode>("idle");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [problemError, setProblemError] = useState<unknown | null>(null);
  const [createdAction, setCreatedAction] = useState<string | null>(null);
  const [expandedEvidenceId, setExpandedEvidenceId] = useState<string | null>(
    null,
  );

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
          ? (result.action?.title ?? null)
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

  return (
    <article
      className={cx(
        styles.findingCard,
        isNeedsData && styles.findingCardMuted,
      )}
      aria-labelledby={`sf-finding-${finding.id}`}
    >
      <header className={styles.findingHead}>
        <div className={styles.findingTitleWrap}>
          <span className={styles.findingEyebrow}>
            {`${tDomain(finding.domain)} · ${finding.ruleId}`}
          </span>
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
        {finding.evidence.length > 0 ? (
          <ul className={styles.evidenceList}>
            {evidenceForFinding(finding.evidence).map((ev) => (
              <EvidenceTrace
                key={ev.id}
                evidence={ev}
                findingId={finding.id}
                open={expandedEvidenceId === ev.id}
                onOpenChange={(nextOpen) =>
                  setExpandedEvidenceId(nextOpen ? ev.id : null)
                }
              />
            ))}
          </ul>
        ) : (
          <p className={styles.evidenceEmpty}>{t("evidence.none")}</p>
        )}
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
    </article>
  );
}
