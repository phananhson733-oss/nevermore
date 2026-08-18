// @input  — URL locale, localized messages, homepage JSON-LD and client view
// @output — statically rendered localized marketing homepage
// @pos    — [locale] 下的账号门槛 Agent 审计与产品工作流入口
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
        ? "Run the SEO Agent for a bounded URL audit after verifying a GenGrowth account. No payment, Search Console connection, site-ownership check, or saved run history."
        : "验证 GenGrowth 账号后，用 SEO Agent 做有边界的 URL 审计；无需付费、连接 Search Console、验证站点所有权，也不会保存运行历史。",
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
