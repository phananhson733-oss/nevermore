// @input  -- locale, ConnectedToolContent for hidden-keywords, coming-soon copy
// @output -- explanatory sections retained from the source-gated page: workflow, outputs, FAQ
// @pos    -- server presentation of the hidden-keywords coming-soon page below the waitlist
import { CheckCircle2, Database } from "lucide-react";
import Link from "next/link";
import type { ConnectedToolContent } from "@/components/tools/connected-tool-content";
import { localePath } from "@/lib/locale-path";
import type { HiddenKeywordsComingSoonContent } from "./coming-soon-content";

export function ComingSoonToolSections({
  locale,
  content,
  comingSoon,
}: {
  readonly locale: string;
  readonly content: ConnectedToolContent;
  readonly comingSoon: HiddenKeywordsComingSoonContent;
}) {
  return (
    <>
      <section className="grid gap-10 py-16 md:grid-cols-[0.8fr_1.2fr] md:py-22">
        <div>
          <div className="flex size-11 items-center justify-center rounded-[10px] border border-brand-accent/25 bg-brand-accent-soft text-brand-accent">
            <Database aria-hidden="true" className="size-[18px]" />
          </div>
          <h2 className="mt-5 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
            {content.workflowTitle}
          </h2>
        </div>
        <ol className="rounded-card border-brand-border-card bg-brand-border-card grid gap-px overflow-hidden border">
          {content.steps.map((step, index) => (
            <li key={step.name} className="bg-brand-panel flex gap-4 p-[20px]">
              <span className="flex size-6 shrink-0 items-center justify-center rounded border border-brand-accent/25 bg-brand-accent-soft font-mono text-[10px] text-brand-accent-text">
                {index + 1}
              </span>
              <div>
                <h3 className="text-[15.5px] font-semibold text-text-dark-primary">
                  {step.name}
                </h3>
                <p className="mt-1.5 text-[13px] leading-[1.6] text-text-dark-secondary">
                  {step.text}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-y border-brand-border py-16 md:py-22">
        <h2 className="max-w-2xl text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
          {content.outputTitle}
        </h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {content.outputs.map((output) => (
            <article
              key={output.label}
              className="rounded-card border-brand-border-card bg-brand-panel border p-[22px] transition-colors hover:border-brand-accent/40"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2
                  aria-hidden="true"
                  className="size-4 text-brand-accent"
                />
                <h3 className="text-[15.5px] font-semibold text-text-dark-primary">
                  {output.label}
                </h3>
              </div>
              <p className="mt-3 text-[13px] leading-[1.6] text-text-dark-secondary">
                {output.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-10 py-16 md:grid-cols-[1.25fr_0.75fr] md:py-22">
        <div>
          <h2 className="text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
            FAQ
          </h2>
          <div className="mt-7 space-y-5">
            {content.faq.map((item) => (
              <article key={item.question}>
                <h3 className="text-[15.5px] font-semibold text-text-dark-primary">
                  {item.question}
                </h3>
                <p className="mt-2 text-[13px] leading-[1.6] text-text-dark-secondary">
                  {item.answer}
                </p>
              </article>
            ))}
          </div>
        </div>
        <aside className="rounded-card border-brand-border-card bg-brand-panel h-fit border p-[22px]">
          <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
            {comingSoon.alternativesLabel}
          </p>
          <p className="mt-3 text-[15.5px] leading-snug font-semibold text-text-dark-primary">
            {comingSoon.alternativesBody}
          </p>
          <div className="mt-5 space-y-3">
            <Link
              href={localePath(locale, "/tools/seo-audit")}
              className="flex items-center gap-1.5 text-[13.5px] text-brand-accent-2 transition-colors hover:text-brand-info"
            >
              {locale === "zh" ? "免费 SEO 审计" : "Free SEO Audit"}
              <span aria-hidden="true">&rarr;</span>
            </Link>
            <Link
              href={localePath(locale, "/tools/internal-link-audit")}
              className="flex items-center gap-1.5 text-[13.5px] text-brand-accent-2 transition-colors hover:text-brand-info"
            >
              {locale === "zh" ? "内链审计" : "Internal Link Audit"}
              <span aria-hidden="true">&rarr;</span>
            </Link>
          </div>
        </aside>
      </section>
    </>
  );
}
