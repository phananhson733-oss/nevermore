// @input  -- locale, ctaLabel, ctaSubtitle, backLabel, backHref
// @output -- ComparisonCta bottom CTA + back link section
// @pos    -- compare page CTA, used by all /compare/[slug] detail pages
// once this file is updated, update header comments and _DIR.md in this folder
"use client";

import Link from "next/link";
import { localePath } from "@/lib/locale-path";

interface ComparisonCtaProps {
  readonly locale: string;
  readonly ctaLabel: string;
  readonly ctaSubtitle: string;
  readonly backLabel: string;
}

export function ComparisonCta({
  locale,
  ctaLabel,
  ctaSubtitle,
  backLabel,
}: ComparisonCtaProps) {
  return (
    <>
      {/* 「下一步」容器走虚线 + 微渐变底，与实线的内容区分开 */}
      <div className="mt-16 rounded-[16px] border border-dashed border-brand-border-dashed bg-dashed-wash p-7 text-center md:p-10">
        <p className="mx-auto max-w-2xl text-[13px] leading-[1.65] text-text-dark-secondary">
          {ctaSubtitle}
        </p>
        <Link
          href={`${localePath(locale)}#waitlist`}
          className="mt-5 inline-flex h-12 items-center justify-center gap-2 rounded-[10px] bg-brand-gradient px-[26px] text-[14.5px] font-semibold text-brand-on-accent shadow-cta transition-shadow hover:shadow-cta-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
        >
          {ctaLabel}
        </Link>
      </div>
      <div className="mt-8 text-center">
        <Link
          href={localePath(locale, "/compare")}
          className="font-mono text-[10.5px] tracking-[0.06em] text-brand-accent-2 uppercase transition-colors hover:text-brand-info"
        >
          &larr; {backLabel}
        </Link>
      </div>
    </>
  );
}
