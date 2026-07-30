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
    <section className="min-h-screen bg-brand-bg px-5 pb-24 pt-28 md:pt-36">
      <section className="mx-auto max-w-2xl rounded-3xl border border-brand-border/70 bg-brand-bg-alt/45 p-7 md:p-10">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-accent-text">
          {copy.eyebrow}
        </p>
        <h1 className="mt-4 text-[34px] font-semibold leading-[1.06] tracking-[-0.04em] text-text-dark-primary md:text-[48px]">
          {copy.title}
        </h1>
        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-text-dark-secondary md:text-[17px]">
          {copy.body}
        </p>
        <div className="mt-9 flex flex-col gap-3 sm:flex-row">
          <a
            href={`mailto:${siteConfig.contactEmail}`}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-accent px-5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-accent-hover"
          >
            <Mail aria-hidden="true" className="size-4" />
            {copy.emailLabel}
          </a>
          <a
            href={siteConfig.appUrl}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-brand-border px-5 text-[13px] font-semibold text-text-dark-primary transition-colors hover:bg-brand-bg-alt"
          >
            {copy.productLabel}
            <ArrowRight aria-hidden="true" className="size-4" />
          </a>
        </div>
      </section>
    </section>
  );
}
