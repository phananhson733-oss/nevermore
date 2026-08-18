// @input  -- the header's shared account state and the account.menu.* copy
// @output -- the header avatar, and the panel naming the account and its balance
// @pos    -- the signed-in half of the header's right-hand slot
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { localePath } from "../../lib/locale-path";
import type { AccountState } from "../../lib/auth/use-account.ts";
import { signOut } from "./sign-out-action.ts";

/** The one glyph on the avatar. Falls back to a dot rather than an empty circle. */
function initial(email: string | null): string {
  const first = email?.trim().charAt(0) ?? "";
  return first === "" ? "•" : first.toUpperCase();
}

/**
 * The header's account menu.
 *
 * Renders nothing at all until we know a session exists, and nothing ever for
 * anyone signed out — the anonymous majority of this site's readers see the
 * slot exactly as it was. Sign-in stays with SignInControl; this component owns
 * only what a signed-in visitor needs, which is knowing which account they are
 * in, what it is worth, and how to leave.
 *
 * The balance is a separate question from the identity and is allowed to be
 * absent: /api/credits/balance answers 404 while the credits switch is off, and
 * the menu must still name the account and offer sign-out in that state. Two
 * requests rather than one for the same reason — the menu cannot be hostage to
 * a feature flag.
 *
 * Opening is hover OR click OR keyboard focus. Hover alone would make this
 * unreachable on a touchscreen and to anyone tabbing, and a click-only menu in
 * a place competitors open on hover reads as broken.
 */
export function AccountMenu({ account }: { readonly account: AccountState }) {
  const t = useTranslations("account.menu");
  // Sign-out is worded once, in common, because the mobile sheet says it too.
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A pointer crossing the gap between the avatar and the panel would otherwise
  // close it out from under the reader.
  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 160);
  }, [cancelClose]);

  useEffect(() => cancelClose, [cancelClose]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointer(event: MouseEvent): void {
      const node = wrapper.current;
      if (node !== null && !node.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  const handleSignOut = useCallback(() => {
    setSigningOut(true);
    void signOut().catch(() => setSigningOut(false));
  }, []);

  if (account.status !== "signed-in") return null;
  const { email, balance } = account;

  return (
    <div
      ref={wrapper}
      className="relative"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
      onFocus={() => {
        cancelClose();
        setOpen(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={email ?? t("label")}
        className="flex size-9 items-center justify-center rounded-full border border-brand-border-card bg-brand-panel-raised text-[13px] font-semibold text-text-dark-primary transition-colors hover:border-brand-accent/50"
      >
        {initial(email)}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={t("label")}
          className="absolute top-[calc(100%+10px)] right-0 z-50 w-64 rounded-card border border-brand-border-card bg-brand-panel p-4 shadow-panel"
        >
          {email === null ? null : (
            <p className="mb-3 truncate text-[13px] text-text-dark-primary">
              {email}
            </p>
          )}

          {balance === null ? null : (
            <div className="mb-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-text-dark-secondary">
                  {t("balance")}
                </span>
                <span className="font-mono text-[17px] text-text-dark-primary tabular-nums">
                  {balance.total}
                </span>
              </div>
              {balance.welfareRemaining === null ? null : (
                <p className="mt-1 font-mono text-[11px] text-text-dark-faint">
                  {t("welfareRemaining", {
                    remaining: balance.welfareRemaining,
                  })}
                </p>
              )}
            </div>
          )}

          <div className="-mx-4 border-t border-brand-border-card" />

          <Link
            role="menuitem"
            href={localePath(locale, "/account/credits")}
            onClick={() => setOpen(false)}
            className="mt-3 block text-[13px] text-text-dark-secondary transition-colors hover:text-text-dark-primary"
          >
            {t("ledger")}
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            disabled={signingOut}
            className="mt-2.5 block text-[13px] text-text-dark-secondary transition-colors hover:text-text-dark-primary disabled:opacity-60"
          >
            {tCommon("signOut")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The same account facts inside the mobile sheet.
 *
 * A panel that opens on hover has no meaning on a touchscreen, and the header
 * badge that used to carry the balance on every screen is gone, so without this
 * a phone would have no way to see it at all. Sign-out stays with
 * SignInControlMobile, which already owns that row of the sheet.
 */
export function AccountSummaryMobile({
  account,
  onNavigate,
}: {
  readonly account: AccountState;
  readonly onNavigate: () => void;
}) {
  const t = useTranslations("account.menu");
  const locale = useLocale();

  if (account.status !== "signed-in") return null;
  const { email, balance } = account;

  return (
    <div className="mt-2 border-t border-brand-border-card pt-4">
      {email === null ? null : (
        <p className="truncate text-[13px] text-text-dark-secondary">{email}</p>
      )}
      {balance === null ? null : (
        <Link
          href={localePath(locale, "/account/credits")}
          onClick={onNavigate}
          className="mt-2 flex items-baseline justify-between gap-3"
        >
          <span className="text-[15px] text-text-dark-secondary">
            {t("balance")}
          </span>
          <span className="font-mono text-[17px] text-text-dark-primary tabular-nums">
            {balance.total}
          </span>
        </Link>
      )}
    </div>
  );
}
