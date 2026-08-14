// @input  -- ResourceFaq[] 与区块标题
// @output -- 原生 details/summary 手风琴（首条默认展开）
// @pos    -- Prompt / Skill 详情页 FAQ 区，与 FAQPage 结构化数据同源
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { ChevronDown } from "lucide-react";

import { ResourceProse } from "./resource-prose";
import type { ResourceFaq } from "@/types/resource";

interface ResourceFaqSectionProps {
  readonly faqs: readonly ResourceFaq[];
  readonly eyebrow: string;
  readonly title: string;
  readonly headingId: string;
}

/**
 * Built on `details`/`summary` rather than a JS disclosure: the answers are the
 * same text the FAQPage schema carries, so they must be in the document for a
 * crawler with or without scripting, and the element gives keyboard and screen
 * reader behaviour for free.
 */
export function ResourceFaqSection({
  faqs,
  eyebrow,
  title,
  headingId,
}: ResourceFaqSectionProps) {
  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
        {eyebrow}
      </p>
      <h2
        id={headingId}
        className="mt-2 text-[22px] font-semibold text-text-dark-primary"
      >
        {title}
      </h2>

      <div className="mt-5 border-t border-brand-border">
        {faqs.map((faq, index) => (
          <details
            key={faq.question}
            open={index === 0}
            className="group border-b border-brand-border"
          >
            <summary className="flex cursor-pointer list-none items-start justify-between gap-4 py-4 text-[15px] font-semibold text-text-dark-primary transition-colors hover:text-brand-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent [&::-webkit-details-marker]:hidden">
              <h3 className="min-w-0 text-[15px] font-semibold">
                {faq.question}
              </h3>
              <ChevronDown
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-text-dark-faint transition-transform group-open:rotate-180"
              />
            </summary>
            <ResourceProse markdown={faq.answer} className="pb-5" />
          </details>
        ))}
      </div>
    </section>
  );
}
