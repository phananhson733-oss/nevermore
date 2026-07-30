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
      className="bg-brand-bg-alt border border-brand-border rounded-card p-4 md:p-6 max-w-lg w-full shadow-2xl"
      role={mode === "preferences" ? "dialog" : "region"}
      aria-modal={mode === "preferences" ? true : undefined}
      aria-labelledby={titleId}
    >
      <h3
        id={titleId}
        className="text-text-dark-primary font-semibold text-base mb-2"
      >
        {t("title")}
      </h3>
      <p className="text-text-dark-secondary text-sm mb-4">
        {t("description")}
      </p>

      {showDetails && (
        <div className="space-y-3 mb-4">
          {/* Necessary -- always on */}
          <label className="flex items-center justify-between">
            <div>
              <span className="text-text-dark-primary text-sm font-medium">
                {t("necessary")}
              </span>
              <p className="text-text-dark-secondary text-xs">
                {t("necessaryDesc")}
              </p>
            </div>
            <input
              type="checkbox"
              checked
              disabled
              className="accent-brand-accent size-4"
            />
          </label>

          {/* Analytics */}
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <span className="text-text-dark-primary text-sm font-medium">
                {t("analytics")}
              </span>
              <p className="text-text-dark-secondary text-xs">
                {t("analyticsDesc")}
              </p>
            </div>
            <input
              type="checkbox"
              checked={analytics}
              onChange={(e) => setAnalytics(e.target.checked)}
              className="accent-brand-accent size-4"
            />
          </label>

          {/* Marketing */}
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <span className="text-text-dark-primary text-sm font-medium">
                {t("marketing")}
              </span>
              <p className="text-text-dark-secondary text-xs">
                {t("marketingDesc")}
              </p>
            </div>
            <input
              type="checkbox"
              checked={marketing}
              onChange={(e) => setMarketing(e.target.checked)}
              className="accent-brand-accent size-4"
            />
          </label>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!showDetails && (
          <>
            <Button
              onClick={handleAcceptAll}
              className="bg-brand-accent hover:bg-brand-accent-hover text-white text-sm"
            >
              {t("acceptAll")}
            </Button>
            <Button
              onClick={handleNecessaryOnly}
              variant="outline"
              className="text-sm"
            >
              {t("necessaryOnly")}
            </Button>
            <Button
              onClick={() => setShowDetails(true)}
              variant="ghost"
              className="text-sm"
            >
              {t("preferences")}
            </Button>
          </>
        )}
        {showDetails && (
          <>
            <Button
              onClick={handleSavePreferences}
              className="bg-brand-accent hover:bg-brand-accent-hover text-white text-sm"
            >
              {t("save")}
            </Button>
            <Button
              onClick={handleAcceptAll}
              variant="outline"
              className="text-sm"
            >
              {t("acceptAll")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
