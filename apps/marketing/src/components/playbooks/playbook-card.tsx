// @input  -- PublicPlaybook data, locale string, i18n labels
// @output -- PlaybookCard component rendering title, badges, success rate, step count
// @pos    -- UI component for /playbooks index grid and related playbooks section
// once this file is updated, update header comments and _DIR.md in this folder

import Link from "next/link";
import type { PublicPlaybook, PublicPlaybookContent } from "@/lib/mock/playbook-public-data";
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
      <article className="h-full rounded-xl border border-brand-border/60 bg-brand-bg-alt/30 p-6 transition-all duration-200 group-hover:border-brand-accent/50 group-hover:bg-brand-bg-alt/60">
        <div className="flex flex-wrap gap-2 mb-3">
          <span className="inline-block rounded-full bg-brand-accent/15 px-2.5 py-0.5 text-[11px] font-medium text-brand-accent-text">
            {labels.industry}
          </span>
          <span className="inline-block rounded-full bg-brand-bg-alt/60 border border-brand-border/50 px-2.5 py-0.5 text-[11px] font-medium text-text-dark-secondary">
            {labels.channel}
          </span>
          <span className="inline-block rounded-full bg-brand-bg-alt/60 border border-brand-border/50 px-2.5 py-0.5 text-[11px] font-medium text-text-dark-secondary">
            {labels.goal}
          </span>
        </div>

        <h2 className="text-text-dark-primary font-semibold text-[17px] leading-snug mb-2 group-hover:text-brand-accent-text transition-colors">
          {content.title}
        </h2>

        <p className="text-text-dark-secondary text-[13px] leading-relaxed mb-4 line-clamp-3">
          {content.description}
        </p>

        <div className="flex items-center gap-4 text-[12px] text-text-dark-secondary">
          <span>
            <span className="text-text-dark-primary font-semibold">
              {successPct}%
            </span>{" "}
            {labels.successRate}
          </span>
          <span>
            <span className="text-text-dark-primary font-semibold">
              {playbook.stepCount}
            </span>{" "}
            {labels.steps}
          </span>
        </div>
      </article>
    </Link>
  );
}
