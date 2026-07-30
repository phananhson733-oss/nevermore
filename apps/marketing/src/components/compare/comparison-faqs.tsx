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
    <div className="mt-16">
      <h2 className="text-text-dark-primary font-semibold text-[22px] mb-6">
        {heading}
      </h2>
      <div className="space-y-6">
        {faqs.map((faq) => (
          <div key={faq.question}>
            <h3 className="text-text-dark-primary font-medium text-[15px] mb-1">
              {faq.question}
            </h3>
            <p className="text-text-dark-secondary text-[13px] leading-relaxed">
              {faq.answer}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
