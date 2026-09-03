"use client";
// @input  -- the account of one confirm-everything gesture, as the editor recorded it
// @output -- what it accepted and whether the version is actually frozen
// @pos    -- presentation only; it decides nothing and starts nothing
import { useTranslations } from "next-intl";
import type { GeoKbV2ConfirmReport as Report } from "./use-geo-kb-v2-editor.ts";

/**
 * Always mounted and live, because a node inserted only when there is
 * something to say is not reliably announced. `stoppedAt: null` is the only
 * state that may say the version is frozen.
 */
export function GeoKbV2ConfirmReport({ report }: { readonly report: Report | null }) {
  const te = useTranslations("tools.geoKnowledgeBase.editor");
  return <section data-geo-v2-confirm-report role="status" aria-live="polite" aria-atomic="true" className={report === null ? "sr-only" : "space-y-2 rounded-[10px] border border-brand-border-card bg-brand-bg p-4 text-[13px] leading-relaxed"}>
    {report === null ? null : <>
      <p className="font-semibold text-text-dark-primary">{te("confirmTitle")}</p>
      <ul className="grid gap-1.5 text-text-dark-secondary">
        <li data-confirm-accepted>{report.accepted === 0 ? te("confirmNone") : te("confirmAccepted", { count: report.accepted })}</li>
        <li data-confirm-outcome className="text-text-dark-primary">
          {report.stoppedAt === null ? te("confirmDone")
            : report.stoppedAt === "blocked" ? te("confirmStopped.blocked", { items: report.blocked.join(" · ") })
            : te(`confirmStopped.${report.stoppedAt}`)}
        </li>
      </ul>
    </>}
  </section>;
}
