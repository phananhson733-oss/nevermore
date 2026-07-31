// @input  — i18n/routing, next-intl, Google Fonts (DM Sans, Space Grotesk, Noto Sans SC), PageShell
// @output — <html>/<body> + shell-scoped NextIntlClientProvider + font CSS variables
// @pos    — 国际化布局层，渲染 HTML 外壳并注入翻译上下文和全局组件
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { Space_Grotesk, DM_Sans, Noto_Sans_SC } from "next/font/google";
import { routing } from "@/i18n/routing";
import { PageShell } from "@/components/layout/page-shell";
import { localePath } from "@/lib/locale-path";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  weight: ["400", "500", "600"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  variable: "--font-noto-sans-sc",
  weight: ["400", "500"],
  display: "swap",
});

const fontVars = [
  dmSans.variable,
  spaceGrotesk.variable,
  notoSansSC.variable,
].join(" ");

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
