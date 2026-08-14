// @input  -- 归一化后的资源条目
// @output -- Prompt / Skill 共用的库卡片
// @pos    -- 两个 hub 的列表单元，保证两库的扫读顺序一致
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * Both libraries render the same card so a reader moving between them keeps
 * one scanning order. Only the trailing chips differ: models a prompt was
 * checked against, or the agent that owns a skill.
 */
export interface ResourceCardItem {
  readonly slug: string;
  readonly href: string;
  readonly title: string;
  readonly description: string;
  readonly categoryId: string;
  readonly categoryLabel: string;
  /** Mono microlabel in the card header: output format, or the skill filename. */
  readonly metaLabel: string;
  readonly chips: readonly string[];
}

export function ResourceCard({ item }: { readonly item: ResourceCardItem }) {
  return (
    <article className="min-w-0">
      <Link
        href={item.href}
        className="group flex h-full min-w-0 flex-col rounded-card border border-brand-border-card bg-brand-panel p-5 transition-colors hover:border-brand-accent/30 hover:bg-brand-panel-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="rounded-full border border-brand-accent/25 bg-brand-accent-soft px-2.5 py-0.5 font-mono text-[9.5px] tracking-[0.08em] text-brand-accent-text uppercase">
            {item.categoryLabel}
          </span>
          <span className="min-w-0 truncate font-mono text-[9.5px] tracking-[0.08em] text-text-dark-faint uppercase">
            {item.metaLabel}
          </span>
        </div>

        <h3 className="mt-4 text-[16px] leading-[1.4] font-semibold text-text-dark-primary">
          {item.title}
        </h3>

        <p className="mt-2.5 flex-1 text-[13px] leading-[1.65] text-text-dark-secondary">
          {item.description}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-brand-border-faint pt-3.5">
          {item.chips.map((chip) => (
            <span
              key={chip}
              className="font-mono text-[9.5px] tracking-[0.06em] text-text-dark-faint uppercase"
            >
              {chip}
            </span>
          ))}
          <ArrowRight
            aria-hidden="true"
            className="ml-auto size-3.5 shrink-0 text-text-dark-faint transition-transform group-hover:translate-x-0.5 group-hover:text-brand-accent-text"
          />
        </div>
      </Link>
    </article>
  );
}
