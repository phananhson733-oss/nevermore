"use client";

import { useEffect, useState } from "react";
import type { HTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE, LOCALES, UI_LOCALE_COOKIE, type UiLocale } from "@sf/i18n/config";
import { cx } from "./cx.ts";
import styles from "./ui.module.css";

const SEGMENT_LABEL: Record<UiLocale, string> = { en: "EN", "zh-CN": "中" };
const SEGMENT_FULL: Record<UiLocale, string> = { en: "English", "zh-CN": "简体中文" };
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // one year

function readLocaleCookie(): UiLocale | null {
  if (typeof document === "undefined") return null;
  const prefix = `${UI_LOCALE_COOKIE}=`;
  const row = document.cookie.split("; ").find((entry) => entry.startsWith(prefix));
  if (row === undefined) return null;
  const raw = decodeURIComponent(row.slice(prefix.length));
  return (LOCALES as readonly string[]).includes(raw) ? (raw as UiLocale) : null;
}

function writeLocaleCookie(locale: UiLocale): void {
  document.cookie = `${UI_LOCALE_COOKIE}=${encodeURIComponent(locale)}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

export interface LocaleSwitchProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  /** Current locale from the server. Recommended to avoid a hydration flash. */
  readonly value?: UiLocale;
  /** Notified after the cookie is written, before `router.refresh()`. */
  readonly onLocaleChange?: (locale: UiLocale) => void;
}

/**
 * Segmented EN | 中 UI-locale toggle (spec §4.3). Writes the `sf_ui_locale`
 * cookie (the `@sf/i18n` contract) and calls `router.refresh()` so the server
 * re-renders in the new locale WITHOUT changing the URL. When `value` is
 * omitted it reads the cookie after mount (hydration-safe: first render uses the
 * default, then syncs). No localStorage.
 */
export function LocaleSwitch({
  value,
  onLocaleChange,
  className,
  "aria-label": ariaLabel = "Language",
  ...rest
}: LocaleSwitchProps) {
  const router = useRouter();
  const [internal, setInternal] = useState<UiLocale>(value ?? DEFAULT_LOCALE);

  useEffect(() => {
    if (value !== undefined) return;
    const fromCookie = readLocaleCookie();
    if (fromCookie !== null) setInternal(fromCookie);
  }, [value]);

  const active = value ?? internal;

  function select(next: UiLocale): void {
    if (next === active) return;
    writeLocaleCookie(next);
    if (value === undefined) setInternal(next);
    onLocaleChange?.(next);
    router.refresh();
  }

  return (
    <div
      className={cx(styles.segmented, className)}
      role="group"
      aria-label={ariaLabel}
      {...rest}
    >
      {LOCALES.map((locale) => {
        const isActive = locale === active;
        return (
          <button
            key={locale}
            type="button"
            className={cx(styles.segment, isActive && styles.segmentActive)}
            aria-pressed={isActive}
            aria-label={SEGMENT_FULL[locale]}
            onClick={() => select(locale)}
          >
            {SEGMENT_LABEL[locale]}
          </button>
        );
      })}
    </div>
  );
}
