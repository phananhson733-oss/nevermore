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

export interface SelfCheckState {
  readonly manualAction: SelfCheckAnswer | null;
  readonly securityIssue: SelfCheckAnswer | null;
}

export const EMPTY_SELF_CHECKS: SelfCheckState = {
  manualAction: null,
  securityIssue: null,
};

/**
 * Whether both answers are in, which is the precondition for running.
 *
 * `null` here means "not answered yet" — a UI state that deliberately has no
 * counterpart in the engine. A report can only be built once both are real
 * answers, so the unanswered case cannot reach the part of the system that
 * would have to hedge around it.
 */
export function selfChecksComplete(
  state: SelfCheckState,
): state is { manualAction: SelfCheckAnswer; securityIssue: SelfCheckAnswer } {
  return state.manualAction !== null && state.securityIssue !== null;
}

interface TrafficDropSelfCheckGateProps {
  readonly value: SelfCheckState;
  readonly onChange: (next: SelfCheckState) => void;
  readonly disabled: boolean;
}

export function TrafficDropSelfCheckGate({
  value,
  onChange,
  disabled,
}: TrafficDropSelfCheckGateProps) {
  const t = useTranslations("tools.trafficDrop");

  return (
    <section className="rounded-2xl border border-brand-accent/30 bg-brand-accent/[0.06] p-5 md:p-6">
      <h2 className="text-[16px] font-semibold text-text-dark-primary">
        {t("selfChecks.title")}
      </h2>
      <p className="mt-2 max-w-[52em] text-[13px] leading-relaxed text-text-dark-secondary">
        {t("selfChecks.body")}
      </p>

      <div className="mt-4 space-y-4">
        {CHECKS.map((check) => (
          <fieldset
            key={check.id}
            className="rounded-xl border border-brand-border bg-brand-bg p-4"
          >
            <legend className="px-1 text-[13px] font-semibold text-text-dark-primary">
              {t(`siteSignals.${check.id}.label`)}
            </legend>

            <p className="text-[12.5px] leading-relaxed text-text-dark-secondary">
              {t(`selfChecks.${check.id}.where`)}
            </p>
            <a
              href={check.href}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex min-h-9 items-center gap-1.5 text-[12.5px] font-semibold text-brand-accent-text hover:underline"
            >
              {t(`selfChecks.${check.id}.open`)}
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>

            <div className="mt-2.5 flex flex-wrap gap-2">
              {ANSWERS.map((answer) => {
                const active = value[camel(check.id)] === answer;
                return (
                  <button
                    key={answer}
                    type="button"
                    disabled={disabled}
                    aria-pressed={active}
                    onClick={() =>
                      onChange({ ...value, [camel(check.id)]: answer })
                    }
                    className={`rounded-lg border px-3 py-1.5 text-[12.5px] transition disabled:opacity-60 ${
                      active
                        ? "border-brand-accent bg-brand-accent text-white"
                        : "border-brand-border bg-brand-bg-alt text-text-dark-secondary hover:border-brand-accent/50"
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

      <p className="mt-3 max-w-[52em] text-[12.5px] leading-relaxed text-text-dark-secondary/85">
        {t("selfChecks.notice")}
      </p>
      <p className="mt-2 max-w-[52em] text-[12.5px] leading-relaxed text-text-dark-secondary">
        {t("selfChecks.why")}
      </p>
    </section>
  );
}

/** The state field for a check id. Kept explicit so a new id fails to compile. */
function camel(id: SelfCheckId): keyof SelfCheckState {
  return id === "manual_action" ? "manualAction" : "securityIssue";
}
