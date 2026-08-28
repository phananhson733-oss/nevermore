// @input  -- one DraftResult's sections, the annotation toggle, the rerun state and the translator
// @output -- every section as H2 + question chips + word count / failure / skip note, collapsible,
//            the serif body with claim underlines, and the per-section rerun button
// @pos    -- whitelisted for the --sc-source-* tokens (app/source-tokens.test.ts): the claim
//            underline is coloured by source layer, and the legend swatch exported from here
//            is how the toolbar shows the same colours without naming them

import { useState } from "react";
import type {
  DraftResult,
  DraftSection,
  Sentence,
} from "@sf/public-tools/content-brief/contract";
import { SECTION_RERUN_SOFT_MAX } from "@sf/public-tools/content-brief/constants";

import { claimTone, type ClaimTone } from "./content-draft-claims";
import {
  ACTION_BUTTON,
  BODY_TEXT,
  CARD,
  DATA_CHIP,
  ID_CHIP,
  SECTION_TITLE,
  chipTone,
  joinList,
  translated,
  type DraftTranslate,
} from "./content-draft-results-shared";

/** How many leading sections open by default; failed sections open regardless (handoff §5.5). */
const OPEN_BY_DEFAULT = 2;

/**
 * An underline, not a background (handoff §5.5). `inset 0 -2px 0` draws a
 * two-pixel rule inside the inline box, so the text keeps its own colour and
 * the annotation reads as a mark on the sentence rather than a highlight of
 * it. The three colours are the source layers of §7 plus the error token for
 * a gap; a connective sentence draws nothing.
 */
const CLAIM_UNDERLINE: Readonly<Record<Exclude<ClaimTone, null>, string>> = {
  first: "inset 0 -2px 0 var(--sc-source-first)",
  third: "inset 0 -2px 0 var(--sc-source-third)",
  gap: "inset 0 -2px 0 var(--sc-error)",
};

function underlineStyle(tone: ClaimTone): React.CSSProperties | undefined {
  return tone === null ? undefined : { boxShadow: CLAIM_UNDERLINE[tone] };
}

/** A sample of one underline for legends; the toolbar renders these instead of naming a token. */
export function ClaimSwatch({
  tone,
  children,
}: {
  readonly tone: ClaimTone;
  readonly children: React.ReactNode;
}) {
  return (
    <span
      data-claim-swatch={tone ?? "none"}
      className="font-serif text-[13px] text-text-dark-primary"
      style={underlineStyle(tone)}
    >
      {children}
    </span>
  );
}

function SentenceSpan({
  sentence,
  annotate,
}: {
  readonly sentence: Sentence;
  readonly annotate: boolean;
}) {
  const tone = annotate ? claimTone(sentence) : null;
  return (
    <span
      data-sentence
      data-claim={sentence.claim}
      data-claim-underline={tone ?? undefined}
      style={underlineStyle(tone)}
    >
      {sentence.text}
    </span>
  );
}

