// @input  — next-intl, @/types/blog
// @output — BlogCard 组件（博客文章卡片）
// @pos    — 博客列表页卡片组件，SPEC 2.7.3
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import type { BlogPost } from "@/types";
import { localePath } from "@/lib/locale-path";

export function BlogCard({ post }: { post: BlogPost }) {
  const t = useTranslations("blog");
  const locale = useLocale();

  const date = new Date(post.published_at).toLocaleDateString(
    locale === "zh" ? "zh-CN" : "en-US",
    { year: "numeric", month: "short", day: "numeric" }
  );

  return (
    <Link href={localePath(locale, `/blog/${post.slug}`)} className="group block">
      <article className="h-full overflow-hidden rounded-xl border border-brand-border/60 bg-brand-bg-alt/30 transition-all duration-200 group-hover:border-brand-accent/50 group-hover:bg-brand-bg-alt/60">
        {/* Hero thumbnail */}
        {post.hero_image && (
          <img
            src={post.hero_image}
            alt={post.title}
            width={1200}
            height={675}
            loading="lazy"
            className="w-full h-auto aspect-[16/9] object-cover"
          />
        )}

        <div className="p-6">
        {/* Meta: category + date */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-brand-accent-text text-[11px] font-medium tracking-wider uppercase">
            {t(`categories.${post.category}`)}
          </span>
          <span className="text-text-dark-secondary/30 text-[11px]">|</span>
          <span className="text-text-dark-secondary text-[11px]">{date}</span>
        </div>

        {/* Title */}
        <h3 className="text-text-dark-primary font-semibold text-[17px] leading-snug mb-3 line-clamp-2 group-hover:text-brand-accent-text transition-colors">
          {post.title}
        </h3>

        {/* Excerpt */}
        <p className="text-text-dark-secondary text-[13px] leading-relaxed line-clamp-3 mb-5">
          {post.excerpt}
        </p>

        {/* Footer: reading time + arrow */}
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-text-dark-secondary">
            {post.reading_time} {t("minRead")}
          </span>
          <span className="text-brand-accent-text opacity-0 -translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0">
            &rarr;
          </span>
        </div>
        </div>
      </article>
    </Link>
  );
}
