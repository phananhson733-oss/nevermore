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
      <div className="mt-16 text-center">
        <p className="text-text-dark-secondary text-[14px] mb-4">
          {ctaSubtitle}
        </p>
        <Link
          href={`${localePath(locale)}#waitlist`}
          className="inline-block rounded-full bg-brand-accent px-8 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-brand-accent/90"
        >
          {ctaLabel}
        </Link>
      </div>
      <div className="mt-8 text-center">
        <Link
          href={localePath(locale, "/compare")}
          className="text-text-dark-secondary text-[13px] hover:text-text-dark-primary transition-colors"
        >
          &larr; {backLabel}
        </Link>
      </div>
    </>
  );
}