function SectionBody({
  section,
  annotate,
}: {
  readonly section: Extract<DraftSection, { status: "ok" }>;
  readonly annotate: boolean;
}) {
  return (
    <div data-section-body className="mt-3 space-y-3 font-serif text-[15.5px] leading-[1.7] text-text-dark-primary">
      {section.body.paragraphs.map((paragraph, index) => (
        <p key={index}>
          {paragraph.sentences.map((sentence, sentenceIndex) => (
            <span key={sentenceIndex}>
              {sentenceIndex > 0 ? " " : null}
              <SentenceSpan sentence={sentence} annotate={annotate} />
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}

function SectionMeta({
  section,
  t,
}: {
  readonly section: DraftSection;
  readonly t: DraftTranslate;
}) {
  if (section.status === "ok") {
    return (
      <span data-section-words className={`${DATA_CHIP} ${chipTone("neutral")}`}>
        {t("doc.words", { count: section.body.word_count })}
      </span>
    );
  }
  if (section.status === "failed") {
    return (
      <span
        data-section-fail-reason={section.fail_reason}
        className={`${DATA_CHIP} border-brand-error/35 bg-brand-error/[0.10] text-brand-error`}
      >
        {t("doc.failed")} · {t("doc.attempts", { count: section.llm.attempts })}
      </span>
    );
  }
  return (
    <span data-section-skipped className={`${DATA_CHIP} ${chipTone("muted")}`}>
      {t("doc.skipped")}
    </span>
  );
}

export interface RerunState {
  /** Reruns already spent on this draft; the button disables at SECTION_RERUN_SOFT_MAX. */
  readonly used: number;
  /** The section currently being rerun, if any. */
  readonly running: string | null;
  readonly onRerun: (sectionId: string) => void;
}

function SectionCard({
  section,
  index,
  annotate,
  rerun,
  locale,
  t,
}: {
  readonly section: DraftSection;
  readonly index: number;
  readonly annotate: boolean;
  readonly rerun: RerunState;
  readonly locale: string;
  readonly t: DraftTranslate;
}) {
  const [open, setOpen] = useState(index < OPEN_BY_DEFAULT || section.status === "failed");
  const exhausted = rerun.used >= SECTION_RERUN_SOFT_MAX;
  const busy = rerun.running !== null;
  return (
    <li
      data-draft-section={section.id}
      data-section-status={section.status}
      data-section-open={open}
      className="rounded-[10px] border border-brand-border-card bg-brand-panel-raised p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span className={`${ID_CHIP} mt-1`}>{section.id}</span>
          <h4 data-section-h2 className="text-[16px] font-semibold leading-[1.4] text-text-dark-primary">
            {section.h2}
          </h4>
        </div>
        <button
          type="button"
          data-section-toggle
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={ACTION_BUTTON}
        >
          {open ? t("actions.collapse") : t("actions.expand")}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span data-section-answers className={`${DATA_CHIP} ${chipTone("neutral")}`}>
          {t("doc.answers", { ids: joinList(section.answers, locale) })}
        </span>
        <SectionMeta section={section} t={t} />
      </div>
      {open ? (
        <>
          {section.status === "ok" ? (
            <SectionBody section={section} annotate={annotate} />
          ) : section.status === "failed" ? (
            <p data-section-failed className={`mt-3 ${BODY_TEXT}`}>
              {translated(t, `sectionFail.${section.fail_reason}`)}
            </p>
          ) : (
            <p data-section-skipped-body className={`mt-3 ${BODY_TEXT}`}>
              {t("doc.skippedBody")}
            </p>
          )}
          {section.status !== "skipped" ? (
            <div className="mt-3">
              <button
                type="button"
                data-rerun-section={section.id}
                disabled={exhausted || busy}
                onClick={() => rerun.onRerun(section.id)}
                className={`${ACTION_BUTTON} disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {rerun.running === section.id ? t("actions.rerunning") : t("actions.rerun")}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </li>
  );
}

export function DraftDoc({
  result,
  annotate,
  rerun,
  locale,
  t,
}: {
  readonly result: DraftResult;
  readonly annotate: boolean;
  readonly rerun: RerunState;
  readonly locale: string;
  readonly t: DraftTranslate;
}) {
  return (
    <section data-draft-doc data-claims-visible={annotate} className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={SECTION_TITLE}>{t("doc.title")}</h3>
        <span data-reruns-used className={`${DATA_CHIP} ${chipTone("muted")}`}>
          {t("doc.rerunsUsed", { used: rerun.used, max: SECTION_RERUN_SOFT_MAX })}
        </span>
      </div>
      <p className={`mt-1 ${BODY_TEXT}`}>
        {t("doc.rerunLimit", { max: SECTION_RERUN_SOFT_MAX })}
      </p>
      <ol className="mt-4 space-y-3">
        {result.sections.map((section, index) => (
          <SectionCard
            // Keyed by run id too, so a rerun's replacement result resets the
            // open/closed state to the spec default rather than inheriting it.
            key={`${result.run.run_id}:${section.id}`}
            section={section}
            index={index}
            annotate={annotate}
            rerun={rerun}
            locale={locale}
            t={t}
          />
        ))}
      </ol>
    </section>
  );
}
