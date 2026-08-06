// @input  -- locale route param, siteConfig, generatePageMetadata
// @output -- lightweight, direct contact page with an email and product handoff
// @pos    -- preserves a useful contact URL without reviving the legacy lead form
import { ArrowRight, Mail } from "lucide-react";
import { generatePageMetadata } from "@/lib/seo";
import { siteConfig } from "@/config/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return generatePageMetadata({
    title: locale === "en" ? "Contact" : "联系我们",
    description:
      locale === "en"
        ? "Contact the GenGrowth team about the product, partnerships, or support."
        : "联系 GenGrowth 团队，咨询产品、合作或支持。",
    locale,
    path: "/contact",
    noIndex: true,
  });
}

export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const copy =
    locale === "zh"
      ? {
          eyebrow: "联系 GenGrowth",
          title: "有问题或想一起把增长做得更扎实？",
          body: "产品使用、合作想法或反馈，请直接发邮件给我们。我们会用真实信息回复，而不是让你进入候补名单。",
          emailLabel: "发送邮件",
          productLabel: "打开 GenGrowth",
        }
      : {
          eyebrow: "Contact GenGrowth",
          title: "Questions, feedback, or a partnership idea?",
          body: "Email us about the product, a collaboration, or support. We will respond with useful information instead of sending you through a waitlist.",
          emailLabel: "Email the team",
          productLabel: "Open GenGrowth",
        };

  return (
    /* 营销页 hero 间距：PageShell 已垫 68px，这里只补 hero 自己的 64/84px */
    <section className="relative min-h-screen overflow-hidden bg-brand-bg px-6 pt-16 pb-24 md:px-8 md:pt-21">
      {/* GLOW_01 — 页级 hero 才允许的网格 + 氛围光 */}
      <div
        aria-hidden="true"
        className="bg-signal-grid absolute inset-0 opacity-40"
      />
      <div
        aria-hidden="true"
        className="absolute -top-30 right-[8%] hidden h-70 w-100 rounded-full bg-[radial-gradient(ellipse,rgba(61,220,151,0.13),transparent_65%)] blur-[12px] md:block"
      />
      <section className="relative mx-auto max-w-2xl rounded-card border border-brand-border-card bg-brand-panel p-7 md:p-10">
        <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
          {copy.eyebrow}
        </p>
        <h1 className="text-page-title mt-4 text-text-dark-primary">
          {copy.title}
        </h1>
        <p className="mt-5 max-w-xl text-[15.5px] leading-[1.65] text-text-dark-secondary">
          {copy.body}
        </p>
        <div className="mt-9 flex flex-col gap-3.5 sm:flex-row">
          {/* GLOW_02 — 本屏唯一的渐变主 CTA，次入口只靠描边分层 */}
          <a
            href={`mailto:${siteConfig.contactEmail}`}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-[10px] bg-brand-gradient px-[26px] text-[14.5px] font-semibold text-brand-on-accent shadow-cta transition-shadow hover:shadow-cta-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
          >
            <Mail aria-hidden="true" className="size-4" />
            {copy.emailLabel}
          </a>
          <a
            href={siteConfig.appUrl}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-[10px] border border-brand-border-strong bg-brand-panel/60 px-6 text-[14.5px] font-medium text-text-dark-primary transition-colors hover:border-brand-accent/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
          >
            {copy.productLabel}
            <ArrowRight aria-hidden="true" className="size-4" />
          </a>
        </div>
      </section>
    </section>
  );
}
