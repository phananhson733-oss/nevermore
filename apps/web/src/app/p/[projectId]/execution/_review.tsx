"use client";

/**
 * Human review of one Content Shadow draft revision (Slice 2 Task 8).
 *
 * Three rules run through everything in this file.
 *
 * 1. **A review is of a revision, not of a deliverable.** The revision number
 *    is stated in the header, under the verdict, and inside the confirmation —
 *    and the moment the current revision is not the judged one, the verdict is
 *    marked stale and passing is refused. The server refuses it again.
 *
 * 2. **A disabled control says why, in place.** Never a tooltip, never only in
 *    the side rail: a control a person cannot use and cannot explain is
 *    indistinguishable from a broken one. `aria-describedby` points at the same
 *    sentence a sighted reader gets, and the button is natively `disabled` so a
 *    click cannot reach a handler at all.
 *
 * 3. **Publishing does not exist here, so nothing pretends it does.** The
 *    control is present, permanently disabled, and carries the limit in its own
 *    label. There is no simulated success, no receipt for a write that did not
 *    happen, and no environment-variable branch hiding a real one. What the
 *    review receipt reports instead is a fact: external publishing write, none.
 */

import { useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, StatusPill } from "@/components/ui";
import type { ApiError } from "@/lib/api";
import {
  useReviewContentShadowRevision,
  type ContentShadowReviewReceipt,
} from "@/lib/api/hooks-content-shadow";
import { Overlay } from "./_overlay.tsx";
import type { QaVerdict } from "./_qa-view.ts";
import {
  requiresAcknowledgement,
  reviewBlockReason,
  reviewReceiptId,
  type ArtifactLifecycle,
  type ReviewBlockReason,
} from "./_review-view.ts";
import styles from "./execution.module.css";

const RECEIPT_HASH_CHARS = 16;

/**
 * The i18n key for each refusal.
 *
 * `unsaved_edits` is not reachable from this surface today: the editor lives in
 * the workspace below and owns its own dirty state. It stays in the map because
 * the guard it names is real, and because what actually protects the record is
 * the revision binding — an edit that has landed moves `currentRevision`, and
 * that is refused here and again on the server.
 */
const REASON_KEY: Readonly<Record<ReviewBlockReason, string>> = {
  no_verdict: "noVerdict",
  verdict_stale: "staleVerdict",
  verdict_blocked: "blocked",
  unsaved_edits: "unsavedEdits",
  already_reviewed: "alreadyReviewed",
  not_reviewable: "notReviewable",
};

export interface ReviewSurfaceProps {
  readonly projectId: string;
  readonly flowShadowRunId: string;
  readonly deliverableTitle: string;
  readonly contentHash: string;
  readonly verdict: QaVerdict | null;
  readonly evaluatedRevision: number | null;
  readonly currentRevision: number | null;
  readonly artifactStatus: ArtifactLifecycle | null;
  readonly blockingCount: number;
  readonly briefRevision: number;
  readonly claimCounts: {
    readonly passed: number;
    readonly failed: number;
    readonly unevaluated: number;
  };
}

function formatTimestamp(value: string, locale: string): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

/**
 * The banner that says a review no longer applies.
 *
 * One of the four things that must move together when an edit lands. It is not
 * collapsible and not a toast: it changes what everything below it means.
 */
export function StaleReviewBanner({ revision }: { readonly revision: number }) {
  const t = useTranslations("studio.review");
  return (
    <div className={styles.staleBanner} data-review-stale="">
      <strong>{t("stale.title")}</strong>
      <span>{t("stale.body", { revision })}</span>
    </div>
  );
}

/** The permanently unavailable publish control. */
function PublishBlock() {
  const t = useTranslations("studio.publish");
  return (
    <div className={styles.publishBlock} data-publish-block="">
      <Button
        variant="secondary"
        size="sm"
        disabled
        aria-describedby="sf-publish-note"
        data-publish-button=""
      >
        {t("label")}
      </Button>
      {/* Beside the control, not behind a hover: a limit a reader has to
          discover by pointing at something is a limit most readers never see. */}
      <p id="sf-publish-note" className={styles.publishNote}>
        {t("note")}
      </p>
    </div>
  );
}

