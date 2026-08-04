// @input  -- locale, ConnectedToolContent, shared site configuration
// @output -- transparent source-gated tool landing page
// @pos    -- public handoff for product workflows that cannot use anonymous demo data
import { ArrowRight, CheckCircle2, Database, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { siteConfig } from "@/config/site";
import type { ConnectedToolContent } from "./connected-tool-content";
import { localePath } from "@/lib/locale-path";

export function ConnectedToolPage({
  locale,
  content,
  children,
  article,
  connected = false,
}: {
  readonly locale: string;
  readonly content: ConnectedToolContent;
  /** The live tool, when this page has one. Rendered directly under the header. */
  readonly children?: React.ReactNode;
  /**
   * Long-form sections for a page that has more to say than the shared shell.
   *
   * Rendered between "what you get" and the FAQ, which is where a reader who
   * has understood the output starts asking how it was arrived at. Optional:
   * the other connected tools have nothing to put here yet.
   */
  readonly article?: React.ReactNode;
  /**
   * True once the visitor has connected the source this page needs.
   *
   * The header's "you will need to connect X" block and its hand-off to the
   * product are written for someone who cannot run the tool here. Leaving them
   * up after a successful connection contradicts the working tool directly
   * below them.
   */
  readonly connected?: boolean;
}) {
  const toolsLabel = locale === "zh" ? "免费 SEO 工具" : "Free SEO Tools";
  const homeLabel = locale === "zh" ? "首页" : "Home";
  const relatedLabel =
    locale === "zh" ? "可先试用的公开工具" : "Public tools you can run first";

  return (
    <section className="min-h-screen bg-brand-bg pb-24 pt-20 md:pt-28">
      <div className="mx-auto max-w-[1080px] px-5 sm:px-6">
        <nav
          className="text-[13px] text-text-dark-secondary"
          aria-label="Breadcrumb"
        >
          <Link
            href={localePath(locale)}
            className="transition-colors hover:text-text-dark-primary"
          >
            {homeLabel}
          </Link>
          <span className="mx-2 opacity-40">/</span>
          <Link
            href={localePath(locale, "/tools")}
            className="transition-colors hover:text-text-dark-primary"
          >
            {toolsLabel}
          </Link>
          <span className="mx-2 opacity-40">/</span>
          <span>{content.title}</span>
        </nav>

        <header className="mt-8 border-b border-brand-border/60 pb-12 md:pb-16">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-accent-text">
            {content.eyebrow}
          </p>
          <h1 className="mt-4 max-w-4xl text-[42px] font-bold leading-[0.98] tracking-[-0.05em] text-text-dark-primary md:text-[64px]">
            {content.title}
          </h1>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-text-dark-secondary md:text-[18px]">
            {content.description}
          </p>
          {connected ? null : (
            <div className="mt-8 grid max-w-3xl gap-3 rounded-2xl border border-brand-border/70 bg-brand-bg-alt/45 p-5 md:grid-cols-[auto_1fr]">
              <ShieldCheck
                aria-hidden="true"
                className="size-5 text-brand-accent-text"
              />
              <div>
                <p className="text-[13px] font-semibold text-text-dark-primary">
                  {content.sourceLabel}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-text-dark-secondary">
                  {content.sourceDetail}
                </p>
              </div>
            </div>
          )}
          {/*
            The hand-off to the product is for someone who cannot run the tool
            here. Once they have connected, it contradicts the working tool
            below; before that, it steps down to a link so two identical primary
            buttons do not pull people away from the thing they came to run.
          */}
          {connected ? null : (
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a
                href={siteConfig.appUrl}
                className={
                  children
                    ? "inline-flex min-h-11 items-center gap-2 text-[13px] font-semibold text-brand-accent-text transition-colors hover:underline"
                    : "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-accent px-5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-accent-hover"
                }
              >
                {content.cta}
                <ArrowRight aria-hidden="true" className="size-4" />
              </a>
              <p className="max-w-md text-[12px] leading-relaxed text-text-dark-secondary">
                {content.trust}
              </p>
            </div>
          )}
        </header>

        {children ? <div className="pt-10 md:pt-12">{children}</div> : null}

        <section className="grid gap-12 py-14 md:grid-cols-[0.8fr_1.2fr] md:py-20">
          <div>
            <div className="flex size-11 items-center justify-center rounded-xl border border-brand-accent/30 bg-brand-accent/10 text-brand-accent-text">
              <Database aria-hidden="true" className="size-5" />
            </div>
            <h2 className="mt-5 text-[28px] font-semibold tracking-[-0.035em] text-text-dark-primary">
              {content.workflowTitle}
            </h2>
          </div>
          <ol className="space-y-4">
            {content.steps.map((step, index) => (
              <li
                key={step.name}
                className="flex gap-4 rounded-xl border border-brand-border/60 bg-brand-bg-alt/25 p-4"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-accent/10 text-[11px] font-semibold text-brand-accent-text">
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-[15px] font-semibold text-text-dark-primary">
                    {step.name}
                  </h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-text-dark-secondary">
                    {step.text}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-y border-brand-border/60 py-14 md:py-20">
          <h2 className="max-w-2xl text-[30px] font-semibold tracking-[-0.04em] text-text-dark-primary">
            {content.outputTitle}
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {content.outputs.map((output) => (
              <article
                key={output.label}
                className="rounded-2xl border border-brand-border/70 bg-brand-bg-alt/35 p-5"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2
                    aria-hidden="true"
                    className="size-4 text-brand-accent-text"
                  />
                  <h3 className="text-[15px] font-semibold text-text-dark-primary">
                    {output.label}
                  </h3>
                </div>
                <p className="mt-3 text-[13px] leading-relaxed text-text-dark-secondary">
                  {output.body}
                </p>
              </article>
            ))}
          </div>
        </section>

        {article}

        <section className="grid gap-12 py-14 md:grid-cols-[1.25fr_0.75fr] md:py-20">
          <div>
            <h2 className="text-[30px] font-semibold tracking-[-0.04em] text-text-dark-primary">
              FAQ
            </h2>
            <div className="mt-7 space-y-5">
              {content.faq.map((item) => (
                <article key={item.question}>
                  <h3 className="text-[15px] font-semibold text-text-dark-primary">
                    {item.question}
                  </h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-text-dark-secondary">
                    {item.answer}
                  </p>
                </article>
              ))}
            </div>
          </div>
          <aside className="rounded-2xl border border-brand-border/70 bg-brand-bg-alt/35 p-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-accent-text">
              {relatedLabel}
            </p>
            <p className="mt-3 text-[15px] font-semibold leading-snug text-text-dark-primary">
              {locale === "zh"
                ? "先用无需连接的数据检查网站基础。"
                : "Start with a site check that does not require a connection."}
            </p>
            <div className="mt-5 space-y-3">
              <Link
                href={localePath(locale, "/tools/seo-audit")}
                className="block text-[13px] font-semibold text-brand-accent-text hover:underline"
              >
                {locale === "zh" ? "免费 SEO 审计" : "Free SEO Audit"}
              </Link>
              <Link
                href={localePath(locale, "/tools/internal-link-audit")}
                className="block text-[13px] font-semibold text-brand-accent-text hover:underline"
              >
                {locale === "zh" ? "内链审计" : "Internal Link Audit"}
              </Link>
            </div>
          </aside>
        </section>
      </div>
    </section>
  );
}
