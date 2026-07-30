// @input  -- locale + slug params, playbooks i18n namespace, playbook-public-data
// @output -- /playbooks/[slug] detail page: overview, conditions, steps, results, CTA, related
// @pos    -- programmatic SEO, playbook detail page for Phase 3.2
// once this file is updated, update header comments and _DIR.md in this folder

import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { generatePageMetadata } from "@/lib/seo";
import { siteConfig } from "@/config/site";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import Link from "next/link";
import {
  getPublicPlaybooks,
  getPublicPlaybookBySlug,
} from "@/lib/mock/playbook-public-data";
import { PlaybookCard } from "@/components/playbooks/playbook-card";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const playbook = getPublicPlaybookBySlug(slug);
  if (!playbook) return { title: "Not Found" };

  const content = playbook.content[locale] ?? playbook.content["en"];
  return generatePageMetadata({
    title: `${content.title} -- GenGrowth`,
    description: content.description,
    locale,
    path: `/playbooks/${slug}`,
  });
}

export default async function PlaybookDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const playbook = getPublicPlaybookBySlug(slug);
  if (!playbook) notFound();

  const t = await getTranslations({ locale, namespace: "playbooks" });
  const tCommon = await getTranslations({ locale, namespace: "common" });

  const homeLabel = tCommon("home");
  const playbooksLabel = t("title");
  const content = playbook.content[locale] ?? playbook.content["en"];

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

  const allPlaybooks = getPublicPlaybooks();
  const related = allPlaybooks
    .filter(
      (p) =>
        p.slug !== playbook.slug &&
        (p.industry === playbook.industry || p.channel === playbook.channel),
    )
    .slice(0, 3);

  const successPct = Math.round(playbook.successRate * 100);

  return (
    <div className="max-w-content mx-auto px-4 py-12">
      <BreadcrumbJsonLd
        items={[
          { name: homeLabel, url: `${siteConfig.url}/${locale}` },
          {
            name: playbooksLabel,
            url: `${siteConfig.url}/${locale}/playbooks`,
          },
          { name: content.title },
        ]}
      />
      <VisibleBreadcrumb
        items={[
          { label: homeLabel, href: `/${locale}` },
          { label: playbooksLabel, href: `/${locale}/playbooks` },
          { label: content.title },
        ]}
      />

      {/* Overview */}
      <div className="mb-10">
        <div className="flex flex-wrap gap-2 mb-4">
          <span className="inline-block rounded-full bg-brand-accent/15 px-2.5 py-0.5 text-[11px] font-medium text-brand-accent-text uppercase tracking-wide">
            {industryLabels[playbook.industry] ?? playbook.industry}
          </span>
          <span className="inline-block rounded-full bg-brand-bg-alt/60 border border-brand-border/50 px-2.5 py-0.5 text-[11px] font-medium text-text-dark-secondary uppercase tracking-wide">
            {channelLabels[playbook.channel] ?? playbook.channel}
          </span>
          <span className="inline-block rounded-full bg-brand-bg-alt/60 border border-brand-border/50 px-2.5 py-0.5 text-[11px] font-medium text-text-dark-secondary uppercase tracking-wide">
            {goalLabels[playbook.goal] ?? playbook.goal}
          </span>
        </div>
        <h1 className="text-text-dark-primary font-bold text-[28px] md:text-[36px] tracking-[-0.02em] mb-4">
          {content.title}
        </h1>
        <p className="text-text-dark-secondary text-[16px] leading-relaxed max-w-2xl mb-6">
          {content.description}
        </p>
        <div className="flex gap-6 text-[13px] text-text-dark-secondary">
          <span>
            <span className="text-text-dark-primary font-semibold text-[20px]">
              {successPct}%
            </span>{" "}
            {t("successRate")}
          </span>
          <span>
            <span className="text-text-dark-primary font-semibold text-[20px]">
              {playbook.stepCount}
            </span>{" "}
            {t("steps")}
          </span>
        </div>
      </div>

      {/* Applicable Conditions */}
      <section className="mb-10">
        <h2 className="text-text-dark-primary font-semibold text-[20px] mb-4">
          {t("applicableConditions")}
        </h2>
        <ul className="space-y-2">
          {content.applicableConditions.map((condition) => (
            <li
              key={condition}
              className="flex items-start gap-3 text-text-dark-secondary text-[14px] leading-relaxed"
            >
              <span
                className="mt-1.5 w-1.5 h-1.5 rounded-full bg-brand-accent flex-shrink-0"
                aria-hidden="true"
              />
              {condition}
            </li>
          ))}
        </ul>
      </section>

      {/* Steps */}
      <section className="mb-10">
        <h2 className="text-text-dark-primary font-semibold text-[20px] mb-6">
          {t("steps")}
        </h2>
        <ol className="space-y-6">
          {content.steps.map((step) => (
            <li key={step.order} className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-accent/15 border border-brand-accent/30 flex items-center justify-center text-brand-accent-text font-semibold text-[13px]">
                {step.order}
              </span>
              <div>
                <h3 className="text-text-dark-primary font-medium text-[15px] mb-1">
                  {step.title}
                </h3>
                <p className="text-text-dark-secondary text-[13px] leading-relaxed">
                  {step.description}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Expected Results */}
      <section className="mb-12 rounded-xl border border-brand-accent/20 bg-brand-accent/5 p-6">
        <h2 className="text-text-dark-primary font-semibold text-[18px] mb-3">
          {t("expectedResults")}
        </h2>
        <p className="text-text-dark-secondary text-[14px] leading-relaxed">
          {content.expectedResults}
        </p>
      </section>

      {/* CTA */}
      <div className="mb-16 text-center">
        <p className="text-text-dark-secondary text-[14px] mb-4">
          {t("waitlistCta")}
        </p>
        <Link
          href={`/${locale}#waitlist`}
          className="inline-block rounded-full bg-brand-accent px-8 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-brand-accent/90"
        >
          {t("importCta")}
        </Link>
      </div>

      {/* Related Playbooks */}
      {related.length > 0 && (
        <section className="mb-10">
          <h2 className="text-text-dark-primary font-semibold text-[20px] mb-6">
            {t("relatedPlaybooks")}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {related.map((rel) => {
              const relContent = rel.content[locale] ?? rel.content["en"];
              return (
                <PlaybookCard
                  key={rel.slug}
                  playbook={rel}
                  locale={locale}
                  content={relContent}
                  labels={{
                    successRate: t("successRate"),
                    steps: t("steps"),
                    industry: industryLabels[rel.industry] ?? rel.industry,
                    channel: channelLabels[rel.channel] ?? rel.channel,
                    goal: goalLabels[rel.goal] ?? rel.goal,
                  }}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* Back link */}
      <div className="text-center">
        <Link
          href={`/${locale}/playbooks`}
          className="text-text-dark-secondary text-[13px] hover:text-text-dark-primary transition-colors"
        >
          &larr; {t("backToPlaybooks")}
        </Link>
      </div>
    </div>
  );
}
