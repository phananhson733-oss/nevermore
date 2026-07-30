// @input  -- locale param, playbooks i18n namespace, siteConfig, playbook-public-data
// @output -- /playbooks index page: title, subtitle, 3-col card grid linking to detail pages
// @pos    -- programmatic SEO, playbook library landing page for Phase 3.2
// once this file is updated, update header comments and _DIR.md in this folder

import { getTranslations } from "next-intl/server";
import { generatePageMetadata } from "@/lib/seo";
import { siteConfig } from "@/config/site";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import { PlaybookCard } from "@/components/playbooks/playbook-card";
import { getPublicPlaybooks } from "@/lib/mock/playbook-public-data";

const PATH = "/playbooks";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "playbooks" });

  return generatePageMetadata({
    title: `${t("title")} -- GenGrowth`,
    description: t("subtitle"),
    locale,
    path: PATH,
  });
}

export default async function PlaybooksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "playbooks" });
  const tCommon = await getTranslations({ locale, namespace: "common" });

  const homeLabel = tCommon("home");
  const playbooksLabel = t("title");

  const playbooks = getPublicPlaybooks();

  const industryLabels: Record<string, string> = {
    saas: t("industrySaas"),
    content: t("industryContent"),
    ecommerce: t("industryEcommerce"),
    devtool: t("industryDevtool"),
  };
  const channelLabels: Record<string, string> = {
    seo: t("channelSeo"),
    social: t("channelSocial"),
    link: t("channelLink"),
    email: t("channelEmail"),
    community: t("channelCommunity"),
  };
  const goalLabels: Record<string, string> = {
    traffic: t("goalTraffic"),
    conversion: t("goalConversion"),
    retention: t("goalRetention"),
  };

  return (
    <div className="max-w-content mx-auto px-4 py-12">
      <BreadcrumbJsonLd
        items={[
          { name: homeLabel, url: `${siteConfig.url}/${locale}` },
          { name: playbooksLabel },
        ]}
      />
      <VisibleBreadcrumb
        items={[
          { label: homeLabel, href: `/${locale}` },
          { label: playbooksLabel },
        ]}
      />

      <div className="mb-12">
        <h1 className="text-text-dark-primary font-bold text-[28px] md:text-[36px] tracking-[-0.02em] mb-3">
          {t("title")}
        </h1>
        <p className="text-text-dark-secondary text-[15px] max-w-2xl">
          {t("subtitle")}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {playbooks.map((playbook) => {
          const content = playbook.content[locale] ?? playbook.content["en"];
          return (
            <PlaybookCard
              key={playbook.slug}
              playbook={playbook}
              locale={locale}
              content={content}
              labels={{
                successRate: t("successRate"),
                steps: t("steps"),
                industry: industryLabels[playbook.industry] ?? playbook.industry,
                channel: channelLabels[playbook.channel] ?? playbook.channel,
                goal: goalLabels[playbook.goal] ?? playbook.goal,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
