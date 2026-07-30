// @input  -- title, subtitle, optional children (summary table)
// @output -- ComparisonHero component with dark background hero section
// @pos    -- compare page hero, used by all /compare/* detail pages
// once this file is updated, update header comments and _DIR.md in this folder
"use client";

import type { ReactNode } from "react";

interface ComparisonHeroProps {
  title: string;
  subtitle: string;
  children?: ReactNode;
}

export function ComparisonHero({
  title,
  subtitle,
  children,
}: ComparisonHeroProps) {
  return (
    <div className="mb-12">
      <h1 className="text-text-dark-primary font-bold text-[28px] md:text-[36px] tracking-[-0.02em] mb-3">
        {title}
      </h1>
      <p className="text-text-dark-secondary text-[15px] mb-6">{subtitle}</p>
      {children}
    </div>
  );
}
