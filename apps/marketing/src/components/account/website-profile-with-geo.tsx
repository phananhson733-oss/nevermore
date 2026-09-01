"use client";

// @input -- one owned website; Profile confirmation updates only the source-version signal
// @output -- Profile followed by its stable, independently saved GEO knowledge base
// @pos -- sibling regions keep Profile collapse from unmounting unsaved GEO edits
import { useState } from "react";
import { useTranslations } from "next-intl";
import { WebsiteProfileEditor } from "./website-profile-editor.tsx";
import { WebsiteGeoEditor } from "./website-geo-editor.tsx";

function WebsiteProfileWithGeoBody({ websiteId, autoGenerate }: {
  readonly websiteId: string;
  readonly autoGenerate: boolean;
}) {
  const t = useTranslations("tools.geoKnowledgeBase");
  const [confirmedRevision, setConfirmedRevision] = useState<number | null | undefined>();
  const [profileAvailable, setProfileAvailable] = useState(true);
  return <div className="space-y-10">
    <div id="website-profile" className="scroll-mt-24"><WebsiteProfileEditor websiteId={websiteId} autoGenerate={autoGenerate}
      onConfirmedRevisionChange={setConfirmedRevision} onProfileAvailabilityChange={setProfileAvailable} /></div>
    <section id="geo" aria-labelledby="website-inline-geo-title" className="min-w-0 scroll-mt-24 border-t border-brand-accent/25 pt-8">
      <header className="mb-6 rounded-card border border-brand-accent/25 bg-brand-accent-soft px-5 py-5 sm:px-7">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="website-inline-geo-title" className="flex items-center gap-3 text-[17px] font-semibold text-text-dark-primary">
            <span aria-hidden="true" className="h-5 w-1 rounded-full bg-brand-accent" />{t("asset.inlineTitle")}
          </h2>
          <span className="rounded-full border border-brand-accent/25 px-2.5 py-1 text-[11px] text-brand-accent-text">{t("asset.completeBadge")}</span>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-text-dark-secondary">{t("asset.inlineBody")}</p>
      </header>
      {profileAvailable ? null : <p role="alert" className="mb-4 rounded-card border border-brand-border-card bg-brand-panel p-6 text-sm text-text-dark-secondary">{t("asset.inlineUnavailable")}</p>}
      {typeof confirmedRevision === "number" ? <WebsiteGeoEditor websiteId={websiteId} inline confirmedRevision={confirmedRevision} />
        : !profileAvailable ? null
          : confirmedRevision === undefined ? <p role="status">{t("asset.loading")}</p>
            : <p className="rounded-card border border-brand-border-card bg-brand-panel p-6 text-sm text-text-dark-secondary">{t("asset.profileRequired")}</p>}
    </section>
  </div>;
}

export function WebsiteProfileWithGeo(props: { readonly websiteId: string; readonly autoGenerate: boolean }) {
  return <WebsiteProfileWithGeoBody key={props.websiteId} {...props} />;
}
