// @input  — URL locale routing, next-intl messages, Google Fonts, PageShell
// @output — statically enumerable locale shell + scoped client translations
// @pos    — 国际化布局层，渲染 HTML 外壳并注入翻译上下文和全局组件
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { IBM_Plex_Sans, IBM_Plex_Mono, IBM_Plex_Serif } from "next/font/google";
import { routing } from "@/i18n/routing";
import { PageShell } from "@/components/layout/page-shell";
import { localePath } from "@/lib/locale-path";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

// Signal Console v1 排印：IBM Plex Sans 承担拉丁阅读文字，mono 只用于数据、
// eyebrow 和小标签；中文由 globals.css 的本地系统字体栈回退，避免构建依赖远程分片。
const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-ibm-plex-sans",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-ibm-plex-mono",
  weight: ["400", "500", "600"],
  display: "swap",
});

// Serif is reserved for the Content Draft Writer's article body (globals.css
// --font-serif); it is loaded here so the variable exists on every page.
const ibmPlexSerif = IBM_Plex_Serif({
  subsets: ["latin"],
  variable: "--font-ibm-plex-serif",
  weight: ["400", "500", "600"],
  display: "swap",
});

const fontVars = [
  ibmPlexSans.variable,
  ibmPlexMono.variable,
  ibmPlexSerif.variable,
].join(" ");

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as "en" | "zh")) {
    notFound();
  }
  // next-intl otherwise resolves the locale from request headers and opts the
  // entire marketing tree into dynamic rendering. The URL segment is already
  // the sole locale authority, so bind it before reading messages.
  setRequestLocale(locale);
  const messages = await getMessages();
  // Keep the global client boundary deliberately small. Route-level client
  // surfaces provide their own namespace below this shell, so legacy content
  // copy is not serialized into every public page.
  const shellMessages = {
    common: messages.common,
    nav: messages.nav,
    footer: messages.footer,
    cookie: messages.cookie,
    // The sign-in dialog lives in the Header, so it is part of the shell on
    // every page rather than a route-level surface. Five short strings.
    auth: messages.auth,
    // The free-during-testing notice appears on every tool page. Omitting this
    // namespace would not throw: next-intl renders the missing key's path, so
    // the page would read "credits.account.welfareNotice" instead.
    credits: messages.credits,
    // The account menu hangs off the header avatar on every page, and was
    // caught rendering "account.menu.balance" in exactly the way the note
    // above describes.
    account: messages.account,
  };
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/*
          主题必须在首帧之前定下来，所以这段脚本是同步的、内联的，且排在
          <head> 的最前面。它读 localStorage 把 data-theme 写到 <html> 上；
          选了浅色的访客因此不会在每次导航时先闪一下深色底。

          这是本站唯一一处 dangerouslySetInnerHTML：内容是 lib/theme.ts 里的
          常量字符串，不接受任何外部输入，没有可注入的面。<html> 上的
          suppressHydrationWarning 就是为它准备的——服务端发出的 HTML 上没有
          这个属性，客户端 hydrate 时它已经在了。
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <link
          rel="alternate"
          type="application/rss+xml"
          title={`GenGrowth Blog (${locale})`}
          href={localePath(locale, "/blog/rss.xml")}
        />
      </head>
      <body className={`${fontVars} font-sans antialiased`}>
        <NextIntlClientProvider messages={shellMessages}>
          <PageShell>{children}</PageShell>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
