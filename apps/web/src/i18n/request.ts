import { getMessages, resolveUiLocale, UI_LOCALE_COOKIE } from "@sf/i18n";
import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

/**
 * next-intl request config: resolve the UI locale from the `sf_ui_locale` cookie
 * (default `zh-CN`), and load the matching chrome messages (spec §4.3).
 */
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const locale = resolveUiLocale(cookieStore.get(UI_LOCALE_COOKIE)?.value);
  return { locale, messages: getMessages(locale) };
});
