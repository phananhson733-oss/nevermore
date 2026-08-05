// @input  -- siteConfig GA4 ID and analytics consent from localStorage/events
// @output -- consent-gated GA4 loader plus privacy-safe marketing event tracking
// @pos    -- global marketing analytics runtime mounted once by PageShell
// Once this file is updated, update the header comment and folder _DIR.md.
"use client";

import { useEffect, useState } from "react";
import { siteConfig } from "@/config/site";
import {
  CONSENT_UPDATED_EVENT,
  getStoredConsent,
  type ConsentState,
} from "./cookie-consent-state";

type Gtag = (...args: unknown[]) => void;
type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: Gtag;
};

const SCRIPT_ID = "gengrowth-ga4";
const MEASUREMENT_ID = siteConfig.analytics.ga4MeasurementId;

function analyticsWindow(): AnalyticsWindow {
  return window as AnalyticsWindow;
}

function setCollectionDisabled(disabled: boolean) {
  (window as unknown as Record<string, boolean>)[
    `ga-disable-${MEASUREMENT_ID}`
  ] = disabled;
}

function ensureGtag(): Gtag {
  const target = analyticsWindow();
  target.dataLayer ??= [];
  target.gtag ??= (...args: unknown[]) => {
    target.dataLayer?.push(args);
  };
  return target.gtag;
}

function enableGoogleAnalytics() {
  setCollectionDisabled(false);
  const gtag = ensureGtag();

  // Basic consent mode: no Google script or request exists before the visitor
  // grants analytics consent. These signals document the granted state once
  // collection begins and keep advertising storage disabled.
  gtag("consent", "update", {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  gtag("set", "linker", {
    domains: ["gengrowth.ai", "app.gengrowth.ai"],
  });
  gtag("js", new Date());
  gtag("config", MEASUREMENT_ID, {
    cookie_domain: "auto",
    send_page_view: true,
  });

  if (!document.getElementById(SCRIPT_ID)) {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`;
    document.head.appendChild(script);
  }
}

function disableGoogleAnalytics() {
  setCollectionDisabled(true);
  analyticsWindow().gtag?.("consent", "update", {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
}

export function trackMarketingEvent(
  name: string,
  parameters: Record<string, string | number | boolean> = {},
) {
  if (typeof window === "undefined" || !getStoredConsent()?.analytics) return;
  analyticsWindow().gtag?.("event", name, parameters);
}

export function GoogleAnalytics() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(Boolean(getStoredConsent()?.analytics));

    const onConsentUpdated = (event: Event) => {
      const consent = (event as CustomEvent<ConsentState>).detail;
      setEnabled(Boolean(consent?.analytics));
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === "gengrowth_consent") {
        setEnabled(Boolean(getStoredConsent()?.analytics));
      }
    };

    window.addEventListener(CONSENT_UPDATED_EVENT, onConsentUpdated);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CONSENT_UPDATED_EVENT, onConsentUpdated);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (enabled) enableGoogleAnalytics();
    else disableGoogleAnalytics();
  }, [enabled]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!enabled) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;

      const url = new URL(anchor.href, window.location.href);
      if (url.hostname === "app.gengrowth.ai") {
        trackMarketingEvent("app_handoff", {
          link_url: `${url.origin}${url.pathname}`,
          link_text: anchor.textContent?.trim().slice(0, 100) || "product link",
        });
      } else if (url.protocol === "mailto:") {
        trackMarketingEvent("contact_click", { contact_method: "email" });
      }
    };

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [enabled]);

  return null;
}
