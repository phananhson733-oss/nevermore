"use client";

// @input  -- 归一化条目、分类清单与筛选文案
// @output -- 带分类筛选的资源网格
// @pos    -- Prompt / Skill hub 的列表区；筛选只在客户端隐藏，不改变已渲染的内容
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { useState } from "react";

import { ResourceCard, type ResourceCardItem } from "./resource-card";

export interface ResourceFilterOption {
  readonly id: string;
  readonly label: string;
}

interface ResourceLibraryProps {
  readonly items: readonly ResourceCardItem[];
  readonly categories: readonly ResourceFilterOption[];
  readonly allLabel: string;
  readonly filterLabel: string;
  readonly emptyLabel: string;
}

const ALL = "all";

/**
 * Every item is server-rendered and stays in the document; the filter only
 * decides what is displayed. That keeps the whole library crawlable from one
 * URL and avoids filter permutations becoming indexable pages — robots.txt
 * already refuses query-filtered URLs elsewhere on the site.
 */
export function ResourceLibrary({
  items,
  categories,
  allLabel,
  filterLabel,
  emptyLabel,
}: ResourceLibraryProps) {
  const [active, setActive] = useState<string>(ALL);

  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1);
  }

  const options: readonly ResourceFilterOption[] = [
    { id: ALL, label: allLabel },
    ...categories.filter((category) => (counts.get(category.id) ?? 0) > 0),
  ];

  const visible =
    active === ALL
      ? items
      : items.filter((item) => item.categoryId === active);

  return (
    <div className="min-w-0">
      <div
        role="group"
        aria-label={filterLabel}
        className="flex min-w-0 flex-wrap gap-2"
      >
        {options.map((option) => {
          const count =
            option.id === ALL ? items.length : (counts.get(option.id) ?? 0);
          const isActive = option.id === active;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => setActive(option.id)}
              className={
                isActive
                  ? "inline-flex h-8 items-center gap-2 rounded-full border border-brand-accent/40 bg-brand-accent-soft px-3.5 font-mono text-[10.5px] tracking-[0.08em] text-brand-accent-text uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
                  : "inline-flex h-8 items-center gap-2 rounded-full border border-brand-border-strong px-3.5 font-mono text-[10.5px] tracking-[0.08em] text-text-dark-secondary uppercase transition-colors hover:border-brand-accent/30 hover:text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
              }
            >
              {option.label}
              <span className="text-text-dark-faint tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <p className="mt-8 text-[14px] text-text-dark-secondary">{emptyLabel}</p>
      ) : (
        <div className="mt-8 grid min-w-0 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visible.map((item) => (
            <ResourceCard key={item.slug} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
