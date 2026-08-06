// @input  -- next-intl, cookie-consent-state helpers, @/components/ui/button
// @output -- ConsentPanel component (consent category checkboxes + action buttons)
// @pos    -- Cookie consent UI panel, used by cookie-banner.tsx for both banner and preferences modes
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  CONSENT_VERSION,
  getStoredConsent,
  saveConsent,
  getOrCreateVisitorId,
  type ConsentState,
} from "./cookie-consent-state";

function getInitialConsent(): { analytics: boolean; marketing: boolean } {
  if (typeof window === "undefined")
    return { analytics: false, marketing: false };
  const stored = getStoredConsent();
  return stored
    ? { analytics: stored.analytics, marketing: stored.marketing }
    : { analytics: false, marketing: false };
}

export interface ConsentPanelProps {
  mode: "banner" | "preferences";
  onClose: () => void;
}

export function ConsentPanel({ mode, onClose }: ConsentPanelProps) {
  const t = useTranslations("cookie");
  const [analytics, setAnalytics] = useState(
    () => getInitialConsent().analytics,
  );
  const [marketing, setMarketing] = useState(
    () => getInitialConsent().marketing,
  );
  const [showDetails, setShowDetails] = useState(mode === "preferences");

  const handleSave = useCallback(
    (analyticsVal: boolean, marketingVal: boolean) => {
      const consent: ConsentState = {
        consent_version: CONSENT_VERSION,
        necessary: true,
        analytics: analyticsVal,
        marketing: marketingVal,
        updated_at: new Date().toISOString(),
      };
      saveConsent(consent);

      const visitorId = getOrCreateVisitorId();
      fetch("/api/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitor_id: visitorId,
          categories: [
            { category: "necessary", status: "accepted" },
            {
              category: "analytics",
              status: analyticsVal ? "accepted" : "rejected",
            },
            {
              category: "marketing",
              status: marketingVal ? "accepted" : "rejected",
            },
          ],
          policy_version: CONSENT_VERSION,
          locale:
            typeof navigator !== "undefined"
              ? navigator.language.slice(0, 2)
              : "en",
        }),
      }).catch(() => {}); // fire and forget

      onClose();
    },
    [onClose],
  );

  const handleAcceptAll = () => handleSave(true, true);
  const handleNecessaryOnly = () => handleSave(false, false);
  const handleSavePreferences = () => handleSave(analytics, marketing);

  const panelId = mode === "banner" ? "cookie-banner" : "cookie-preferences";
  const titleId = `${panelId}-title`;

  return (
    <div
      className="w-full max-w-lg rounded-card border border-brand-border-card bg-brand-panel p-[22px] shadow-panel md:p-[26px]"
      role={mode === "preferences" ? "dialog" : "region"}
      aria-modal={mode === "preferences" ? true : undefined}
      aria-labelledby={titleId}
    >
      <h3
        id={titleId}
        className="mb-2 text-[16.5px] font-semibold text-text-dark-primary"
      >
        {t("title")}
      </h3>
      <p className="mb-5 text-[13px] leading-[1.6] text-text-dark-secondary">
        {t("description")}
      </p>

      {showDetails && (
        <div className="mb-5 space-y-2.5">
          {/* Necessary -- always on */}
          <label className="flex items-center justify-between gap-4 rounded-[10px] border border-brand-border bg-brand-panel-sunken px-3.5 py-3">
            <div>
              <span className="text-[13px] font-medium text-text-dark-primary">
                {t("necessary")}
              </span>
              <p className="mt-0.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
                {t("necessaryDesc")}
              </p>
            </div>
            <input
              type="checkbox"
              checked
              disabled
              className="size-4 shrink-0 accent-brand-accent"
            />
          </label>

          {/* Analytics */}
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-[10px] border border-brand-border bg-brand-panel-sunken px-3.5 py-3 transition-colors hover:border-brand-border-strong">
            <div>
              <span className="text-[13px] font-medium text-text-dark-primary">
                {t("analytics")}
              </span>
              <p className="mt-0.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
                {t("analyticsDesc")}
              </p>
            </div>
            <input
              type="checkbox"
              checked={analytics}
              onChange={(e) => setAnalytics(e.target.checked)}
              className="size-4 shrink-0 accent-brand-accent"
            />
          </label>

          {/* Marketing */}
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-[10px] border border-brand-border bg-brand-panel-sunken px-3.5 py-3 transition-colors hover:border-brand-border-strong">
            <div>
              <span className="text-[13px] font-medium text-text-dark-primary">
                {t("marketing")}
              </span>
              <p className="mt-0.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
                {t("marketingDesc")}
              </p>
            </div>
            <input
              type="checkbox"
              checked={marketing}
              onChange={(e) => setMarketing(e.target.checked)}
              className="size-4 shrink-0 accent-brand-accent"
            />
          </label>
        </div>
      )}

      <div className="flex flex-wrap gap-2.5">
        {!showDetails && (
          <>
            <Button onClick={handleAcceptAll} variant="cta">
              {t("acceptAll")}
            </Button>
            <Button onClick={handleNecessaryOnly} variant="outline">
              {t("necessaryOnly")}
            </Button>
            <Button onClick={() => setShowDetails(true)} variant="ghost">
              {t("preferences")}
            </Button>
          </>
        )}
        {showDetails && (
          <>
            <Button onClick={handleSavePreferences} variant="cta">
              {t("save")}
            </Button>
            <Button onClick={handleAcceptAll} variant="outline">
              {t("acceptAll")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
