"use client";

import type { HTMLAttributes } from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, cx } from "@/components/ui";
import {
  summarizeProblem,
  type ProblemSummary,
} from "./_problem-summary";
import styles from "./_problem-display.module.css";

function ProblemMeta({ summary }: { readonly summary: ProblemSummary }) {
  const tCommon = useTranslations("common");
  if (summary.code === null && summary.requestId === null) return null;
  return (
    <dl className={styles.meta} aria-label={tCommon("problemDetails")}>
      {summary.code !== null ? (
        <div className={styles.metaGroup}>
          <dt className={styles.metaLabel}>{tCommon("errorCode")}</dt>
          <dd className={styles.metaValue}>
            <code className={styles.code}>{summary.code}</code>
          </dd>
        </div>
      ) : null}
      {summary.requestId !== null ? (
        <div className={styles.metaGroup}>
          <dt className={styles.metaLabel}>{tCommon("requestId")}</dt>
          <dd className={styles.metaValue}>
            <code className={styles.code}>{summary.requestId}</code>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

export interface ProblemNoticeProps extends HTMLAttributes<HTMLDivElement> {
  readonly error: unknown;
  readonly message: string;
  readonly onRetry?: (() => void) | undefined;
  readonly retryLabel?: string | undefined;
  readonly compact?: boolean;
}

export function ProblemNotice({
  error,
  message,
  onRetry,
  retryLabel,
  compact = false,
  className,
  ...rest
}: ProblemNoticeProps) {
  const tCommon = useTranslations("common");
  const summary = summarizeProblem(error, message);
  return (
    <div
      className={cx(
        styles.notice,
        compact && styles.noticeCompact,
        className,
      )}
      role="alert"
      {...rest}
    >
      <p className={styles.message}>{summary.message}</p>
      <ProblemMeta summary={summary} />
      {onRetry ? (
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {retryLabel ?? tCommon("retry")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export interface ProblemStateProps extends HTMLAttributes<HTMLDivElement> {
  readonly error: unknown;
  readonly onRetry: () => void;
  readonly message?: string | undefined;
  readonly retryLabel?: string | undefined;
}

export function ProblemState({
  error,
  onRetry,
  message,
  retryLabel,
  className,
  ...rest
}: ProblemStateProps) {
  const tCommon = useTranslations("common");
  const safeMessage = message ?? tCommon("errorHint");
  const summary = summarizeProblem(error, safeMessage);
  return (
    <EmptyState
      title={tCommon("error")}
      description={summary.message}
      className={className}
      role="alert"
      {...rest}
    >
      <div className={styles.emptyBody}>
        <ProblemMeta summary={summary} />
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel ?? tCommon("retry")}
        </Button>
      </div>
    </EmptyState>
  );
}