function ReceiptRow({
  label,
  value,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly testId?: string;
}) {
  return (
    <div {...(testId === undefined ? {} : { [`data-${testId}`]: "" })}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ReviewReceiptBody({
  receipt,
  deliverableTitle,
}: {
  readonly receipt: ContentShadowReviewReceipt;
  readonly deliverableTitle: string;
}) {
  const t = useTranslations("studio.review.receipt");
  const tQa = useTranslations("studio.qa");
  const locale = useLocale();
  const id = reviewReceiptId(receipt.contentHash, receipt.reviewedRevision);
  const reviewedAt = formatTimestamp(receipt.reviewedAt, locale);

  return (
    <div className={styles.receipt} data-review-receipt="">
      <div className={styles.receiptCheck} aria-hidden="true">
        ✓
      </div>
      <p className={styles.receiptLead}>
        {t("body", { revision: receipt.reviewedRevision })}
      </p>
      <dl className={styles.receiptFacts}>
        <ReceiptRow label={t("id")} value={id ?? "—"} />
        <ReceiptRow label={t("deliverable")} value={deliverableTitle} />
        <ReceiptRow
          label={t("revision")}
          value={tQa("revisionNumber", { revision: receipt.reviewedRevision })}
        />
        <ReceiptRow
          label={t("hash")}
          value={`${receipt.contentHash.slice(0, RECEIPT_HASH_CHARS)}…`}
        />
        <ReceiptRow
          label={t("verdict")}
          value={`${tQa(`verdict.${receipt.verdict}` as "verdict.passed")} · ${tQa(
            "countsInline",
            receipt.claimCounts,
          )}`}
        />
        <ReceiptRow label={t("reviewedAt")} value={reviewedAt ?? "—"} />
        {/* The negative as a row of the table, exactly as it comes off the
            wire: the field has one legal value and cannot drift from the copy. */}
        <ReceiptRow
          label={t("externalWrite")}
          value={t(`externalWriteValue.${receipt.externalPublishingWrite}`)}
          testId="receipt-external-write"
        />
      </dl>
    </div>
  );
}

function BlockedReceiptBody({
  error,
  targetRevision,
}: {
  readonly error: ApiError;
  readonly targetRevision: number;
}) {
  const t = useTranslations("studio.review.blockedReceipt");
  const current = (error.problem as { current?: Record<string, unknown> })
    .current;
  const currentRevision =
    typeof current?.["currentRevision"] === "number"
      ? current["currentRevision"]
      : null;

  return (
    <div className={styles.receipt} data-review-blocked-receipt="">
      <div
        className={`${styles.receiptCheck} ${styles.receiptCheckBlocked}`}
        aria-hidden="true"
      >
        !
      </div>
      <p className={styles.receiptLead}>
        {error.code === "STALE_REVISION" && currentRevision !== null
          ? t("staleBody", { current: currentRevision, target: targetRevision })
          : error.problem.detail}
      </p>
      <dl className={styles.receiptFacts}>
        <ReceiptRow label={t("attempted")} value={t("attemptedValue")} />
        <ReceiptRow label={t("targetRevision")} value={String(targetRevision)} />
        <ReceiptRow
          label={t("currentRevision")}
          value={currentRevision === null ? "—" : String(currentRevision)}
        />
        {/* Not "the request failed": what a reader needs to know is that the
            record is untouched, so that is stated as a fact of its own. */}
        <ReceiptRow
          label={t("changesMade")}
          value={t("changesNone")}
          testId="receipt-changes-made"
        />
      </dl>
    </div>
  );
}

export function ReviewSurface(props: ReviewSurfaceProps) {
  const t = useTranslations("studio.review");
  const tQa = useTranslations("studio.qa");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [receipt, setReceipt] = useState<ContentShadowReviewReceipt | null>(
    null,
  );
  const [blocked, setBlocked] = useState<ApiError | null>(null);
  const passRef = useRef<HTMLButtonElement>(null);
  const review = useReviewContentShadowRevision(
    props.projectId,
    props.flowShadowRunId,
  );

  const reason = reviewBlockReason({
    verdict: props.verdict,
    evaluatedRevision: props.evaluatedRevision,
    currentRevision: props.currentRevision,
    artifactStatus: props.artifactStatus,
    hasUnsavedEdits: false,
  });
  const needsTick = requiresAcknowledgement(props.verdict);
  const reasonId = "sf-review-reason";
  const reasonText =
    reason === null
      ? null
      : t(`disabled.${REASON_KEY[reason]}` as "disabled.noVerdict", {
          revision: props.currentRevision ?? 0,
          count: props.blockingCount,
        });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const revision = props.currentRevision;
    if (revision === null) return;
    review.mutate(
      { baseRevision: revision, acknowledgeFindings: needsTick },
      {
        onSuccess: (value) => {
          setConfirmOpen(false);
          setReceipt(value);
        },
        // A refusal is shown as a refusal. Never retried against the newer
        // revision: that would record a review of text nobody read.
        onError: (error) => {
          setConfirmOpen(false);
          setBlocked(error);
        },
      },
    );
  }

  return (
    <div className={styles.reviewActions} data-review-actions="">
      <div className={styles.actionBlock}>
        <Button
          ref={passRef}
          variant="primary"
          size="sm"
          disabled={reason !== null || review.isPending}
          aria-describedby={reason === null ? undefined : reasonId}
          onClick={() => setConfirmOpen(true)}
          data-review-pass=""
        >
          {review.isPending ? t("passing") : t("pass")}
        </Button>
        {reasonText === null ? null : (
          <p
            id={reasonId}
            className={styles.actionReason}
            data-review-reason=""
          >
            {reasonText}
          </p>
        )}
      </div>

      <PublishBlock />

      <Overlay
        open={confirmOpen}
        shape="modal"
        title={t("confirm.title")}
        subtitle={t("confirm.subtitle", {
          revision: props.currentRevision ?? 0,
        })}
        onClose={() => setConfirmOpen(false)}
        returnFocusRef={passRef}
        testId="review-confirm"
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmOpen(false)}
            >
              {t("confirm.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              form="sf-review-form"
              disabled={review.isPending}
            >
              {t("confirm.submit")}
            </Button>
          </>
        }
      >
        <form id="sf-review-form" onSubmit={submit}>
          <div className={styles.confirmObject}>
            <strong>{props.deliverableTitle}</strong>
            <span>
              {`${tQa("revisionNumber", { revision: props.currentRevision ?? 0 })} · ${tQa(
                "countsInline",
                props.claimCounts,
              )}`}
            </span>
          </div>
          {needsTick ? (
            <label className={styles.checkRow}>
              <input type="checkbox" required data-review-acknowledge="" />
              <span>
                {t("confirm.checkbox", {
                  count: props.claimCounts.failed + props.claimCounts.unevaluated,
                })}
              </span>
            </label>
          ) : null}
          {/* Said before the click, not after it. */}
          <p className={styles.honestyNote}>
            {t("confirm.impact", { revision: props.currentRevision ?? 0 })}
          </p>
        </form>
      </Overlay>

      <Overlay
        open={receipt !== null}
        shape="modal"
        title={t("receipt.title")}
        onClose={() => setReceipt(null)}
        returnFocusRef={passRef}
        testId="review-receipt-overlay"
        footer={
          <Button variant="primary" size="sm" onClick={() => setReceipt(null)}>
            {t("receipt.done")}
          </Button>
        }
      >
        {receipt === null ? null : (
          <ReviewReceiptBody
            receipt={receipt}
            deliverableTitle={props.deliverableTitle}
          />
        )}
      </Overlay>

      <Overlay
        open={blocked !== null}
        shape="modal"
        title={t("blockedReceipt.title")}
        onClose={() => setBlocked(null)}
        returnFocusRef={passRef}
        testId="review-blocked-overlay"
        footer={
          <Button variant="primary" size="sm" onClick={() => setBlocked(null)}>
            {t("receipt.done")}
          </Button>
        }
      >
        {blocked === null ? null : (
          <BlockedReceiptBody
            error={blocked}
            targetRevision={props.currentRevision ?? 0}
          />
        )}
      </Overlay>
    </div>
  );
}

export interface RevisionHistoryProps {
  readonly currentRevision: number | null;
  readonly evaluatedRevision: number | null;
  readonly revisions: readonly RevisionHistoryEntry[];
}

export interface RevisionHistoryEntry {
  readonly revision: number;
  readonly hash: string | null;
  readonly createdAt: string | null;
  readonly generatedBy: string;
  readonly note: string | null;
  readonly validationErrorCount: number;
  readonly isCurrent: boolean;
  readonly isJudged: boolean;
}

/**
 * A revision-history drawer must list the actual revisions the payload carries.
 *
 * The older three-row version stated "what this screen holds", which was true
 * only because the screen did not have access to a fuller list. Once the live
 * artifact exposes revision records, continuing to flatten them into
 * current/judged/brief would hide state a reviewer can act on: when each
 * revision was created, what status it reached, which frozen hash names it, and
 * whether a decision was ever recorded for it.
 */
export function RevisionHistory({
  currentRevision,
  evaluatedRevision,
  revisions,
}: RevisionHistoryProps) {
  const t = useTranslations("studio.review.history");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const superseded =
    evaluatedRevision !== null &&
    currentRevision !== null &&
    evaluatedRevision !== currentRevision;

  return (
    <>
      <Button
        ref={buttonRef}
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        data-review-history=""
      >
        {superseded ? t("buttonSuperseded") : t("button")}
      </Button>
      <Overlay
        open={open}
        shape="drawer"
        title={t("title")}
        subtitle={t("subtitle")}
        onClose={() => setOpen(false)}
        returnFocusRef={buttonRef}
        testId="review-history-overlay"
      >
        {revisions.length === 0 ? (
          <p className={styles.honestyNote}>{t("empty")}</p>
        ) : (
          <ul className={styles.historyList} data-review-history-list="">
            {revisions.map((entry) => {
              const createdAt =
                entry.createdAt === null
                  ? t("fieldUnavailable")
                  : (formatTimestamp(entry.createdAt, locale) ??
                    t("fieldUnavailable"));
              const hashValue =
                entry.hash === null
                  ? t("fieldUnavailable")
                  : `${entry.hash.slice(0, RECEIPT_HASH_CHARS)}…`;
              const isCurrent =
                entry.isCurrent || currentRevision === entry.revision;
              const isJudged = entry.isJudged || evaluatedRevision === entry.revision;
              return (
                <li key={entry.revision} data-review-history-item="">
                  <div className={styles.historyHeader}>
                    <div className={styles.historyBadges}>
                      {isCurrent ? (
                        <StatusPill tone="success">
                          {t("badgeCurrent")}
                        </StatusPill>
                      ) : null}
                      {isJudged ? (
                        <StatusPill tone={superseded ? "warning" : "neutral"}>
                          {superseded ? t("badgeSuperseded") : t("badgeJudged")}
                        </StatusPill>
                      ) : null}
                    </div>
                    <strong>{t("revisionRow", { revision: entry.revision })}</strong>
                  </div>
                  <dl className={styles.historyFacts}>
                    <div>
                      <dt>{t("fields.generatedBy")}</dt>
                      <dd>{entry.generatedBy}</dd>
                    </div>
                    <div>
                      <dt>{t("fields.hash")}</dt>
                      <dd>{hashValue}</dd>
                    </div>
                    <div>
                      <dt>{t("fields.createdAt")}</dt>
                      <dd>{createdAt}</dd>
                    </div>
                    <div>
                      <dt>{t("fields.validation")}</dt>
                      <dd>
                        {t("validation", { count: entry.validationErrorCount })}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("fields.note")}</dt>
                      <dd>{entry.note ?? t("fieldUnavailable")}</dd>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ul>
        )}
        <p className={styles.honestyNote}>{t("note")}</p>
      </Overlay>
    </>
  );
}
