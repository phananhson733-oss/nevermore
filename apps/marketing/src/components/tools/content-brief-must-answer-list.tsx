// @input  -- one ContentBrief's must_answer field, its crawl ledger, and the tool translator
// @output -- one row per question with covered_by over run.reads.crawl.observed, the
//            expandable cluster members and excerpts, and the budget line that adds up
// @pos    -- the evidence-bearing centre of the brief; every denominator here is read
//            from run.reads, never from the field

import type {
  ClusterMember,
  ContentBrief,
  MustAnswerItem,
} from "@sf/public-tools/content-brief/contract";
import { MUST_ANSWER_MIN_PAGES } from "@sf/public-tools/content-brief/constants";

import {
  BODY_TEXT,
  CARD,
  DATA_CHIP,
  ID_CHIP,
  SECTION_TITLE,
  attemptedCopy,
  chipTone,
  crawlCounts,
  crawlObservation,
  reasonCopy,
  translated,
  type Translate,
} from "./content-brief-results-shared";
import { SourceChip, SourceLayerBadge, sourceTone } from "./content-brief-source-chip";
import styles from "./content-brief-presentation.module.css";

function excerptFor(brief: ContentBrief, member: ClusterMember): string | null {
  const page = crawlObservation(brief, member.observation_id);
  if (page === null) return null;
  const excerpt = page.excerpts.find(
    (candidate) =>
      candidate.heading === member.heading && candidate.level === member.level,
  );
  return excerpt?.text ?? null;
}

function MemberRow({
  member,
  brief,
  t,
}: {
  readonly member: ClusterMember;
  readonly brief: ContentBrief;
  readonly t: Translate;
}) {
  const page = crawlObservation(brief, member.observation_id);
  const excerpt = excerptFor(brief, member);
  return (
    <li
      data-cluster-member={member.observation_id}
      className="rounded-[8px] bg-brand-bg px-3 py-2"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={ID_CHIP}>{member.observation_id}</span>
        <span className={ID_CHIP}>{member.level}</span>
        <span className="text-[12.5px] text-text-dark-primary">
          {member.heading}
        </span>
        {page !== null && !page.body_complete ? (
          <span
            data-member-partial
            className={`${DATA_CHIP} ${chipTone("caution")}`}
          >
            {t("mustAnswer.partialRead")}
          </span>
        ) : null}
      </div>
      {page !== null ? (
        <div className="mt-1 break-all font-mono text-[10.5px] text-text-dark-secondary">
          {page.final_url}
        </div>
      ) : null}
      <div className="mt-1.5 text-[11.5px] leading-[1.55] text-text-dark-secondary">
        <span className="font-mono text-[10px] tracking-[0.12em] uppercase">
          {t("mustAnswer.excerpt")}
        </span>
        <span className="ml-2">{excerpt ?? t("mustAnswer.noExcerpt")}</span>
      </div>
    </li>
  );
}

function QuestionRow({
  item,
  observed,
  brief,
  locale,
  t,
}: {
  readonly item: MustAnswerItem;
  readonly observed: number | null;
  readonly brief: ContentBrief;
  readonly locale: string;
  readonly t: Translate;
}) {
  return (
    <li
      data-must-answer-item={item.id}
      data-question-row=""
      className={styles.questionRow}
    >
      <div className={styles.questionTop}>
        <span className={`${ID_CHIP} mt-0.5`}>{item.id}</span>
        <span
          data-must-answer-q
          className="text-[14px] font-semibold leading-[1.4] text-text-dark-primary"
        >
          {item.q}
        </span>
        <span
          data-covered-by
          className={`${DATA_CHIP} ${chipTone("neutral")}`}
          title={t("mustAnswer.canonical", {
            heading: item.cluster.canonical_heading,
          })}
        >
          {t("mustAnswer.coveredBy", {
            covered: item.covered_by,
            observed: observed === null ? "—" : observed,
          })}
        </span>
        <div className={styles.questionSource}>
          <SourceLayerBadge tone={sourceTone(item.q_provenance)} t={t} />
        </div>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-[12px] text-text-dark-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent">
          {t("mustAnswer.members")}
        </summary>
        <div className="mt-2"><SourceChip provenance={item.q_provenance} t={t} locale={locale} /></div>
        <p className="mt-2 text-[11.5px] leading-[1.5] text-text-dark-secondary">{t("mustAnswer.canonical", { heading: item.cluster.canonical_heading })}</p>
        <ul className="mt-2 space-y-1.5">
          {item.cluster.members.map((member) => (
            <MemberRow
              key={`${member.observation_id}:${member.level}:${member.heading}`}
              member={member}
              brief={brief}
              t={t}
            />
          ))}
        </ul>
      </details>
    </li>
  );
}

