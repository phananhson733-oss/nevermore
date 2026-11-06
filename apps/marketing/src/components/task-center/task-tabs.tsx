// @input  -- the page locale and which of the three promoter pages is showing
// @output -- the 任务中心 / 我的推广 / 我的收益 tab row, the current one marked with aria-current
// @pos    -- top of /tasks, /promotions and /earnings; the site header keeps its own two links, so the tabs are what links all three
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import Link from "next/link";

import { taskCopy } from "../../lib/task-center/copy.ts";
import { localePath } from "../../lib/locale-path.ts";

export type TaskTab = "tasks" | "promotions" | "earnings";

export function TaskTabs({ locale, current }: { locale: string; current: TaskTab }) {
  const copy = taskCopy(locale);
  const tabs: readonly { readonly id: TaskTab; readonly label: string }[] = [
    { id: "tasks", label: copy.tabTasks },
    { id: "promotions", label: copy.tabPromotions },
    { id: "earnings", label: copy.tabEarnings },
  ];
  return (
    <nav aria-label={copy.tabTasks} className="mb-8 flex gap-1 border-b border-brand-border-card">
      {tabs.map((tab) => {
        const active = tab.id === current;
        return (
          <Link
            key={tab.id}
            href={localePath(locale, `/${tab.id}`)}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2.5 text-[14px] whitespace-nowrap transition-colors ${
              active
                ? "border-brand-accent-text font-medium text-text-dark-primary"
                : "border-transparent text-text-dark-secondary hover:text-text-dark-primary"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
