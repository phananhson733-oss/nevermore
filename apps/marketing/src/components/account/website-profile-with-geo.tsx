"use client";

// @input -- one owned website; Profile confirmation updates only the source-version signal
// @output -- two independently expandable cards whose editors remain mounted together
// @pos -- account website editor shell; hash intents reveal one card without hiding the other
import { useEffect, useState, type ReactNode, type SyntheticEvent } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

import { WebsiteGeoEditor } from "./website-geo-editor.tsx";
import { WebsiteProfileEditor } from "./website-profile-editor.tsx";

type EditorCardName = "profile" | "geo";

function cardForHash(hash: string): EditorCardName | null {
  if (hash === "#website-profile") return "profile";
  if (hash === "#geo") return "geo";
  return null;
}

function currentHashCard(): EditorCardName | null {
  return typeof window === "undefined" ? null : cardForHash(window.location.hash);
}

function AccountEditorCard({
  children,
  description,
  name,
  onToggle,
  open,
  title,
}: {
  readonly children: ReactNode;
  readonly description: string;
  readonly name: EditorCardName;
  readonly onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => void;
  readonly open: boolean;
  readonly title: string;
}) {
  return (
    <details
      id={name === "profile" ? "website-profile" : "geo"}
      data-account-editor-card={name}
      open={open}
      onToggle={onToggle}
      // Both cards hold one website's saved settings, so both are drawn the
      // same way. A tinted ground made GEO read as a different product.
      className="group min-w-0 scroll-mt-24 overflow-hidden rounded-card border border-brand-border-card bg-brand-panel"
    >
      <summary className="cursor-pointer list-none rounded-card px-5 py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 sm:px-7 [&::-webkit-details-marker]:hidden">
        <span className="flex items-start justify-between gap-4">
          <span className="block space-y-1.5">
            <span className="block text-[17px] font-semibold text-text-dark-primary">
              {title}
            </span>
            <span className="block text-[13px] leading-relaxed text-text-dark-secondary">
              {description}
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className="mt-1 size-5 shrink-0 text-text-dark-secondary transition-transform duration-200 group-open:rotate-180"
          />
        </span>
      </summary>
      <div className="border-t border-brand-border-card px-5 py-6 sm:px-7">
        {children}
      </div>
    </details>
  );
}

function WebsiteProfileWithGeoBody({
  websiteId,
  autoGenerate,
}: {
  readonly websiteId: string;
  readonly autoGenerate: boolean;
}) {
  const cards = useTranslations("account.websites.editor");
  const geo = useTranslations("tools.geoKnowledgeBase");
  const [confirmedRevision, setConfirmedRevision] = useState<
    number | null | undefined
  >();
  const [profileAvailable, setProfileAvailable] = useState(true);
  const [profileOpen, setProfileOpen] = useState(autoGenerate);
  const [geoOpen, setGeoOpen] = useState(false);

  useEffect(() => {
    if (autoGenerate) setProfileOpen(true);
  }, [autoGenerate]);

  useEffect(() => {
    const openHashTarget = () => {
      const target = currentHashCard();
      if (target === "profile") setProfileOpen(true);
      if (target === "geo") setGeoOpen(true);
    };

    openHashTarget();
    window.addEventListener("hashchange", openHashTarget);
    return () => window.removeEventListener("hashchange", openHashTarget);
  }, []);

  return (
    <div className="space-y-6">
      <AccountEditorCard
        name="profile"
        title={cards("profileCardTitle")}
        description={cards("profileCardBody")}
        open={profileOpen}
        onToggle={(event) => setProfileOpen(event.currentTarget.open)}
      >
        <WebsiteProfileEditor
          websiteId={websiteId}
          autoGenerate={autoGenerate}
          onConfirmedRevisionChange={setConfirmedRevision}
          onProfileAvailabilityChange={setProfileAvailable}
        />
      </AccountEditorCard>

      <AccountEditorCard
        name="geo"
        title={cards("geoCardTitle")}
        description={cards("geoCardBody")}
        open={geoOpen}
        onToggle={(event) => setGeoOpen(event.currentTarget.open)}
      >
        {profileAvailable ? null : (
          <p
            role="alert"
            className="mb-4 rounded-card border border-brand-border-card bg-brand-panel p-6 text-sm text-text-dark-secondary"
          >
            {geo("asset.inlineUnavailable")}
          </p>
        )}
        {typeof confirmedRevision === "number" ? (
          <WebsiteGeoEditor
            websiteId={websiteId}
            inline
            confirmedRevision={confirmedRevision}
          />
        ) : !profileAvailable ? null : confirmedRevision === undefined ? (
          <p role="status">{geo("asset.loading")}</p>
        ) : (
          <p className="rounded-card border border-brand-border-card bg-brand-panel p-6 text-sm text-text-dark-secondary">
            {geo("asset.profileRequired")}
          </p>
        )}
      </AccountEditorCard>
    </div>
  );
}

export function WebsiteProfileWithGeo(props: {
  readonly websiteId: string;
  readonly autoGenerate: boolean;
}) {
  return <WebsiteProfileWithGeoBody key={props.websiteId} {...props} />;
}
