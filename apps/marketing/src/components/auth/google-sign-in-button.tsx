// @input  -- lib/auth/gsi-client, next-intl locale
// @output — Google 官方登录按钮；不可用时在新标签页回落到 app 站登录页
// @pos    -- 登录弹层的主体，SignInDialog 使用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { ensureGoogleIdentity } from "../../lib/auth/gsi-client";
import { siteConfig } from "../../config/site";

/** Google's button ships its own width; this keeps the panel from reflowing. */
const BUTTON_WIDTH = 280;

type Status = "loading" | "ready" | "unavailable";

/**
 * The Google sign-in button, rendered by Google itself.
 *
 * `renderButton` draws into a cross-origin iframe, which is what lets the tap
 * count as a first-party gesture on accounts.google.com. That is also why the
 * button cannot be styled by us beyond the options Google exposes, and why a
 * hand-rolled button posting to the same endpoint would not be equivalent.
 *
 * Unlike One Tap this is not passive: it appears for every visitor, including
 * one with no Google session and one Google has decided to stop prompting.
 * That is the point — One Tap alone left the marketing site with no visible way
 * to sign in.
 *
 * When GSI cannot initialise at all (blocked script, unconfigured deployment,
 * nonce unavailable) the slot degrades to the product's own sign-in page rather
 * than showing a dead frame.
 */
export function GoogleSignInButton() {
  const t = useTranslations();
  const locale = useLocale();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let cancelled = false;

    void ensureGoogleIdentity()
      .then((clientId) => {
        if (cancelled) return;
        const host = hostRef.current;
        if (!clientId || !host || !window.google) {
          setStatus("unavailable");
          return;
        }
        // A remount would otherwise stack a second iframe under the first.
        host.replaceChildren();
        window.google.accounts.id.renderButton(host, {
          type: "standard",
          theme: "filled_black",
          size: "large",
          text: "continue_with",
          shape: "pill",
          logo_alignment: "center",
          width: BUTTON_WIDTH,
          locale,
        });
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [locale]);

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Kept mounted while loading: renderButton needs the node to exist. */}
      <div
        ref={hostRef}
        style={{ minHeight: status === "unavailable" ? 0 : 44 }}
        aria-busy={status === "loading"}
      />

      {status === "loading" ? (
        <p className="text-[13px] text-text-dark-secondary">
          {t("auth.loading")}
        </p>
      ) : null}

      {status === "unavailable" ? (
        <a
          href={`${siteConfig.appUrl}/login`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-brand-gradient px-[18px] text-[14px] font-semibold text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta"
        >
          {t("auth.continueOnApp")}
        </a>
      ) : null}
    </div>
  );
}
