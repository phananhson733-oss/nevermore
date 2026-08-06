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
    { year: "numeric", month: "short", day: "numeric" },
  );

  return (
    <Link
      href={localePath(locale, `/blog/${post.slug}`)}
      className="group block"
    >
      <article className="flex h-full flex-col overflow-hidden rounded-card border border-brand-border-card bg-brand-panel transition-colors duration-200 group-hover:border-brand-accent/40">
        {/* Hero thumbnail */}
        {post.hero_image && (
          <img
            src={post.hero_image}
            alt={post.title}
            width={1200}
            height={675}
            loading="lazy"
            className="aspect-[16/9] w-full border-b border-brand-border-card object-cover"
          />
        )}

        <div className="flex flex-1 flex-col p-[22px]">
          {/* Meta: category chip + mono date */}
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="rounded border border-brand-accent/30 px-2 py-[3px] font-mono text-[9.5px] tracking-[0.08em] text-brand-accent-text uppercase">
              {t(`categories.${post.category}`)}
            </span>
            <span className="font-mono text-[10px] tracking-[0.08em] text-text-dark-secondary">
              {date}
            </span>
          </div>

          {/* Title */}
          <h3 className="mt-4 line-clamp-2 text-[15.5px] leading-snug font-semibold text-text-dark-primary transition-colors group-hover:text-brand-accent-text">
            {post.title}
          </h3>

          {/* Excerpt */}
          <p className="mt-2 line-clamp-3 text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {post.excerpt}
          </p>

          {/* Footer: reading time + arrow */}
          <div className="mt-auto flex items-center justify-between gap-3 pt-5">
            <span className="font-mono text-[10px] tracking-[0.08em] text-text-dark-secondary uppercase">
              {post.reading_time} {t("minRead")}
            </span>
            <span
              aria-hidden="true"
              className="text-[11px] text-brand-accent-text transition-transform duration-200 group-hover:translate-x-0.5"
            >
              &rarr;
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}
