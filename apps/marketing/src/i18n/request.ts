// @input  — routing.ts 路由配置、messages/*.json 翻译文件
// @output — next-intl 服务端请求配置（locale + messages）
// @pos    — 服务端 i18n 入口，Next.js 每次请求时调用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

type Locale = (typeof routing.locales)[number];

function isValidLocale(value: string | undefined): value is Locale {
  return !!value && routing.locales.includes(value as Locale);
}

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!isValidLocale(locale)) {
    locale = routing.defaultLocale;
  }

  const [marketingMessages, trialMessages] = await Promise.all([
    import(`./messages/${locale}.json`),
    import(`./messages/app-${locale}.json`),
  ]);

  return {
    locale,
    messages: {
      ...marketingMessages.default,
      // The trial wizard is shared with the former product onboarding flow.
      // Keep only the two namespaces the public form uses, not the dashboard's
      // much larger private-message catalog.
      app: trialMessages.default,
    },
  };
});
