// @input  -- /api/auth/session, /api/auth/sign-out, siteConfig.appUrl, common.*
// @output — 未登录显示「登录」按钮（打开站内 Google 登录弹层）；已登录显示「登出」
// @pos    -- Header 右侧的登录入口，对应 SPEC 2.3.1
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { siteConfig } from "@/config/site";

/**
 * End the session and re-render against the cleared cookies.
 *
 * A full reload rather than local state: the cookie is what the server reads,
 * and every other surface on the page that asked about the session did so in a
 * mount-only effect. Flipping one component's state would leave the rest
 * believing the session still exists.
 */
async function signOut(): Promise<void> {
  const result = await fetch("/api/auth/sign-out", { method: "POST" });
  if (result.ok) window.location.reload();
}

/**
 * The header's sign-in affordance.
 *
 * Sign-in state is fetched after hydration rather than read during render: the
 * marketing pages are statically generated, and reading cookies on the server
 * would opt every one of them into dynamic rendering and lose the CDN cache for
 * the sake of one button.
 *
 * The consequence is that the state is unknown for the first moment. Rendering
 * "sign in" during that window would flash the wrong control at someone who is
 * already signed in, so the slot renders the primary CTA alone until the answer
 * arrives — the CTA is correct in both states, and only the extra control
 * appears once we know which one is warranted.
 *
 * Signing in happens HERE, in a dialog the Header owns, rather than by sending
 * the visitor to the product's login screen. The marketing site is where the
 * Google prompt belongs: bouncing a first-time reader to app.gengrowth.ai to
 * authenticate and then back is a worse funnel than a single tap in place. And
 * One Tap cannot carry it alone — Google suppresses that prompt after a
 * dismissal and never shows it to a visitor with no Google session.
 *
 * Signing out has to happen here too, and did not used to. A session begun on
 * this site could only be ended on the other one, which also meant the sign-in
 * path was unverifiable from here: the control correctly hides itself once a
 * session exists, so whoever held one had no way to see it again.
 */
export function SignInControl({
  onSignIn,
}: {
  readonly onSignIn: () => void;
}) {
  const t = useTranslations();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/session", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { signedIn?: boolean } | null) => {
        if (!controller.signal.aborted) setSignedIn(body?.signedIn === true);
      })
      .catch(() => {
        // Unreachable session endpoint: fall back to offering sign-in, which is
        // never harmful — the panel degrades to the app's own login page.
        if (!controller.signal.aborted) setSignedIn(false);
      });
    return () => controller.abort();
  }, []);

  const handleSignOut = useCallback(() => {
    setSigningOut(true);
    void signOut().catch(() => setSigningOut(false));
  }, []);

  const secondaryClass =
    "hidden h-9.5 items-center rounded-lg border border-brand-border-card px-[14px] text-[13.5px] text-text-dark-secondary transition-colors hover:border-brand-accent/40 hover:text-text-dark-primary disabled:opacity-60 md:inline-flex";

  return (
    <>
      {signedIn === false ? (
        <button type="button" onClick={onSignIn} className={secondaryClass}>
          {t("common.signIn")}
        </button>
      ) : null}

      {signedIn === true ? (
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className={secondaryClass}
        >
          {t("common.signOut")}
        </button>
      ) : null}

      <a
        href={siteConfig.appUrl}
        className="hidden h-9.5 items-center rounded-lg bg-brand-gradient px-[18px] text-[13.5px] font-semibold text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta md:inline-flex"
      >
        {signedIn ? t("common.openApp") : t("common.getStarted")}
      </a>
    </>
  );
}

/**
 * The same controls inside the mobile sheet.
 *
 * Signing in closes the sheet first: the dialog is the Header's, not the
 * sheet's, so leaving the sheet open would stack two focus traps.
 */
export function SignInControlMobile({
  onNavigate,
  onSignIn,
}: {
  readonly onNavigate: () => void;
  readonly onSignIn: () => void;
}) {
  const t = useTranslations();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/session", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { signedIn?: boolean } | null) => {
        if (!controller.signal.aborted) setSignedIn(body?.signedIn === true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setSignedIn(false);
      });
    return () => controller.abort();
  }, []);

  return (
    <>
      <a
        href={siteConfig.appUrl}
        onClick={onNavigate}
        className="mt-4 rounded-[10px] bg-brand-gradient px-4 py-2.5 text-center font-semibold text-brand-on-accent shadow-cta-sm"
      >
        {signedIn ? t("common.openApp") : t("common.getStarted")}
      </a>
      <button
        type="button"
        onClick={() => {
          if (signedIn) {
            void signOut();
            return;
          }
          onNavigate();
          onSignIn();
        }}
        className="text-center text-[15px] text-text-dark-secondary transition-colors hover:text-text-dark-primary"
      >
        {signedIn ? t("common.signOut") : t("common.signIn")}
      </button>
    </>
  );
}
