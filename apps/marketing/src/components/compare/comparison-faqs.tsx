// @input  -- faqs array with question/answer pairs, heading label
// @output -- ComparisonFaqs accordion-style FAQ section
// @pos    -- compare page FAQ component, used by all /compare/[slug] detail pages
// once this file is updated, update header comments and _DIR.md in this folder
"use client";

interface FaqItem {
  readonly question: string;
  readonly answer: string;
}

interface ComparisonFaqsProps {
  readonly faqs: ReadonlyArray<FaqItem>;
  readonly heading: string;
}

export function ComparisonFaqs({ faqs, heading }: ComparisonFaqsProps) {
  return (
    <div className="mt-16 border-t border-brand-border pt-14">
      <h2 className="mb-7 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
        {heading}
      </h2>
      {/* 每条 FAQ 之间用最淡的一级描边分隔，而不是靠大间距 */}
      <div className="divide-y divide-brand-border-faint">
        {faqs.map((faq) => (
          <div key={faq.question} className="py-5 first:pt-0 last:pb-0">
            <h3 className="text-[15.5px] font-semibold text-text-dark-primary">
              {faq.question}
            </h3>
            <p className="mt-2 max-w-3xl text-[13px] leading-[1.65] text-text-dark-secondary">
              {faq.answer}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
