// @input  — URL locale routing, next-intl messages, Google Fonts, PageShell
// @output — statically enumerable locale shell + scoped client translations
// @pos    — 国际化布局层，渲染 HTML 外壳并注入翻译上下文和全局组件
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { IBM_Plex_Sans, IBM_Plex_Mono, Noto_Sans_SC } from "next/font/google";
import { routing } from "@/i18n/routing";
import { PageShell } from "@/components/layout/page-shell";
import { localePath } from "@/lib/locale-path";

// Signal Console v1 排印：一个 sans 家族承担全部阅读文字，mono 只用于数据、
// eyebrow 和小标签。globals.css 通过这三个 CSS 变量绑定 --font-sans/display/mono。
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

// 标题字重在新规范里 600 封顶，所以中文侧也只到 600——避免浏览器为 600 合成
// 伪粗体，同时不为一个用不到的 700 拉一份中文字形分片。
const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  variable: "--font-noto-sans-sc",
  weight: ["400", "500", "600"],
  display: "swap",
});

const fontVars = [
  ibmPlexSans.variable,
  ibmPlexMono.variable,
  notoSansSC.variable,
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
  };
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
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
