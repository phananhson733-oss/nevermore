// @input  -- Header, Footer, CookieBanner(lazy), TrialProvider, site config
// @output -- PageShell client wrapper (routes product CTAs to the app and manages cookie state)
// @pos    -- Global layout client layer, used by [locale]/layout.tsx
// Once this file is updated, update header comment and folder _DIR.md
"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { Header } from "./header";
import { Footer } from "./footer";
import { TrialProvider } from "./waitlist-context";
import { siteConfig } from "@/config/site";

const CookieBanner = dynamic(
  () =>
    import("./cookie-banner").then((mod) => ({ default: mod.CookieBanner })),
  { ssr: false },
);

export function PageShell({ children }: { children: React.ReactNode }) {
  const [cookiePrefsOpen, setCookiePrefsOpen] = useState(false);

  const ctxValue = useMemo(
    () => ({
      openTrial: () => window.location.assign(siteConfig.appUrl),
      openWaitlist: () => window.location.assign(siteConfig.appUrl),
    }),
    [],
  );

  return (
    <TrialProvider value={ctxValue}>
      <Header onOpenWaitlist={ctxValue.openWaitlist} />
      <main className="pt-16">{children}</main>
      <Footer onOpenCookiePreferences={() => setCookiePrefsOpen(true)} />
      <CookieBanner
        prefsOpen={cookiePrefsOpen}
        onPrefsClose={() => setCookiePrefsOpen(false)}
      />
    </TrialProvider>
  );
}
