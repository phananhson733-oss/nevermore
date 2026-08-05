// @input  -- layout chrome, consent UI, consent-gated GA4, product handoff config
// @output -- global marketing client shell and privacy-aware analytics runtime
// @pos    -- Global layout client layer, used by [locale]/layout.tsx
// Once this file is updated, update header comment and folder _DIR.md
"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { Header } from "./header";
import { Footer } from "./footer";
import { TrialProvider } from "./waitlist-context";
import { siteConfig } from "@/config/site";
import { GoogleAnalytics } from "./google-analytics";

const CookieBanner = dynamic(
  () =>
    import("./cookie-banner").then((mod) => ({ default: mod.CookieBanner })),
  { ssr: false },
);

export function PageShell({ children }: { children: React.ReactNode }) {
  const [cookiePrefsOpen, setCookiePrefsOpen] = useState(false);

  const ctxValue = useMemo(
    () => ({
      // Legacy noindex pages still call this context. Send those CTAs to the
      // product instead of opening an outdated trial or waitlist flow.
      openTrial: () => window.location.assign(siteConfig.appUrl),
      openWaitlist: () => window.location.assign(siteConfig.appUrl),
    }),
    [],
  );

  return (
    <TrialProvider value={ctxValue}>
      <GoogleAnalytics />
      <Header />
      <main className="pt-16">{children}</main>
      <Footer onOpenCookiePreferences={() => setCookiePrefsOpen(true)} />
      <CookieBanner
        prefsOpen={cookiePrefsOpen}
        onPrefsClose={() => setCookiePrefsOpen(false)}
      />
    </TrialProvider>
  );
}
