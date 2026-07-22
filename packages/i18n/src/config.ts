export const LOCALES = ["en", "zh-CN"] as const;

export type UiLocale = (typeof LOCALES)[number];

/** Chinese-first customer workspace; an explicit cookie still selects English. */
export const DEFAULT_LOCALE: UiLocale = "zh-CN";

export const UI_LOCALE_COOKIE = "sf_ui_locale";

export function isUiLocale(x: string): x is UiLocale {
  return (LOCALES as readonly string[]).includes(x);
}

export function resolveUiLocale(cookieValue: string | null | undefined): UiLocale {
  if (cookieValue != null && isUiLocale(cookieValue)) {
    return cookieValue;
  }
  return DEFAULT_LOCALE;
}
