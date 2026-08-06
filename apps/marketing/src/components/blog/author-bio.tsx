// @input  -- next-intl translations
// @output -- author bio section for blog articles
// @pos    -- blog article footer component, enhances E-E-A-T signals
// once this file is updated, update header comments and _DIR.md in this folder
"use client";

import { useTranslations } from "next-intl";

export function AuthorBio() {
  const t = useTranslations("blog.authorBio");

  return (
    <div className="mt-14 flex items-start gap-4 rounded-card border border-brand-border-card bg-brand-panel p-[22px]">
      {/* Initials tile */}
      <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-brand-accent/25 bg-brand-accent-soft">
        <span className="font-mono text-[11px] tracking-[0.08em] text-brand-accent-text">
          GT
        </span>
      </div>

      {/* Text block */}
      <div className="min-w-0">
        <p className="text-[14px] leading-tight font-semibold text-text-dark-primary">
          {t("name")}
        </p>
        <p className="mt-1.5 font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
          {t("title")}
        </p>
        <p className="mt-2.5 text-[13px] leading-[1.6] text-text-dark-secondary">
          {t("bio")}
        </p>
      </div>
    </div>
  );
}
