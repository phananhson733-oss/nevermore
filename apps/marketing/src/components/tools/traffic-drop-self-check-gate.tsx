// @input  -- the visitor's two Search Console self-check answers, and a setter
// @output -- the pre-run gate: two links out, two three-way questions
// @pos    -- above the run button on /[locale]/tools/traffic-drop-diagnosis
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import type { SelfCheckAnswer, SelfCheckId } from "@sf/public-tools";

/**
 * Deep links to the two reports, so nobody has to find a menu item.
 *
 * Search Console resolves these against whichever property the visitor last
 * had open, which is exactly the trap the notice below warns about — it is
 * cheaper to name the trap than to try to pre-select the property for them,
 * which the URL format does not reliably support.
 */
export const MANUAL_ACTIONS_URL =
  "https://search.google.com/search-console/manual-actions";
export const SECURITY_ISSUES_URL =
  "https://search.google.com/search-console/security-issues";

const CHECKS: readonly {
  readonly id: SelfCheckId;
  readonly href: string;
}[] = [
  { id: "manual_action", href: MANUAL_ACTIONS_URL },
  { id: "security_issue", href: SECURITY_ISSUES_URL },
];

/**
 * Three answers per check, in a fixed order that puts the two real findings
 * first and the escape hatch last.
 *
 * `uncertain` is last but it is not a non-answer. The two reports look much
 * alike when they are empty, and Search Console shows one property at a time,
 * so a visitor can look carefully and still not know. Removing this option
 * would not produce more knowledge — it would push those people onto "no
 * issue", and the report would then rule out a penalty on the strength of a
 * guess.
 */
const ANSWERS: readonly SelfCheckAnswer[] = [
  "reports_issue",
  "reports_none",
  "uncertain",
];

/**
 * The state field for a check id.
 *
 * A `Record` rather than a ternary: the ternary's else-branch swallowed any id
 * it did not recognise into `securityIssue`, so adding a third self-check would
 * have silently written both answers into one slot. This form does not compile
 * until the new id has a field.
 */
const STATE_FIELD: Record<SelfCheckId, keyof SelfCheckState> = {
  manual_action: "manualAction",
  security_issue: "securityIssue",
};

export interface SelfCheckState {
  readonly manualAction: SelfCheckAnswer | null;
  readonly securityIssue: SelfCheckAnswer | null;
}

/**
 * The answers, carrying the property they were given for.
 *
 * The property is part of the value rather than a sibling piece of state,
 * because these answers are assertions about ONE site's Search Console pages
 * and mean nothing about another's. Held loosely, the failure is silent and
 * severe: answer "no issues" for site A, switch the dropdown to site B, and the
 * run button stays enabled — B gets an all-clear built on A's inspection, with
 * nothing on screen indicating it. The brand-term list already resets on the
 * same reasoning; this one matters more, because it decides what the report is
 * allowed to conclude.
 *
 * Binding them makes that state unrepresentable rather than merely discouraged:
 * `answersFor` refuses to hand back answers for a property they were not given
 * for, so forgetting to reset cannot produce a run.
 */
export interface SelfCheckDraft extends SelfCheckState {
  readonly property: string;
}

export function emptyDraft(property: string): SelfCheckDraft {
  return { property, manualAction: null, securityIssue: null };
}

/**
 * The two answers if they are complete AND belong to `property`, else null.
 *
 * One function behind both the run button's enabled state and the request
 * body, so the check that guards the run and the value that is sent cannot
 * disagree.
 */
export function answersFor(
  draft: SelfCheckDraft,
  property: string,
): { manualAction: SelfCheckAnswer; securityIssue: SelfCheckAnswer } | null {
  if (draft.property !== property) return null;
  if (draft.manualAction === null || draft.securityIssue === null) return null;
  return {
    manualAction: draft.manualAction,
    securityIssue: draft.securityIssue,
  };
}

interface TrafficDropSelfCheckGateProps {
  readonly value: SelfCheckDraft;
  readonly onChange: (next: SelfCheckDraft) => void;
  readonly disabled: boolean;
}

export function TrafficDropSelfCheckGate({
  value,
  onChange,
  disabled,
}: TrafficDropSelfCheckGateProps) {
  const t = useTranslations("tools.trafficDrop");

  return (
    /* The gate is the one card on this page that blocks the run, so it carries
       the accent rail rather than another shade of panel. */
    <section className="rounded-card border border-brand-accent/50 bg-brand-accent/[0.08] p-[22px] shadow-rail-accent md:p-[26px]">
      <h2 className="text-[16.5px] font-semibold text-text-dark-primary">
        {t("selfChecks.title")}
      </h2>
      <p className="mt-2 max-w-[52em] text-[13px] leading-[1.65] text-text-dark-secondary">
        {t("selfChecks.body")}
      </p>

      <div className="mt-5 space-y-3.5">
        {CHECKS.map((check) => (
          <fieldset
            key={check.id}
            className="rounded-[10px] border border-brand-border bg-brand-panel-sunken p-[18px]"
          >
            <legend className="px-1 text-[13.5px] font-semibold text-text-dark-primary">
              {t(`siteSignals.${check.id}.label`)}
            </legend>

            <p className="text-[12.5px] leading-[1.6] text-text-dark-secondary">
              {t(`selfChecks.${check.id}.where`)}
            </p>
            <a
              href={check.href}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex min-h-9 items-center gap-1.5 font-mono text-[10.5px] tracking-[0.06em] text-brand-accent-text uppercase transition-colors hover:text-brand-accent-hover"
            >
              {t(`selfChecks.${check.id}.open`)}
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>

            <div className="mt-2.5 flex flex-wrap gap-2">
              {ANSWERS.map((answer) => {
                const field = STATE_FIELD[check.id];
                const active = value[field] === answer;
                return (
                  <button
                    key={answer}
                    type="button"
                    disabled={disabled}
                    aria-pressed={active}
                    onClick={() => onChange({ ...value, [field]: answer })}
                    className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 py-1.5 font-mono text-[10px] tracking-[0.06em] uppercase transition-colors disabled:opacity-60 ${
                      active
                        ? "border-brand-accent/50 bg-brand-accent/12 text-brand-accent-text"
                        : "border-brand-border-strong text-text-dark-secondary hover:border-brand-accent/50 hover:text-text-dark-primary"
                    }`}
                  >
                    {t(`selfChecks.${check.id}.${answer}`)}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <p className="mt-4 max-w-[52em] text-[12.5px] leading-[1.6] text-text-dark-secondary">
        {t("selfChecks.notice")}
      </p>
      <p className="mt-2 max-w-[52em] text-[12.5px] leading-[1.6] text-text-dark-secondary">
        {t("selfChecks.why")}
      </p>
    </section>
  );
}
