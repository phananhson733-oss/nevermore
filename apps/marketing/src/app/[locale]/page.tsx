// @input  — generatePageMetadata, OrganizationJsonLd, SoftwareApplicationJsonLd, HomePageClient
// @output — 营销官网首页（server component + generateMetadata + JSON-LD）
// @pos    — [locale] 下的首页入口，对应 SPEC 2.5
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { generatePageMetadata } from "@/lib/seo";
import {
  OrganizationJsonLd,
  SoftwareApplicationJsonLd,
} from "@/components/seo/json-ld";
import HomePageClient from "./home-page-client";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return generatePageMetadata({
    title:
      locale === "en"
        ? "GenGrowth — Automated Growth Operating System"
        : "GenGrowth — 自动化增长操作系统",
    description:
      locale === "en"
        ? "Minimal input, auto decisions, explainable, self-optimizing. AI-powered growth for ambitious teams."
        : "最小输入、自动决策、可解释、自优化。为有野心的团队打造的 AI 驱动增长系统。",
    locale,
    path: "",
  });
}

export default function Home() {
  return (
    <>
      <OrganizationJsonLd />
      <SoftwareApplicationJsonLd />
      <HomePageClient />
    </>
  );
}
