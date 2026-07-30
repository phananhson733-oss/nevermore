// @input  -- next-intl translations
// @output -- author bio section for blog articles
// @pos    -- blog article footer component, enhances E-E-A-T signals
// once this file is updated, update header comments and _DIR.md in this folder
"use client";

import { useTranslations } from "next-intl";

export function AuthorBio() {
  const t = useTranslations("blog.authorBio");

  return (
    <div className="flex items-start gap-4 rounded-xl border border-brand-border/60 bg-brand-bg-alt/30 p-5 mt-14">
      {/* Avatar placeholder */}
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-brand-accent/20 flex items-center justify-center">
        <span className="text-brand-accent-text text-[13px] font-semibold leading-none">
          GT
        </span>
      </div>

      {/* Text block */}
      <div className="min-w-0">
        <p className="text-text-dark-primary text-[14px] font-semibold leading-tight">
          {t("name")}
        </p>
        <p className="text-text-dark-secondary text-[12px] mt-0.5">
          {t("title")}
        </p>
        <p className="text-text-dark-secondary text-[13px] leading-relaxed mt-2">
          {t("bio")}
        </p>
      </div>
    </div>
  );
}
