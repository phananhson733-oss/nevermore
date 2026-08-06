// @input  -- layout chrome, consent UI, consent-gated GA4, product handoff config
// @output -- global marketing client shell and privacy-aware analytics runtime
// @pos    -- Global layout client layer, used by [locale]/layout.tsx
// Once this file is updated, update header comment and folder _DIR.md
"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { MotionConfig } from "framer-motion";
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
    // reducedMotion="user" 让 framer-motion 跟随系统设置：入场动画只保留透明度，
    // 位移一律不播。globals.css 里的 @media (prefers-reduced-motion) 只管得到 CSS
    // 动画，管不到 motion.* 写在元素上的 inline transform，两边要一起设。
    <MotionConfig reducedMotion="user">
      <TrialProvider value={ctxValue}>
        <GoogleAnalytics />
        <Header />
        {/* 与 Header 的 h-17 (68px) 固定高度对齐 */}
        <main className="pt-17">{children}</main>
        <Footer onOpenCookiePreferences={() => setCookiePrefsOpen(true)} />
        <CookieBanner
          prefsOpen={cookiePrefsOpen}
          onPrefsClose={() => setCookiePrefsOpen(false)}
        />
      </TrialProvider>
    </MotionConfig>
  );
}
