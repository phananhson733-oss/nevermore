"use client";
// @input -- stored GEO copy and an explicitly requested confirmed Profile proposal
// @output -- whole-copy review; no save, freeze, or partial field laundering
// @pos -- the boundary between Profile editing and self-contained GEO storage
import { useTranslations } from "next-intl";
import { WEBSITE_PROFILE_FIELD_NAMES } from "../../lib/account-websites/contracts.ts";
import type { GeoProfileCopy } from "../../lib/geo-tools/kb-profile-copy.ts";
import { Button } from "../ui/button.tsx";

function text(value: string | readonly string[] | undefined): string {
  return value === undefined || value.length === 0 ? "—" : typeof value === "string" ? value : value.join(" · ");
}
export function GeoProfileCopyReview({ current, proposal, onApply, onDismiss, disabled }: {
  readonly current: GeoProfileCopy | undefined;
  readonly proposal: GeoProfileCopy;
  readonly onApply: () => void;
  readonly onDismiss: () => void;
  readonly disabled: boolean;
}) {
  const t = useTranslations("tools.geoKnowledgeBase");
  const fieldName = useTranslations("account.websites.fields");
  const changes = WEBSITE_PROFILE_FIELD_NAMES.filter(field => JSON.stringify(current?.profile[field]) !== JSON.stringify(proposal.profile[field]));
  const unchanged = current?.snapshotId === proposal.snapshotId && current.profileHash === proposal.profileHash && current.snapshotRevision === proposal.snapshotRevision;
  return <section aria-labelledby="geo-copy-review-title" className="rounded-card border border-brand-accent/40 bg-brand-panel px-5 py-5 sm:px-7">
    <h3 id="geo-copy-review-title" className="text-[17px] font-semibold text-text-dark-primary">{t("asset.copyReviewTitle")}</h3>
    <p className="mt-3 text-[13px] leading-relaxed text-text-dark-secondary">{t("asset.copyReviewBody", { revision: proposal.snapshotRevision })}</p>
    <div className="mt-5 space-y-3">
      {changes.length === 0 ? <p className="text-sm text-text-dark-secondary">{t(unchanged ? "asset.copyUnchanged" : "asset.copyMetadataChanged")}</p> : changes.map(field => <div key={field} className="rounded-[10px] border border-brand-border-card p-4">
        <h4 className="text-sm font-medium text-text-dark-primary">{fieldName(field)}</h4>
        <dl className="mt-3 grid gap-4 text-[13px] sm:grid-cols-2">
          <div className="min-w-0"><dt className="text-text-dark-secondary">{t("asset.copyCurrent")}</dt><dd className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{text(current?.profile[field])}</dd></div>
          <div className="min-w-0"><dt className="text-brand-accent-text">{t("asset.copyProposed")}</dt><dd className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{text(proposal.profile[field])}</dd></div>
        </dl>
      </div>)}
    </div>
    <div className="mt-5 flex flex-wrap gap-3">
      <Button type="button" variant="outline" className="h-auto min-h-10 whitespace-normal" disabled={disabled || unchanged} onClick={onApply}>{t("asset.applyCopy")}</Button>
      <Button type="button" variant="ghost" className="h-auto min-h-10 whitespace-normal" disabled={disabled} onClick={onDismiss}>{t("asset.dismissCopy")}</Button>
    </div>
  </section>;
}
