// @input  -- one DraftResult's verify_before_publish list and the draft translator
// @output -- the sentences a human must check, grouped single_source / profile_only / gap / stance
// @pos    -- whitelisted for the --sc-source-* tokens (app/source-tokens.test.ts): a
//            single-source sentence is framed third-party because its one witness is a
//            competitor page, a profile-only or stance sentence first-party; a gap is an error

import type {
  DraftResult,
  VerifyItem,
} from "@sf/public-tools/content-brief/contract";

import {
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
import { VERIFY_KINDS } from "./content-draft-codes";

type VerifyKind = VerifyItem["kind"];
type VerifyTone = "third" | "first" | "error";

const KIND_TONE: Readonly<Record<VerifyKind, VerifyTone>> = {
  single_source: "third",
  profile_only: "first",
  gap: "error",
  stance: "first",
};

const TONE_FRAME: Readonly<Record<VerifyTone, string>> = {
  third: "border-source-third/40 bg-source-third/[0.06]",
  first: "border-source-first/40 bg-source-first/[0.06]",
  error: "border-brand-error/35 bg-brand-error/[0.06]",
};

const TONE_LABEL: Readonly<Record<VerifyTone, string>> = {
  third: "text-source-third",
  first: "text-source-first",
  error: "text-brand-error",
};

function VerifyRow({
  item,
  locale,
  t,
}: {
  readonly item: VerifyItem;
  readonly locale: string;
  readonly t: DraftTranslate;
}) {
  const tone = KIND_TONE[item.kind];
  return (
    <li
      data-verify-item
      data-verify-kind={item.kind}
      data-verify-tone={tone}
      className={`rounded-[10px] border p-3 ${TONE_FRAME[tone]}`}
    >
      <p className="font-serif text-[14px] leading-[1.6] text-text-dark-primary">
        {item.sentence}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={ID_CHIP}>{t("verify.section", { id: item.section_id })}</span>
        <span className={`${DATA_CHIP} ${chipTone("muted")}`}>
          {item.evidence_refs.length === 0
            ? t("verify.noRefs")
            : t("verify.refs", { refs: joinList(item.evidence_refs, locale) })}
        </span>
      </div>
      <p data-verify-body className={`mt-1.5 ${BODY_TEXT} ${TONE_LABEL[tone]}`}>
        {translated(t, `verifyKindBody.${item.kind}`, { count: item.support_count })}
      </p>
    </li>
  );
}

export function VerifyList({
  result,
  locale,
  t,
}: {
  readonly result: DraftResult;
  readonly locale: string;
  readonly t: DraftTranslate;
}) {
  const items = result.verify_before_publish;
  return (
    <section data-verify-list className={CARD}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={SECTION_TITLE}>{t("verify.title")}</h3>
        <span data-verify-count className="font-mono text-[12px] text-text-dark-secondary">
          {t("verify.count", { count: items.length })}
        </span>
      </div>
      {items.length === 0 ? (
        <p data-verify-empty className={`mt-3 ${BODY_TEXT}`}>
          {t("verify.empty")}
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {VERIFY_KINDS.map((kind) => {
            const group = items.filter((item) => item.kind === kind);
            if (group.length === 0) return null;
            return (
              <div key={kind} data-verify-group={kind}>
                <h4 className={`font-mono text-[10.5px] tracking-[0.12em] uppercase ${TONE_LABEL[KIND_TONE[kind]]}`}>
                  {translated(t, `verifyKind.${kind}`)} · {group.length}
                </h4>
                <ul className="mt-2 space-y-2">
                  {group.map((item, index) => (
                    <VerifyRow key={`${item.section_id}:${index}`} item={item} locale={locale} t={t} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
