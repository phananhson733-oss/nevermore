// @input  -- independently degradable identity, Credits, and Websites account state
// @output -- accessible desktop avatar menu plus click-only mobile parity
// @pos    -- signed-in account navigation in the global header
"use client";

import Link from "next/link";
import {
  Bot,
  CreditCard,
  Gift,
  Globe2,
  LogOut,
  Settings,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import type { AccountState } from "../../lib/auth/use-account.ts";
import { localePath } from "../../lib/locale-path.ts";
import { LanguageSwitcher } from "../layout/language-switcher.tsx";
import { ThemeToggle } from "../layout/theme-toggle.tsx";
import { signOut } from "./sign-out-action.ts";

const AVATAR_SIZE_SUFFIX = "=s72-c-rw";
const MENU_ITEM_CLASS =
  "flex min-h-10 w-full items-center gap-3 rounded-[8px] px-3 py-2 text-left text-[13px] text-text-dark-secondary outline-none transition-colors hover:bg-brand-panel-raised hover:text-text-dark-primary focus:bg-brand-panel-raised focus:text-text-dark-primary";

function sizedAvatar(url: string): string {
  const options = url.indexOf("=");
  return options === -1
    ? url + AVATAR_SIZE_SUFFIX
    : url.slice(0, options) + AVATAR_SIZE_SUFFIX;
}

function initial(email: string | null): string {
  const first = email?.trim().charAt(0) ?? "";
  return first === "" ? "•" : first.toUpperCase();
}

function Avatar({
  email,
  avatarUrl,
  photoFailed,
  onPhotoError,
  size = "small",
}: {
  readonly email: string | null;
  readonly avatarUrl: string | null;
  readonly photoFailed: boolean;
  readonly onPhotoError: () => void;
  readonly size?: "small" | "large";
}) {
  const photo = avatarUrl !== null && !photoFailed ? avatarUrl : null;
  const dimensions = size === "small" ? 36 : 48;
  const className =
    size === "small"
      ? "size-9 text-[13px]"
      : "size-12 text-[17px]";
  return (
    <span
      className={
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-brand-border-card bg-brand-panel-raised font-semibold text-text-dark-primary " +
        className
      }
    >
      {photo === null ? (
        initial(email)
      ) : (
        <img
          src={sizedAvatar(photo)}
          alt=""
          width={dimensions}
          height={dimensions}
          referrerPolicy="no-referrer"
          onError={onPhotoError}
          className="size-full object-cover"
        />
      )}
    </span>
  );
}

export function AccountMenu({ account }: { readonly account: AccountState }) {
  const t = useTranslations("account.menu");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const closeMenu = useCallback(
    (restoreFocus: boolean) => {
      cancelClose();
      if (restoreFocus) trigger.current?.focus();
      setOpen(false);
    },
    [cancelClose],
  );

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 160);
  }, [cancelClose]);

  const items = useCallback(
    () =>
      Array.from(
        menu.current?.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not([disabled])',
        ) ?? [],
      ),
    [],
  );

  const focusItem = useCallback(
    (position: "first" | "last" | number) => {
      queueMicrotask(() => {
        const available = items();
        if (available.length === 0) return;
        const index =
          position === "first"
            ? 0
            : position === "last"
              ? available.length - 1
              : (position + available.length) % available.length;
        available[index]?.focus();
      });
    },
    [items],
  );

  useEffect(() => cancelClose, [cancelClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
      }
    };
    const onPointer = (event: MouseEvent) => {
      const node = wrapper.current;
      if (node !== null && !node.contains(event.target as Node)) {
        closeMenu(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [closeMenu, open]);

  if (account.status !== "signed-in") return null;
  const { email, displayName, balance, avatarUrl, websites } = account;
  const primary = websites.status === "ready" ? websites.primary : null;

  const openFromKeyboard = (position: "first" | "last") => {
    cancelClose();
    setOpen(true);
    focusItem(position);
  };

  const handleMenuKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const available = items();
    const target = (event.target as HTMLElement).closest<HTMLElement>(
      '[role="menuitem"]',
    );
    const index = target === null ? -1 : available.indexOf(target);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(index < 0 ? "first" : index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(index < 0 ? "last" : index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusItem("first");
    } else if (event.key === "End") {
      event.preventDefault();
      focusItem("last");
    } else if (
      (event.key === "Enter" || event.key === " ") &&
      target !== null
    ) {
      event.preventDefault();
      target.click();
    }
  };

  const handleSignOut = () => {
    setSigningOut(true);
    void signOut().catch(() => setSigningOut(false));
  };

  const handleTriggerClick = () => {
    cancelClose();
    setOpen(true);
  };

  return (
    <div
      ref={wrapper}
      className="relative"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        onClick={handleTriggerClick}
        onFocus={() => {
          cancelClose();
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (
            event.key === "ArrowDown" ||
            event.key === "Enter" ||
            event.key === " "
          ) {
            event.preventDefault();
            openFromKeyboard("first");
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            openFromKeyboard("last");
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "account-avatar-menu" : undefined}
        aria-label={displayName ?? email ?? t("label")}
        className="rounded-full outline-none transition-colors hover:ring-1 hover:ring-brand-accent/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
      >
        <Avatar
          email={email}
          avatarUrl={avatarUrl}
          photoFailed={photoFailed}
          onPhotoError={() => setPhotoFailed(true)}
        />
      </button>

      {open ? (
        <div
          ref={menu}
          id="account-avatar-menu"
          role="menu"
          aria-label={t("label")}
          onKeyDown={handleMenuKey}
          className="absolute top-[calc(100%+10px)] right-0 z-50 w-[320px] rounded-card border border-brand-border-card bg-brand-panel p-3 shadow-panel"
        >
          <div className="relative flex items-center gap-3 px-2 py-2">
            <Avatar
              email={email}
              avatarUrl={avatarUrl}
              photoFailed={photoFailed}
              onPhotoError={() => setPhotoFailed(true)}
              size="large"
            />
            <div className="min-w-0 pr-10">
              {displayName === null ? null : (
                <p className="truncate text-[14px] font-semibold text-text-dark-primary">
                  {displayName}
                </p>
              )}
              {email === null ? null : (
                <p className="truncate text-[12px] text-text-dark-secondary">
                  {email}
                </p>
              )}
              {balance === null ? null : (
                <>
                  <p className="mt-1 font-mono text-[11px] text-text-dark-faint">
                    {balance.total} {t("credits")}
                  </p>
                  {balance.welfareRemaining === null ? null : (
                    <p className="mt-0.5 font-mono text-[10px] text-text-dark-faint">
                      {t("welfareRemaining", {
                        remaining: balance.welfareRemaining,
                      })}
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="absolute top-1 right-1">
              <ThemeToggle menuItem onAction={() => closeMenu(true)} />
            </div>
          </div>

          <div className="my-2 border-t border-brand-border-card" />

          <Link
            role="menuitem"
            tabIndex={-1}
            href={localePath(locale, "/account/credits")}
            onClick={() => closeMenu(false)}
            className={MENU_ITEM_CLASS}
          >
            <CreditCard aria-hidden="true" className="size-4" />
            <span>{t("credits")}</span>
            {balance === null ? null : (
              <span className="ml-auto rounded-full border border-brand-border-card px-2 py-0.5 font-mono text-[11px] text-text-dark-primary">
                {balance.total}
              </span>
            )}
          </Link>

          {websites.status !== "ready" ? null : primary === null ? (
            <Link
              role="menuitem"
              tabIndex={-1}
              href={localePath(locale, "/account/websites")}
              onClick={() => closeMenu(false)}
              className={MENU_ITEM_CLASS}
            >
              <Globe2 aria-hidden="true" className="size-4" />
              <span>{t("addWebsite")}</span>
            </Link>
          ) : (
            <Link
              role="menuitem"
              tabIndex={-1}
              href={localePath(
                locale,
                "/account/websites/" + primary.websiteId,
              )}
              onClick={() => closeMenu(false)}
              className={MENU_ITEM_CLASS}
            >
              <Globe2 aria-hidden="true" className="size-4" />
              <span className="min-w-0">
                <span className="block truncate">
                  {primary.displayName ?? primary.host}
                </span>
                <span className="block truncate text-[10px] text-text-dark-faint">
                  {primary.host}
                </span>
              </span>
            </Link>
          )}

          <Link
            role="menuitem"
            tabIndex={-1}
            href={localePath(locale, "/account/websites")}
            onClick={() => closeMenu(false)}
            className={MENU_ITEM_CLASS}
          >
            <Settings aria-hidden="true" className="size-4" />
            <span>{t("settings")}</span>
          </Link>
          <Link
            role="menuitem"
            tabIndex={-1}
            href={localePath(locale, "/agents")}
            onClick={() => closeMenu(false)}
            className={MENU_ITEM_CLASS}
          >
            <Bot aria-hidden="true" className="size-4" />
            <span>{t("agents")}</span>
          </Link>

          <div className="my-2 border-t border-brand-border-card" />

          <div className="flex items-center gap-3 rounded-[8px] px-3">
            <span className="text-[13px] text-text-dark-secondary">
              {t("language")}
            </span>
            <div className="ml-auto">
              <LanguageSwitcher
                menuItem
                onAction={() => closeMenu(true)}
              />
            </div>
          </div>
          <Link
            role="menuitem"
            tabIndex={-1}
            href={localePath(locale, "/account/credits") + "#referral"}
            onClick={() => closeMenu(false)}
            className={MENU_ITEM_CLASS}
          >
            <Gift aria-hidden="true" className="size-4" />
            <span>{t("referral")}</span>
          </Link>

          <div className="my-2 border-t border-brand-border-card" />

          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={handleSignOut}
            disabled={signingOut}
            className={MENU_ITEM_CLASS + " text-brand-error"}
          >
            <LogOut aria-hidden="true" className="size-4" />
            <span>{tCommon("signOut")}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AccountSummaryMobile({
  account,
  onNavigate,
}: {
  readonly account: AccountState;
  readonly onNavigate: () => void;
}) {
  const t = useTranslations("account.menu");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [signingOut, setSigningOut] = useState(false);

  if (account.status !== "signed-in") return null;
  const { email, displayName, balance, websites } = account;
  const primary = websites.status === "ready" ? websites.primary : null;
  const mobileLink =
    "flex min-h-11 items-center justify-between gap-3 text-[15px] text-text-dark-secondary transition-colors hover:text-text-dark-primary";

  return (
    <div className="mt-2 border-t border-brand-border-card pt-4">
      {displayName === null ? null : (
        <p className="truncate text-[15px] font-semibold text-text-dark-primary">
          {displayName}
        </p>
      )}
      {email === null ? null : (
        <p className="mt-0.5 truncate text-[12px] text-text-dark-secondary">
          {email}
        </p>
      )}
      <div className="mt-3 space-y-1">
        <Link
          href={localePath(locale, "/account/credits")}
          onClick={onNavigate}
          className={mobileLink}
        >
          <span>{t("credits")}</span>
          {balance === null ? null : (
            <span className="font-mono text-[15px] text-text-dark-primary">
              {balance.total}
            </span>
          )}
        </Link>
        {websites.status !== "ready" ? null : (
          <Link
            href={
              primary === null
                ? localePath(locale, "/account/websites")
                : localePath(
                    locale,
                    "/account/websites/" + primary.websiteId,
                  )
            }
            onClick={onNavigate}
            className={mobileLink}
          >
            <span>
              {primary === null
                ? t("addWebsite")
                : primary.displayName ?? primary.host}
            </span>
          </Link>
        )}
        <Link
          href={localePath(locale, "/account/websites")}
          onClick={onNavigate}
          className={mobileLink}
        >
          <span>{t("settings")}</span>
        </Link>
        <Link
          href={localePath(locale, "/agents")}
          onClick={onNavigate}
          className={mobileLink}
        >
          <span>{t("agents")}</span>
        </Link>
        <div className="flex min-h-11 items-center justify-between">
          <span className="text-[15px] text-text-dark-secondary">
            {t("language")}
          </span>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageSwitcher />
          </div>
        </div>
        <Link
          href={localePath(locale, "/account/credits") + "#referral"}
          onClick={onNavigate}
          className={mobileLink}
        >
          <span>{t("referral")}</span>
        </Link>
      </div>
      <button
        type="button"
        onClick={() => {
          setSigningOut(true);
          void signOut().catch(() => setSigningOut(false));
        }}
        disabled={signingOut}
        className="mt-4 flex min-h-11 items-center gap-2 text-[15px] text-brand-error transition-opacity disabled:opacity-60"
      >
        <LogOut aria-hidden="true" className="size-4" />
        {tCommon("signOut")}
      </button>
    </div>
  );
}
