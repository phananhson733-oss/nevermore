// @input  -- PublicPlaybook data, locale string, i18n labels
// @output -- PlaybookCard component rendering title, badges, success rate, step count
// @pos    -- UI component for /playbooks index grid and related playbooks section
// once this file is updated, update header comments and _DIR.md in this folder

import Link from "next/link";
import type {
  PublicPlaybook,
  PublicPlaybookContent,
} from "@/lib/mock/playbook-public-data";
import { localePath } from "@/lib/locale-path";

interface PlaybookCardProps {
  readonly playbook: PublicPlaybook;
  readonly locale: string;
  readonly content: PublicPlaybookContent;
  readonly labels: {
    readonly successRate: string;
    readonly steps: string;
    readonly industry: string;
    readonly channel: string;
    readonly goal: string;
  };
}

export function PlaybookCard({
  playbook,
  locale,
  content,
  labels,
}: PlaybookCardProps) {
  const successPct = Math.round(playbook.successRate * 100);

  return (
    <Link
      href={localePath(locale, `/playbooks/${playbook.slug}`)}
      className="group block"
    >
      <article className="flex h-full flex-col rounded-card border border-brand-border-card bg-brand-panel p-[22px] transition-colors duration-200 group-hover:border-brand-accent/40">
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded border border-brand-accent/30 px-2 py-[3px] font-mono text-[9.5px] tracking-[0.08em] text-brand-accent-text uppercase">
            {labels.industry}
          </span>
          <span className="rounded border border-brand-border-strong px-2 py-[3px] font-mono text-[9.5px] tracking-[0.08em] text-text-dark-secondary uppercase">
            {labels.channel}
          </span>
          <span className="rounded border border-brand-border-strong px-2 py-[3px] font-mono text-[9.5px] tracking-[0.08em] text-text-dark-secondary uppercase">
            {labels.goal}
          </span>
        </div>

        <h2 className="mt-4 text-[16.5px] leading-snug font-semibold text-text-dark-primary transition-colors group-hover:text-brand-accent-text">
          {content.title}
        </h2>

        <p className="mt-2 line-clamp-3 text-[13px] leading-[1.6] text-text-dark-secondary">
          {content.description}
        </p>

        {/* 指标条：数字走 mono，单位标签走 mono 小标签 */}
        <div className="mt-auto flex items-baseline gap-5 border-t border-brand-border-faint pt-4 font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
          <span>
            <span className="text-[17px] tracking-normal text-text-dark-primary">
              {successPct}%
            </span>{" "}
            {labels.successRate}
          </span>
          <span>
            <span className="text-[17px] tracking-normal text-text-dark-primary">
              {playbook.stepCount}
            </span>{" "}
            {labels.steps}
          </span>
        </div>
      </article>
    </Link>
  );
}
