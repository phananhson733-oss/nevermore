// @input  -- /api/auth/session, siteConfig.appUrl, common.signIn / common.openApp
// @output — 未登录显示「登录」+ 主 CTA；已登录只留主 CTA
// @pos    -- Header 右侧的登录入口，对应 SPEC 2.3.1
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { siteConfig } from "@/config/site";

/** Where the product's own sign-in screen lives. */
function signInHref(): string {
  return `${siteConfig.appUrl}/login`;
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
 * arrives — the CTA is correct in both states, and only the extra sign-in link
 * appears once we know it is warranted.
 */
export function SignInControl() {
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
        // Unreachable session endpoint: fall back to offering sign-in, which is
        // never harmful — an already-signed-in visitor lands on the app anyway.
        if (!controller.signal.aborted) setSignedIn(false);
      });
    return () => controller.abort();
  }, []);

  return (
    <>
      {signedIn === false ? (
        <a
          href={signInHref()}
          className="hidden text-[13.5px] text-text-dark-secondary transition-colors hover:text-text-dark-primary md:inline-flex"
        >
          {t("common.signIn")}
        </a>
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

/** The same pair inside the mobile sheet, where both are always shown. */
export function SignInControlMobile({
  onNavigate,
}: {
  readonly onNavigate: () => void;
}) {
  const t = useTranslations();

  return (
    <>
      <a
        href={siteConfig.appUrl}
        onClick={onNavigate}
        className="mt-4 rounded-[10px] bg-brand-gradient px-4 py-2.5 text-center font-semibold text-brand-on-accent shadow-cta-sm"
      >
        {t("common.getStarted")}
      </a>
      <a
        href={signInHref()}
        onClick={onNavigate}
        className="text-center text-[15px] text-text-dark-secondary transition-colors hover:text-text-dark-primary"
      >
        {t("common.signIn")}
      </a>
    </>
  );
}
