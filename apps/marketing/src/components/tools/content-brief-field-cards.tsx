// @input  -- one ContentBrief's intent / format / length fields and the tool translator
// @output -- three compact field cards with prominent values and inspectable derivation details
// @pos    -- the SERP- and crawl-derived summary row of the content brief result

import type {
  ContentBrief,
  FormatField,
  IntentField,
  LengthField,
} from "@sf/public-tools/content-brief/contract";
import {
  CRAWL_MIN_FOR_LENGTH,
  INTENT_CONFIRMED_MIN_RATIO,
  SERP_DEPTH,
} from "@sf/public-tools/content-brief/constants";

import { CLASSIFIED_FORMATS } from "./content-brief-codes";
import {
  BODY_TEXT,
  CARD,
  DATA_CHIP,
  MONO_FIGURE,
  PILL,
  SECTION_TITLE,
  attemptedCopy,
  chipTone,
  crawlCounts,
  number,
  reasonCopy,
  serpReturned,
  translated,
  type Translate,
} from "./content-brief-results-shared";
import { SourceChip } from "./content-brief-source-chip";

function Card({
  name,
  title,
  status,
  children,
}: {
  readonly name: string;
  readonly title: string;
  readonly status: "available" | "unavailable";
  readonly children: React.ReactNode;
}) {
  return (
    <section
      data-field-card={name}
      data-field-status={status}
      className={`${CARD} min-w-0`}
    >
      <h3 className={SECTION_TITLE}>{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function IntentCard({
  intent,
  brief,
  locale,
  t,
}: {
  readonly intent: IntentField;
  readonly brief: ContentBrief;
  readonly locale: string;
  readonly t: Translate;
}) {
  if (intent.status === "unavailable") {
    return (
      <Card name="intent" title={t("intent.title")} status="unavailable">
        <p data-unavailable-reason={intent.reason} className={BODY_TEXT}>
          {reasonCopy(t, "intent", intent.reason)}
        </p>
        <p className={`mt-1 ${BODY_TEXT} font-mono`}>
          {attemptedCopy(t, intent)}
        </p>
      </Card>
    );
  }
  const returned = serpReturned(brief);
  return (
    <Card name="intent" title={t("intent.title")} status="available">
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-intent-value
          className="text-[18px] font-semibold text-text-dark-primary"
        >
          {translated(t, `intents.${intent.value}`)}
        </span>
        <span
          data-intent-confidence={intent.confidence}
          className={`${PILL} ${chipTone(intent.confidence === "confirmed" ? "positive" : "caution")}`}
        >
          {t(`intent.${intent.confidence}`)}
        </span>
      </div>
      <p data-intent-support className={`mt-2 ${MONO_FIGURE}`}>
        {t("intent.support", {
          matched: intent.matched,
          returned: returned === null ? "—" : returned,
        })}
      </p>
      <div className="mt-3">
        <SourceChip provenance={intent.provenance} t={t} locale={locale} />
      </div>
      <details data-field-details className="mt-3 border-t border-brand-border-card pt-2">
        <summary className="cursor-pointer text-[11.5px] text-text-dark-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent">{t("fields.details")}</summary>
        <p className={`mt-1 ${BODY_TEXT}`}>
          {t("intent.confirmedRule", {
            depth: SERP_DEPTH,
            ratio: Math.round(INTENT_CONFIRMED_MIN_RATIO * 100),
          })}
        </p>
        {intent.rules_hit.length > 0 ? (
          <div className="mt-3">
            <div className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
              {t("intent.rulesHit")}
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {intent.rules_hit.map((rule) => (
                <span key={rule} className={`${DATA_CHIP} ${chipTone("muted")}`}>
                  {rule}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </details>
    </Card>
  );
}

function distributionLine(
  format: Extract<FormatField, { status: "available" }>,
  t: Translate,
): string {
  return CLASSIFIED_FORMATS.filter((key) => format.distribution[key] > 0)
    .map(
      (key) => `${translated(t, `formats.${key}`)} ${format.distribution[key]}`,
    )
    .join(" / ");
}

/**
 * The denominator is `run.reads.serp.returned`, never `format.classified`.
 * `classified` is a copy the field carries for its own plurality rule; the
 * page prints the number of rows the run actually got back, and lists the
 * unclassified rows separately so the two add up in front of the reader.
 */
function formatBody(
  format: Extract<FormatField, { status: "available" }>,
  returned: number | null,
  t: Translate,
): { readonly key: string; readonly text: string } {
  const distribution = distributionLine(format, t);
  if (format.has_plurality) {
    const top = format.values[0];
    return {
      key: "plurality",
      text: t("format.plurality", {
        count: format.distribution[top],
        returned: returned === null ? "—" : returned,
        min: format.plurality_threshold,
      }),
    };
  }
  if (format.values.length > 1) {
    return {
      key: "noPlurality",
      text: t("format.noPlurality", { distribution }),
    };
  }
  return {
    key: "belowThreshold",
    text: t("format.belowThreshold", {
      min: format.plurality_threshold,
      distribution,
    }),
  };
}

function FormatCard({
  format,
  brief,
  locale,
  t,
}: {
  readonly format: FormatField;
  readonly brief: ContentBrief;
  readonly locale: string;
  readonly t: Translate;
}) {
  const returned = serpReturned(brief);
  if (format.status === "unavailable") {
    return (
      <Card name="format" title={t("format.title")} status="unavailable">
        <p data-unavailable-reason={format.reason} className={BODY_TEXT}>
          {reasonCopy(t, "format", format.reason)}
        </p>
        <p className={`mt-1 ${BODY_TEXT} font-mono`}>
          {attemptedCopy(t, format)}
        </p>
      </Card>
    );
  }
  const body = formatBody(format, returned, t);
  const top = format.values[0];
  return (
    <Card name="format" title={t("format.title")} status="available">
      <div data-format-values className="flex flex-wrap items-baseline gap-1.5">
        {format.values.map((value) => (
          <span
            key={value}
            data-format-value={value}
            className="text-[18px] font-semibold text-text-dark-primary"
          >
            {translated(t, `formats.${value}`)}
          </span>
        ))}
        <span data-format-top-share className={MONO_FIGURE}>
          {t("format.topShare", {
            count: format.distribution[top],
            returned: returned === null ? "—" : returned,
          })}
        </span>
      </div>
      <p data-format-body={body.key} className={`mt-2 ${BODY_TEXT}`}>
        {body.text}
      </p>
      <div className="mt-3">
        <SourceChip provenance={format.provenance} t={t} locale={locale} />
      </div>
      <details data-field-details className="mt-3 border-t border-brand-border-card pt-2">
        <summary className="cursor-pointer text-[11.5px] text-text-dark-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent">{t("fields.details")}</summary>
        <div className="mt-3">
          <div className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
            {t("format.distribution")}
          </div>
          <div data-format-distribution className="mt-1 flex flex-wrap gap-1.5">
            {CLASSIFIED_FORMATS.filter((key) => format.distribution[key] > 0).map(
              (key) => (
                <span key={key} className={`${DATA_CHIP} ${chipTone("neutral")}`}>
                  {translated(t, `formats.${key}`)}{" "}
                  {number(format.distribution[key], locale)}
                </span>
              ),
            )}
            <span
              data-format-unknown-count
              className={`${DATA_CHIP} ${chipTone("muted")}`}
            >
              {t("format.unknownCount", { count: format.unknown_count })}
            </span>
          </div>
        </div>
      </details>
    </Card>
  );
}

function LengthCard({
  length,
  brief,
  locale,
  t,
}: {
  readonly length: LengthField;
  readonly brief: ContentBrief;
  readonly locale: string;
  readonly t: Translate;
}) {
  if (length.status === "unavailable") {
    // `attempted: null` is "not known", not zero: only a numeric 0 prints 0.
    const text =
      length.reason !== "insufficient_evidence"
        ? reasonCopy(t, "length", length.reason)
        : length.attempted === null
          ? t("length.insufficientUnknown", { min: CRAWL_MIN_FOR_LENGTH })
          : t("length.insufficient", {
            min: CRAWL_MIN_FOR_LENGTH,
            attempted: length.attempted,
          });
    return (
      <Card name="length" title={t("length.title")} status="unavailable">
        <p data-unavailable-reason={length.reason} className={BODY_TEXT}>
          {text}
        </p>
        {length.reason === "insufficient_evidence" && length.attempted === null ? (
          <p data-attempted-unknown className={`mt-1 ${BODY_TEXT} font-mono`}>
            {attemptedCopy(t, length)}
          </p>
        ) : null}
      </Card>
    );
  }
  const observed = crawlCounts(brief)?.observed ?? null;
  return (
    <Card name="length" title={t("length.title")} status="available">
      <div data-length-median className="text-[18px] font-semibold text-text-dark-primary">
        {t("length.words", { count: number(length.median, locale) })}
        <span className="ml-2 text-[11.5px] font-normal text-text-dark-secondary">{t("length.median")}</span>
      </div>
      <p className="mt-2 font-mono text-[11.5px] text-text-dark-secondary">
        {t("length.p25")} {number(length.p25, locale)} · {t("length.p75")} {number(length.p75, locale)}
      </p>
      <p data-length-pages-counted className={`mt-2 ${BODY_TEXT}`}>
        {t("length.pagesCounted", {
          count: length.pages_counted,
          observed: observed === null ? "—" : observed,
        })}
      </p>
      <div className="mt-3">
        <SourceChip provenance={length.provenance} t={t} locale={locale} />
      </div>
    </Card>
  );
}

export function FieldCards({
  brief,
  locale,
  t,
}: {
  readonly brief: ContentBrief;
  readonly locale: string;
  readonly t: Translate;
}) {
  return (
    <div data-field-cards className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <IntentCard intent={brief.intent} brief={brief} locale={locale} t={t} />
      <FormatCard format={brief.format} brief={brief} locale={locale} t={t} />
      <LengthCard length={brief.length} brief={brief} locale={locale} t={t} />
    </div>
  );
}
