// @input  -- the header 的共享登录态、localePath、common.*
// @output — 未登录时的登录按钮与指向 SEO Agent 的主审计按钮（登出在 account-menu）
// @pos    -- Header 右侧的登录入口，对应 SPEC 2.3.1
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useLocale, useTranslations } from "next-intl";
import { localePath } from "../../lib/locale-path";
import type { AccountState } from "../../lib/auth/use-account.ts";
import { signOut } from "./sign-out-action.ts";

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
  account,
  onSignIn,
}: {
  readonly account: AccountState;
  readonly onSignIn: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();

  const secondaryClass =
    "hidden h-9.5 items-center rounded-lg border border-brand-border-card px-[14px] text-[13.5px] text-text-dark-secondary transition-colors hover:border-brand-accent/40 hover:text-text-dark-primary disabled:opacity-60 md:inline-flex";

  return (
    <>
      {/* Signed in, this slot is empty: AccountMenu draws the avatar next to
          it, and sign-out lives inside that panel. */}
      {account.status === "signed-out" ? (
        <button type="button" onClick={onSignIn} className={secondaryClass}>
          {t("common.signIn")}
        </button>
      ) : null}

      <a
        href={localePath(locale, "/agents/seo")}
        className="hidden h-9.5 items-center rounded-lg bg-brand-gradient px-[18px] text-[13.5px] font-semibold text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta md:inline-flex"
      >
        {t("common.runAudit")}
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
  account,
  onNavigate,
  onSignIn,
}: {
  readonly account: AccountState;
  readonly onNavigate: () => void;
  readonly onSignIn: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const signedIn = account.status === "signed-in";

  return (
    <>
      <a
        href={localePath(locale, "/agents/seo")}
        onClick={onNavigate}
        className="mt-4 rounded-[10px] bg-brand-gradient px-4 py-2.5 text-center font-semibold text-brand-on-accent shadow-cta-sm"
      >
        {t("common.runAudit")}
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