function BudgetLine({
  brief,
  t,
}: {
  readonly brief: ContentBrief;
  readonly t: Translate;
}) {
  const counts = crawlCounts(brief);
  const { budget } = brief;
  return (
    <div
      data-must-answer-budget
      className={`mt-4 space-y-1 ${BODY_TEXT} font-mono text-[11.5px]`}
    >
      <p data-budget-line>
        {t("mustAnswer.budget", {
          candidates: budget.must_answer_candidates,
          shown: budget.must_answer_shown,
          cap: budget.must_answer_cap,
          hidden: budget.must_answer_hidden,
        })}
      </p>
      {counts !== null ? (
        <p data-budget-denominator>
          {t("mustAnswer.denominator", {
            observed: counts.observed,
            truncated: counts.truncated,
            failed: counts.failed,
            skipped: counts.skipped,
          })}
        </p>
      ) : null}
    </div>
  );
}

export function MustAnswerList({
  brief,
  locale,
  t,
}: {
  readonly brief: ContentBrief;
  readonly locale: string;
  readonly t: Translate;
}) {
  const field = brief.must_answer;
  const counts = crawlCounts(brief);
  if (field.status === "unavailable") {
    const attempted =
      counts?.attempted ??
      (brief.run.reads.crawl.status === "unavailable"
        ? brief.run.reads.crawl.attempted
        : null);
    // `attempted: null` is "not known", not zero: only a numeric 0 prints 0.
    const unknown =
      field.reason === "insufficient_evidence" && field.attempted === null;
    const text =
      field.reason !== "insufficient_evidence"
        ? reasonCopy(t, "mustAnswer", field.reason)
        : unknown
          ? t("mustAnswer.insufficientUnknown")
          : t("mustAnswer.insufficient", {
            observed: field.attempted ?? "—",
            attempted: attempted ?? "—",
          });
    return (
      <section
        data-must-answer
        data-field-status="unavailable"
        className={CARD}
      >
        <h3 className={SECTION_TITLE}>{t("mustAnswer.title")}</h3>
        <p
          data-unavailable-reason={field.reason}
          className={`mt-3 ${BODY_TEXT}`}
        >
          {text}
        </p>
        {unknown ? (
          <p data-attempted-unknown className={`mt-1 ${BODY_TEXT} font-mono`}>
            {attemptedCopy(t, field)}
          </p>
        ) : null}
      </section>
    );
  }
  const modelWorded = field.items.some(
    (item) => item.q_provenance.method === "model",
  );
  return (
    <section data-must-answer data-field-status="available" className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={SECTION_TITLE}>{t("mustAnswer.title")}</h3>
        {counts !== null ? (
          <span className={`${DATA_CHIP} ${chipTone("muted")}`}>
            {t("coverage.crawlObserved", {
              observed: counts.observed,
              attempted: counts.attempted ?? "—",
            })}
          </span>
        ) : null}
      </div>
      {field.items.length === 0 ? (
        <p data-must-answer-empty className={`mt-3 ${BODY_TEXT}`}>
          {t("mustAnswer.empty", {
            observed: counts?.observed ?? 0,
            min: MUST_ANSWER_MIN_PAGES,
          })}
        </p>
      ) : (
        <ul className="mt-3 rounded-[4px] border border-brand-border-card bg-brand-panel">
          {field.items.map((item) => (
            <QuestionRow
              key={item.id}
              item={item}
              observed={counts?.observed ?? null}
              brief={brief}
              locale={locale}
              t={t}
            />
          ))}
        </ul>
      )}
      {modelWorded ? (
        <p className={`mt-3 ${BODY_TEXT}`}>
          {translated(t, "mustAnswer.modelNote")}
        </p>
      ) : null}
      <BudgetLine brief={brief} t={t} />
    </section>
  );
}
