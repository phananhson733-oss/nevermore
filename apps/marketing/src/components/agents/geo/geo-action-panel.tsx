// @input  -- one report, its confirmed context, its frozen query set and the active locale
// @output -- what the run found, what to do about it, and one brief to hand an AI
// @pos    -- the last two sections of the GEO report, and the boundary of this product

"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import {
  buildGeoAiReportCopy,
  type GeoAiReportCopyLocale,
} from "../../../lib/agents/geo-ai-report-copy";
import { deriveGeoActionPlan } from "../../../lib/agents/geo-action-mapping";
import type { GeoContextSnapshotV1 } from "../../../lib/agents/geo-context";
import type { GeoQuerySetV1 } from "../../../lib/agents/geo-query-contract";
import type { GeoReportDataV3 } from "../../../lib/agents/geo-report-contract";
import {
  deriveGeoSolutionPresentations,
  type GeoSolutionPresentationV1,
} from "../../../lib/agents/geo-solution-presentation";

const BUTTON_CLASS =
  "inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-brand-accent/50 bg-brand-panel px-5 text-[13.5px] font-medium text-text-dark-primary transition-colors hover:border-brand-accent disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";
const CARD_CLASS =
  "rounded-card border border-brand-border-card bg-brand-panel-sunken p-5 md:p-6";

/**
 * The kind chip.
 *
 * Text first, colour second. "Do" and "Do not" are the two rows a reader is
 * most likely to act on and least likely to read carefully, and a palette is
 * the wrong thing for them to differ by — the word is the indicator and the
 * border is decoration on top of it.
 */
function KindChip({
  kind,
}: {
  readonly kind: GeoSolutionPresentationV1["kind"];
}) {
  const t = useTranslations("agents.geo");
  const tone =
    kind === "avoid"
      ? "border-brand-accent-2/50 text-brand-accent-2"
      : kind === "external_data"
        ? "border-brand-border-dashed text-text-dark-tertiary"
        : "border-brand-accent/50 text-brand-accent-text";
  return (
    <span
      className={`inline-flex items-center rounded-row border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.06em] uppercase ${tone}`}
    >
      {t(`actionKinds.${kind}`)}
    </span>
  );
}

/** The one sentence that carries the numbers, or the one that says there are none. */
function BasisLine({
  solution,
}: {
  readonly solution: GeoSolutionPresentationV1;
}) {
  const t = useTranslations("agents.geo");
  return (
    <p className="font-mono text-[11px] leading-[1.5] text-text-dark-secondary">
      {solution.reasonCounts === null
        ? t("solutions.noRatio")
        : t(`actionReasonsCounted.${solution.reason}`, {
            observed: solution.reasonCounts.observed,
            evaluable: solution.reasonCounts.evaluable,
          })}
    </p>
  );
}

function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="grid min-w-0 gap-1">
      <h5 className="font-mono text-[10px] tracking-[0.06em] text-text-dark-tertiary uppercase">
        {label}
      </h5>
      {children}
    </section>
  );
}

const BODY_CLASS = "text-[12px] leading-[1.6] text-text-dark-secondary";

