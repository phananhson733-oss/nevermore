"use client";

/**
 * Brief ↔ draft, side by side (Slice 2 Task 8).
 *
 * The comparison a reviewer needs is not "revision N-1 against revision N" —
 * that is version history — but "did this draft deliver what the brief
 * committed to?". So the left pane is the FROZEN brief revision this run was
 * built from, and the right pane is the draft body.
 *
 * Two deliberate refusals:
 *
 * - The draft pane is neutral, not tinted. The reference design highlights the
 *   proposed side in pale green; in this product green means passed, and
 *   colouring an unreviewed draft green tells a reviewer it already cleared
 *   something before they have read a word of it.
 * - The panes do not scroll together. The two documents have unrelated
 *   structures, so synchronised scrolling produces alignments that mean nothing
 *   and invites a reviewer to trust them.
 */

import { useTranslations } from "next-intl";
import { EmptyState, Spinner, StatusPill, cx } from "@/components/ui";
import type { ContentShadowBriefOutline } from "@/lib/api/hooks-content-shadow";
import type { ArtifactRevision } from "@/lib/api/hooks-studio";
import { coverageVerdict, uncoveredTopics } from "./_compare-view.ts";
import { MarkdownBlocks } from "./_markdown-blocks.tsx";
import type { QaClaimView } from "./_qa-view.ts";
import styles from "./execution.module.css";

export interface ComparePanesProps {
  readonly outline: ContentShadowBriefOutline;
  readonly briefRevision: number;
  readonly briefContent: ArtifactRevision | null;
  readonly briefLoading: boolean;
  readonly draftRevision: number;
  readonly draftBody: string | null;
  readonly outputLocale: string;
  readonly coverageClaim: QaClaimView | null;
}

function briefMarkdown(revision: ArtifactRevision | null): string | null {
  if (revision === null) return null;
  return typeof revision.content === "string" ? revision.content : null;
}

export function ComparePanes({
  outline,
  briefRevision,
  briefContent,
  briefLoading,
  draftRevision,
  draftBody,
  outputLocale,
  coverageClaim,
}: ComparePanesProps) {
  const t = useTranslations("studio.compare");
  const missing = new Set(uncoveredTopics(coverageClaim, outline.targetKeywords));
  const verdict = coverageVerdict(coverageClaim);
  const body = briefMarkdown(briefContent);

  return (
    <div className={styles.compare} data-compare="">
      <section
        className={cx(styles.comparePane, styles.compareBrief)}
        aria-label={t("briefLabel", { revision: briefRevision })}
        data-compare-brief=""
      >
        <p className={styles.compareLabel}>
          {t("briefLabel", { revision: briefRevision })}
        </p>

        {/* "Not judged" is stated where the annotations would be, so nobody
            reads their absence as "everything is covered". */}
        {verdict === "unevaluated" ? (
          <p className={styles.qaScopeNote}>{t("coverageUnevaluated")}</p>
        ) : null}

        <section className={styles.checklist} aria-label={t("committedTopics")}>
          <h5>{t("committedTopics")}</h5>
          {outline.targetKeywords.length === 0 ? (
            <p className={styles.qaNote}>{t("noCommittedTopics")}</p>
          ) : (
            <ul>
              {outline.targetKeywords.map((topic) => (
                <li key={topic}>
                  <span>{topic}</span>
                  {missing.has(topic) ? (
                    <span className={styles.coverageMiss}>
                      {t("coverageMiss")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p className={styles.qaNote}>
            {t("pageAssignment")}{" "}
            <StatusPill tone="neutral">
              {t(
                `pageAssignmentValue.${outline.pageAssignment}` as "pageAssignmentValue.unassigned",
              )}
            </StatusPill>
          </p>
        </section>

        {briefLoading ? (
          <div className={styles.docPending}>
            <Spinner size="md" label={t("briefLoading")} />
            <p>{t("briefLoading")}</p>
          </div>
        ) : body === null ? (
          <EmptyState title={t("briefUnavailable")} />
        ) : (
          <div className={styles.compareBody}>
            <MarkdownBlocks markdown={body} tableClassName={styles.tableScroll} />
          </div>
        )}
      </section>

      <section
        className={cx(styles.comparePane, styles.compareDraft)}
        aria-label={t("draftLabel", { revision: draftRevision })}
        data-compare-draft=""
      >
        <p className={styles.compareLabel}>
          {t("draftLabel", { revision: draftRevision })}
        </p>
        {draftBody === null || draftBody.trim().length === 0 ? (
          <EmptyState title={t("draftUnavailable")} />
        ) : (
          <div className={styles.compareBody}>
            <p className={styles.docLabel}>
              {`English draft · Target market: ${outputLocale}`}
            </p>
            <MarkdownBlocks
              markdown={draftBody}
              tableClassName={styles.tableScroll}
            />
          </div>
        )}
      </section>
    </div>
  );
}
