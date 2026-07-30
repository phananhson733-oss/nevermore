// @input  -- slug param, locale, use-cases data layer
// @output -- use case detail page with challenge/solution/steps/results/CTA
// @pos    -- programmatic SEO use case detail page
// once this file is updated, update header comments and _DIR.md in this folder
import { notFound } from "next/navigation";
import Link from "next/link";
import { getUseCaseBySlug, getUseCaseContent } from "@/lib/use-cases";
import { siteConfig } from "@/config/site";
import { generatePageMetadata } from "@/lib/seo";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const useCase = getUseCaseBySlug(slug);
  if (!useCase) {
    return generatePageMetadata({
      title: "Not Found",
      description: "",
      locale,
      path: `/use-cases/${slug}`,
    });
  }
  const c = getUseCaseContent(useCase, locale);
  return generatePageMetadata({
    title: `${c.title} -- GenGrowth`,
    description: c.description,
    locale,
    path: `/use-cases/${slug}`,
  });
}

const LABELS = {
  en: {
    home: "Home",
    useCases: "Use Cases",
    challenge: "Your Challenge",
    solution: "How GenGrowth Solves This",
    steps: "Step-by-Step: Getting Started",
    results: "Results You Can Expect",
    cta: "Start growing your product with GenGrowth",
    learnMore: "Learn More",
    back: "Back to Use Cases",
  },
  zh: {
    home: "首页",
    useCases: "应用场景",
    challenge: "你的挑战",
    solution: "GenGrowth 如何解决",
    steps: "快速上手步骤",
    results: "预期成果",
    cta: "用 GenGrowth 开始增长你的产品",
    learnMore: "了解更多",
    back: "返回应用场景",
  },
} as const;

export default async function UseCaseDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const useCase = getUseCaseBySlug(slug);
  if (!useCase) notFound();

  const c = getUseCaseContent(useCase, locale);
  const l = LABELS[locale as keyof typeof LABELS] ?? LABELS.en;

  const breadcrumbItems = [
    { name: l.home, url: `${siteConfig.url}/${locale}` },
    { name: l.useCases, url: `${siteConfig.url}/${locale}/use-cases` },
    { name: c.title },
  ];

  return (
    <div className="bg-brand-bg min-h-screen py-20 md:py-28">
      <div className="max-w-[720px] mx-auto px-6">
        <nav
          aria-label="Breadcrumb"
          className="text-text-dark-secondary text-[13px] mb-12"
        >
          <Link
            href={`/${locale}`}
            className="hover:text-text-dark-primary transition-colors"
          >
            {l.home}
          </Link>
          <span className="mx-2 opacity-40">/</span>
          <Link
            href={`/${locale}/use-cases`}
            className="hover:text-text-dark-primary transition-colors"
          >
            {l.useCases}
          </Link>
        </nav>

        <h1 className="text-3xl md:text-4xl font-bold text-text-dark-primary mb-4">
          {c.title}
        </h1>
        <p className="text-text-dark-secondary text-base leading-relaxed mb-12">
          {c.description}
        </p>

        <section className="mb-10">
          <h2 className="text-xl font-semibold text-text-dark-primary mb-4">
            {l.challenge}
          </h2>
          <div className="border-l-4 border-brand-accent pl-5 py-3">
            <p className="text-text-dark-secondary text-base leading-relaxed">
              {c.challenge}
            </p>
          </div>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold text-text-dark-primary mb-4">
            {l.solution}
          </h2>
          <p className="text-text-dark-secondary text-base leading-relaxed">
            {c.solution}
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold text-text-dark-primary mb-4">
            {l.steps}
          </h2>
          <ol className="space-y-3">
            {c.steps.map((step, idx) => (
              <li
                key={idx}
                className="flex gap-3 text-text-dark-secondary text-base leading-relaxed"
              >
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-brand-accent/20 text-brand-accent text-sm font-semibold flex items-center justify-center">
                  {idx + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-semibold text-text-dark-primary mb-4">
            {l.results}
          </h2>
          <div className="rounded-lg border border-white/[0.06] bg-brand-bg-secondary p-6">
            <p className="text-text-dark-secondary text-base leading-relaxed">
              {c.results}
            </p>
          </div>
        </section>

        <div className="rounded-lg border border-brand-accent/20 bg-brand-accent/[0.05] p-8 text-center">
          <p className="text-text-dark-secondary text-sm mb-4">{l.cta}</p>
          <Link
            href={`/${locale}/features`}
            className="inline-block rounded-lg bg-brand-accent px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-accent/90"
          >
            {l.learnMore}
          </Link>
        </div>

        <div className="mt-10">
          <Link
            href={`/${locale}/use-cases`}
            className="text-text-dark-secondary hover:text-brand-accent text-sm transition-colors"
          >
            {"<--"} {l.back}
          </Link>
        </div>

        <BreadcrumbJsonLd items={breadcrumbItems} />
      </div>
    </div>
  );
}
