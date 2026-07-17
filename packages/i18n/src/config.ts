export const LOCALES = ["en", "zh-CN"] as const;

export type UiLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: UiLocale = "en";

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
