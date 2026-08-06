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
    <div className="relative mb-14 overflow-hidden border-b border-brand-border pb-12 md:pb-14">
      {/* GLOW_01 — 页级 hero 才允许的网格 + 氛围光 */}
      <div
        aria-hidden="true"
        className="bg-signal-grid absolute inset-0 opacity-40"
      />
      <div
        aria-hidden="true"
        className="absolute -top-30 right-[4%] hidden h-70 w-100 rounded-full bg-[radial-gradient(ellipse,rgba(61,220,151,0.13),transparent_65%)] blur-[12px] md:block"
      />
      <div className="relative">
        <h1 className="max-w-3xl text-text-dark-primary">{title}</h1>
        <p className="mt-5 max-w-2xl text-[15.5px] leading-[1.65] text-text-dark-secondary md:text-[17px]">
          {subtitle}
        </p>
        {/* 摘要表槽位：没有 children 时不留空隙 */}
        <div className="mt-9 empty:hidden">{children}</div>
      </div>
    </div>
  );
}