function SolutionCard({
  solution,
}: {
  readonly solution: GeoSolutionPresentationV1;
}) {
  const t = useTranslations("agents.geo");

  return (
    <li data-testid="geo-solution-card" className={CARD_CLASS}>
      <div className="flex flex-wrap items-center gap-2">
        <KindChip kind={solution.kind} />
        <h4 className="text-[13.5px] leading-[1.5] font-semibold text-text-dark-primary">
          {/*
            An avoid is not a proposal to build an asset, so naming one made it
            read as the same row as everything else with a different chip. Its
            own sentence is the heading.
          */}
          {solution.kind === "avoid"
            ? t(`actionReasons.${solution.reason}`)
            : t(`assetTypes.${solution.assetType}`)}
        </h4>
      </div>

      <div className="mt-3 grid min-w-0 gap-4 md:grid-cols-2">
        <Field label={t("solutions.fields.issue")}>
          <p className={BODY_CLASS}>{t(solution.issueKey)}</p>
          <BasisLine solution={solution} />
          {/*
            Named questions, not ids. "Observed in 0 of 3" is only actionable
            once the reader knows which three, and the ids mean nothing outside
            this code.
          */}
          {solution.exactQuestions.length > 0 && (
            <>
              <p className="text-[11px] text-text-dark-tertiary">
                {t("solutions.basisQuestions")}
              </p>
              <ul className="grid gap-0.5">
                {solution.exactQuestions.map((question) => (
                  <li
                    key={question}
                    className="text-[11px] leading-[1.5] break-words text-text-dark-tertiary"
                  >
                    {question}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Field>

        <Field label={t("solutions.fields.why")}>
          <p className={BODY_CLASS}>{t(solution.whyKey)}</p>
        </Field>

        <Field label={t("solutions.fields.action")}>
          <p className={BODY_CLASS}>{t(solution.actionKey)}</p>
          {solution.targetUrl !== null && (
            <p className="font-mono text-[11px] break-all text-text-dark-tertiary">
              {t("solutions.page")}: {solution.targetUrl}
            </p>
          )}
        </Field>

        <Field label={t("solutions.fields.inputs")}>
          <p className={BODY_CLASS}>{t(solution.inputsKey)}</p>
        </Field>

        <Field label={t("solutions.fields.rejected")}>
          <p className={BODY_CLASS}>{t(solution.rejectedAlternativeKey)}</p>
        </Field>

        <Field label={t("solutions.fields.limits")}>
          {solution.unknownKeys.length > 0 && (
            <>
              <p className="text-[11px] text-text-dark-tertiary">
                {t("solutions.unknownsLabel")}
              </p>
              <ul className="grid gap-0.5">
                {solution.unknownKeys.map((key) => (
                  <li key={key} className={BODY_CLASS}>
                    {t(key)}
                  </li>
                ))}
              </ul>
            </>
          )}
          <ul className="grid gap-0.5">
            {solution.limitationKeys.map((key) => (
              <li key={key} className={BODY_CLASS}>
                {t(key)}
              </li>
            ))}
          </ul>
          <p className={BODY_CLASS}>{t("solutions.noGuarantee")}</p>
          <p className="font-mono text-[10.5px] text-text-dark-tertiary">
            {t("solutions.requiresReview")}
          </p>
        </Field>
      </div>
    </li>
  );
}

/**
 * The two locales the brief is written in.
 *
 * Narrowed here rather than at the call site: the route's locale is a string,
 * and a third locale added to the site must fail this function rather than
 * silently produce an English brief under a Chinese heading.
 */
function geoCopyLocale(locale: string): GeoAiReportCopyLocale {
  return locale === "zh" ? "zh" : "en";
}

export function GeoActionPanel({
  report,
  context,
  querySet,
  locale,
}: {
  readonly report: GeoReportDataV3;
  readonly context: GeoContextSnapshotV1;
  /** The set that was confirmed and run, never a live draft. */
  readonly querySet: GeoQuerySetV1;
  readonly locale: string;
}) {
  const t = useTranslations("agents.geo");
  // The confirmed page travels in, so the existing-page check names the URL the
  // visitor entered rather than a fabricated site root.
  const plan = useMemo(
    () => deriveGeoActionPlan(report, context.targetUrl),
    [context.targetUrl, report],
  );
  const solutions = useMemo(
    () => deriveGeoSolutionPresentations(report, plan),
    [plan, report],
  );

  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  /**
   * The brief, kept on the page only when the clipboard refused it.
   *
   * The failure copy tells the visitor to select the text and copy it, which
   * needs text on the page to select.
   */
  const [fallback, setFallback] = useState<string | null>(null);

  /**
   * The brief, built once and used for the preview, the clipboard and the
   * fallback.
   *
   * One string, three renderings. Building it separately per surface is how a
   * preview comes to show something other than what was copied, and the whole
   * point of the preview is that it is what gets copied.
   */
  const built = useMemo(
    () =>
      buildGeoAiReportCopy({
        // The chrome follows the reader; the fenced data does not move.
        locale: geoCopyLocale(locale),
        context,
        querySet,
        report,
        plan,
        generatedAt: new Date(),
      }),
    [context, locale, plan, querySet, report],
  );
  const markdown = built.ok ? built.markdown : null;

  const copy = useCallback(async () => {
    if (markdown === null) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied("done");
      setFallback(null);
    } catch {
      // Browsers deny the clipboard in plenty of ordinary situations. The brief
      // goes on the page instead, so "select it and copy" is true.
      setCopied("failed");
      setFallback(markdown);
    }
  }, [markdown]);

  return (
    <>
      <section className={CARD_CLASS}>
        <h3 className="text-[14px] font-semibold text-text-dark-primary">
          {t("solutions.problemsTitle")}
        </h3>
        <p className="mt-1 text-[11.5px] leading-[1.55] text-text-dark-secondary">
          {t("solutions.problemsIntro")}
        </p>
        {solutions.length === 0 ? (
          <p className="mt-3 rounded-row border border-brand-border-dashed px-3 py-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {t(
              `solutions.zero.${plan.zeroActionReason ?? "needs_more_evidence"}`,
            )}
          </p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {solutions.map((solution) => (
              <li
                key={solution.actionId}
                data-testid="geo-problem-row"
                className="grid gap-1 rounded-row border border-brand-border-card bg-brand-panel px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <KindChip kind={solution.kind} />
                  <span className="text-[12.5px] leading-[1.5] text-text-dark-primary">
                    {t(solution.issueKey)}
                  </span>
                </div>
                <BasisLine solution={solution} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-[14px] font-semibold text-text-dark-primary">
          {t("solutions.title")}
        </h3>
        <p className="mt-1 text-[11.5px] leading-[1.55] text-text-dark-secondary">
          {t("solutions.intro")}
        </p>
        {solutions.length > 0 && (
          <ul className="mt-3 grid gap-3">
            {solutions.map((solution) => (
              <SolutionCard key={solution.actionId} solution={solution} />
            ))}
          </ul>
        )}
      </section>

      <section className={`${CARD_CLASS} min-w-0`}>
        <h3 className="text-[14px] font-semibold text-text-dark-primary">
          {t("solutions.copyTitle")}
        </h3>
        <p className="mt-1 text-[11.5px] leading-[1.55] text-text-dark-secondary">
          {t("solutions.copyIntro")}
        </p>

        {!built.ok ? (
          <p
            role="alert"
            className="mt-3 rounded-row border border-brand-accent-2/50 px-3 py-2 text-[12.5px] leading-[1.6] text-brand-accent-2"
          >
            {t("solutions.refusalTitle")}{" "}
            {t(`solutions.refusal.${built.reason}`)}
          </p>
        ) : (
          <>
            <details className="mt-3 min-w-0">
              <summary className="cursor-pointer text-[12.5px] text-text-dark-secondary">
                {t("solutions.preview")}
              </summary>
              <pre
                className="mt-2 max-h-96 w-full max-w-full overflow-auto rounded-row border border-brand-border-card bg-brand-panel p-3 font-mono text-[10.5px] leading-[1.5] text-text-dark-secondary"
              >
                {markdown}
              </pre>
            </details>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className={BUTTON_CLASS}
                onClick={() => {
                  void copy();
                }}
              >
                {t("solutions.copyForAi")}
              </button>
              {/*
                Mounted whether or not there is anything to say. A live region
                that appears at the same moment as its first message is a region
                most screen readers never announce.
              */}
              <p
                role="status"
                aria-live="polite"
                className={`text-[11.5px] ${copied === "failed" ? "text-brand-accent-2" : "text-brand-accent-text"}`}
              >
                {copied === "done" && t("solutions.copied")}
                {copied === "failed" && t("solutions.copyFailed")}
              </p>
            </div>

            {fallback !== null && (
              <textarea
                readOnly
                aria-label={t("solutions.copyForAi")}
                className="mt-3 h-48 w-full rounded-row border border-brand-border-card bg-brand-panel p-3 font-mono text-[10.5px] text-text-dark-secondary"
                value={fallback}
              />
            )}

            <p className="mt-2 text-[11.5px] leading-[1.55] text-text-dark-tertiary">
              {t("solutions.copyIsNotApproval")}
            </p>
          </>
        )}
      </section>
    </>
  );
}
