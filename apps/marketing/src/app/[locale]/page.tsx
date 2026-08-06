// @input  — URL locale, localized messages, homepage JSON-LD and client view
// @output — statically rendered localized marketing homepage
// @pos    — [locale] 下的免费工具与产品工作流入口
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { generatePageMetadata } from "@/lib/seo";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import {
  OrganizationJsonLd,
  SoftwareApplicationJsonLd,
} from "@/components/seo/json-ld";
import HomePageClient from "./home-page-client";
import { GoogleOneTap } from "@/components/auth/google-one-tap";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return generatePageMetadata({
    title:
      locale === "en"
        ? "Evidence-led SEO growth, from diagnosis to action"
        : "从诊断到行动的证据驱动 SEO 增长系统",
    description:
      locale === "en"
        ? "Free SEO diagnostics and a connected workflow for keyword research, site structure, internal links, and authority building."
        : "免费 SEO 诊断，以及串联关键词研究、网站结构、内链与外链建设的增长工作流。",
    locale,
    path: "",
  });
}

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();
  return (
    <>
      <OrganizationJsonLd />
      <SoftwareApplicationJsonLd />
      {/* One Tap is mounted where signing in is plausibly the next step —
          the homepage and the tools pages — rather than site-wide, so it does
          not interrupt someone reading a blog post. */}
      <GoogleOneTap />
      <NextIntlClientProvider
        messages={{
          home: messages.home,
          tools: { seoAudit: messages.tools.seoAudit },
        }}
      >
        <HomePageClient />
      </NextIntlClientProvider>
    </>
  );
}
