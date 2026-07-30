// @input  — generatePageMetadata, getTranslations, FaqPageJsonLd, BreadcrumbJsonLd, HowToJsonLd
// @output — Features 核心能力页面（server component + generateMetadata + FAQ/HowTo JSON-LD）
// @pos    — 营销官网能力页，对应 SPEC 2.6
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { getTranslations } from "next-intl/server";
import { generatePageMetadata } from "@/lib/seo";
import { siteConfig } from "@/config/site";
import {
  FaqPageJsonLd,
  BreadcrumbJsonLd,
  HowToJsonLd,
} from "@/components/seo/json-ld";
import FeaturesPageClient from "./features-page-client";

const CAPABILITY_NS = [
  "discovery",
  "strategy",
  "execution",
  "attribution",
  "optimization",
  "governance",
] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return generatePageMetadata({
    title: locale === "en" ? "Features — GenGrowth" : "核心能力 — GenGrowth",
    description:
      locale === "en"
        ? "Six capabilities that turn minimal input into measurable growth: discovery, strategy, execution, attribution, optimization, governance."
        : "六大能力将最小输入转化为可量化增长：发现、策略、执行、归因、优化、治理。",
    locale,
    path: "/features",
  });
}

export default async function FeaturesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Collect FAQ data from all 6 capability namespaces
  const faqs: { q: string; a: string }[] = [];
  for (const ns of CAPABILITY_NS) {
    const t = await getTranslations({
      locale,
      namespace: `features.${ns}`,
    });
    faqs.push({ q: t("faq1Q"), a: t("faq1A") });
    faqs.push({ q: t("faq2Q"), a: t("faq2A") });
  }

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          {
            name: locale === "en" ? "Home" : "首页",
            url: `${siteConfig.url}/${locale}`,
          },
          {
            name: locale === "en" ? "Features" : "核心能力",
          },
        ]}
      />
      <FaqPageJsonLd faqs={faqs} />
      <HowToJsonLd
        name="How Auto Discovery Works"
        steps={[
          {
            name: "Enter URL",
            text: "Enter your product URL — the system scans site structure, content, and search performance",
          },
          {
            name: "AI Analysis",
            text: "AI identifies keyword gaps, competitor positions, and untapped opportunities",
          },
          {
            name: "Review Results",
            text: "Review prioritized opportunity list ranked by expected ROI",
          },
        ]}
      />
      <HowToJsonLd
        name="How Strategy Generation Works"
        steps={[
          {
            name: "Select Opportunities",
            text: "Choose which discovered opportunities to pursue from the prioritized list",
          },
          {
            name: "AI Generates Strategies",
            text: "AI creates actionable growth strategies with timelines, effort estimates, and expected impact",
          },
          {
            name: "Review and Approve",
            text: "Review generated strategies, adjust priorities, and approve for execution",
          },
        ]}
      />
      <HowToJsonLd
        name="How Automated Execution Works"
        steps={[
          {
            name: "Approve Strategy",
            text: "Select an approved strategy and confirm execution parameters",
          },
          {
            name: "Automated Execution",
            text: "The system executes SEO, content, and link-building tasks automatically",
          },
          {
            name: "Monitor Progress",
            text: "Track real-time execution progress and review completed deliverables",
          },
        ]}
      />
      <HowToJsonLd
        name="How Growth Attribution Works"
        steps={[
          {
            name: "Connect Analytics",
            text: "Link your analytics platforms to enable cross-channel data collection",
          },
          {
            name: "Track Impact",
            text: "The system attributes traffic, ranking, and conversion changes to specific strategies",
          },
          {
            name: "View Reports",
            text: "Review attribution dashboards showing ROI per strategy and channel",
          },
        ]}
      />
      <HowToJsonLd
        name="How Continuous Optimization Works"
        steps={[
          {
            name: "Collect Performance Data",
            text: "The system continuously monitors strategy outcomes and market changes",
          },
          {
            name: "AI Recommends Adjustments",
            text: "AI analyzes performance data and suggests strategy refinements",
          },
          {
            name: "Apply Optimizations",
            text: "Review and apply recommended optimizations to improve growth velocity",
          },
        ]}
      />
      <HowToJsonLd
        name="How Growth Governance Works"
        steps={[
          {
            name: "Set Policies",
            text: "Define brand guidelines, compliance rules, and approval workflows",
          },
          {
            name: "Automated Checks",
            text: "Every strategy and execution passes through governance checks before deployment",
          },
          {
            name: "Audit Trail",
            text: "Review complete audit logs of all actions, approvals, and policy decisions",
          },
        ]}
      />
      <FeaturesPageClient />
    </>
  );
}
