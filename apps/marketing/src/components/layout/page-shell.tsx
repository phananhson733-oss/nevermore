// @input  -- Header, Footer, CookieBanner(lazy), TrialModal(lazy), WaitlistModal(lazy), TrialProvider
// @output -- PageShell client wrapper (manages Trial/Waitlist/Cookie modal state)
// @pos    -- Global layout client layer, used by [locale]/layout.tsx
// Once this file is updated, update header comment and folder _DIR.md
"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { Header } from "./header";
import { Footer } from "./footer";
import { TrialProvider } from "./waitlist-context";

const CookieBanner = dynamic(
  () =>
    import("./cookie-banner").then((mod) => ({ default: mod.CookieBanner })),
  { ssr: false },
);

const TrialModal = dynamic(
  () =>
    import("@/components/trial/trial-modal").then((mod) => ({
      default: mod.TrialModal,
    })),
  { ssr: false },
);

const WaitlistModal = dynamic(
  () =>
    import("@/components/waitlist/waitlist-modal").then((mod) => ({
      default: mod.WaitlistModal,
    })),
  { ssr: false },
);

export function PageShell({ children }: { children: React.ReactNode }) {
  const [trialOpen, setTrialOpen] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [cookiePrefsOpen, setCookiePrefsOpen] = useState(false);

  const ctxValue = useMemo(
    () => ({
      openTrial: () => setTrialOpen(true),
      openWaitlist: () => setWaitlistOpen(true),
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
      <TrialModal open={trialOpen} onOpenChange={setTrialOpen} />
      <WaitlistModal open={waitlistOpen} onOpenChange={setWaitlistOpen} />
    </TrialProvider>
  );
}
