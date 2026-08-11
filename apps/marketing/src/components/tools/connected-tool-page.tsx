// @input  -- locale, ConnectedToolContent, shared site configuration
// @output -- transparent source-gated tool landing page
// @pos    -- public handoff for product workflows that cannot use anonymous demo data
import { ArrowRight, CheckCircle2, Database, ShieldCheck } from "lucide-react";
import Link from "next/link";
// Relative, not `@/`: the shared Vitest config maps `@/` to apps/web only, so
// aliased imports would make this file untestable from the unit project.
import { siteConfig } from "../../config/site";
import type { ConnectedToolContent } from "./connected-tool-content";
import { localePath } from "../../lib/locale-path";

/**
 * Tools whose Google grant starts on this page. Their hero CTA must open the
 * OAuth flow and return here — handing off to the app home drops both the
 * requested scope and the way back to the tool. Everything else keeps the
 * product hand-off.
 */
const GSC_CONNECT_PATHS: ReadonlySet<string> = new Set([
  "/tools/seo-quick-wins",
  "/tools/traffic-drop-diagnosis",
  "/tools/hidden-keywords",
]);

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
  // Same URL the in-page connect panel builds, locale prefix included, so the
  // two CTAs on one page cannot start two different flows.
  const ctaHref = GSC_CONNECT_PATHS.has(content.path)
    ? `/api/auth/google/start?scope=gsc&next=${encodeURIComponent(
        localePath(locale, content.path),
      )}`
    : siteConfig.appUrl;

  return (
    /* 顶部间距只留 36px：PageShell 已经为 fixed 导航垫了 68px */
    <section className="min-h-screen bg-brand-bg pt-9 pb-24">
      <div className="max-w-report mx-auto px-6 md:px-8">
        {/* 与共享 VisibleBreadcrumb 同一套排印：面包屑是路径标签，走 mono */}
        <nav
          className="mb-8 font-mono text-[12px] tracking-[0.06em] text-text-dark-secondary uppercase"
          aria-label="Breadcrumb"
        >
          <Link
            href={localePath(locale)}
            className="transition-colors hover:text-text-dark-primary"
          >
            {homeLabel}
          </Link>
          <span className="mx-2 text-text-dark-faint">/</span>
          <Link
            href={localePath(locale, "/tools")}
            className="transition-colors hover:text-text-dark-primary"
          >
            {toolsLabel}
          </Link>
          <span className="mx-2 text-text-dark-faint">/</span>
          <span className="text-text-dark-primary">{content.title}</span>
        </nav>

        <header className="relative overflow-hidden border-b border-brand-border pt-7 pb-12 md:pb-14">
          {/* GLOW_01 — 页级 hero 才允许的网格 + 氛围光 */}
          <div
            aria-hidden="true"
            className="bg-signal-grid absolute inset-0 opacity-40"
          />
          <div
            aria-hidden="true"
            className="absolute -top-30 right-[4%] hidden h-70 w-100 rounded-full bg-[radial-gradient(ellipse,rgba(61,220,151,0.13),transparent_65%)] blur-[12px] md:block"
          />
          <div className="relative">
            <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
              {content.eyebrow}
            </p>
            <h1 className="text-page-title mt-4 max-w-4xl text-text-dark-primary">
              {content.title}
            </h1>
            <p className="mt-5 max-w-2xl text-[15.5px] leading-[1.65] text-text-dark-secondary md:text-[17px]">
              {content.description}
            </p>
            {connected ? null : (
              <div className="rounded-card border-brand-border-card bg-brand-panel mt-8 grid max-w-3xl gap-3 border p-[22px] md:grid-cols-[auto_1fr]">
                <ShieldCheck
                  aria-hidden="true"
                  className="size-[18px] text-brand-accent"
                />
                <div>
                  <p className="text-[13px] font-semibold text-text-dark-primary">
                    {content.sourceLabel}
                  </p>
                  <p className="mt-1.5 text-[13px] leading-[1.6] text-text-dark-secondary">
                    {content.sourceDetail}
                  </p>
                </div>
              </div>
            )}
            {/*
            This CTA is for someone who cannot run the tool here. Once they
            have connected, it contradicts the working tool below; before
            that, it steps down to a link so two identical primary buttons do
            not pull people away from the thing they came to run.
          */}
            {connected ? null : (
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <a
                  href={ctaHref}
                  className={
                    children
                      ? "inline-flex min-h-11 items-center gap-2 font-mono text-[10.5px] tracking-[0.06em] text-brand-accent-text uppercase transition-colors hover:text-brand-accent-hover"
                      : "inline-flex h-12 min-h-11 items-center justify-center gap-2 rounded-[10px] bg-brand-gradient px-[26px] text-[14.5px] font-semibold text-brand-on-accent shadow-cta transition-shadow hover:shadow-cta-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
                  }
                >
                  {content.cta}
                  <ArrowRight aria-hidden="true" className="size-4" />
                </a>
                <p className="max-w-md text-[12.5px] leading-[1.6] text-text-dark-secondary">
                  {content.trust}
                </p>
              </div>
            )}
          </div>
        </header>

        {children ? <div className="pt-10 md:pt-12">{children}</div> : null}

        <section className="grid gap-10 py-16 md:grid-cols-[0.8fr_1.2fr] md:py-22">
          <div>
            <div className="flex size-11 items-center justify-center rounded-[10px] border border-brand-accent/25 bg-brand-accent-soft text-brand-accent">
              <Database aria-hidden="true" className="size-[18px]" />
            </div>
            <h2 className="mt-5 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
              {content.workflowTitle}
            </h2>
          </div>
          {/*
            这几步是一条有序链路，共享外框加 1px 分隔线能表达“同一条流水线的几
            段”；卡片间距会把它们读成几个可独立选择的选项。
          */}
          <ol className="rounded-card border-brand-border-card bg-brand-border-card grid gap-px overflow-hidden border">
            {content.steps.map((step, index) => (
              <li
                key={step.name}
                className="bg-brand-panel flex gap-4 p-[20px]"
              >
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

        {article}

        <section
          className={
            connected
              ? "py-16 md:py-22"
              : "grid gap-10 py-16 md:grid-cols-[1.25fr_0.75fr] md:py-22"
          }
        >
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
          {/* 这张卡对「还没连接」的访客说话（run first / 无需连接）。连接后的
              报告自带出口卡，再渲染这张会在同一页出现两个出口。 */}
          {connected ? null : (
            <aside className="rounded-card border-brand-border-card bg-brand-panel h-fit border p-[22px]">
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                {relatedLabel}
              </p>
              <p className="mt-3 text-[15.5px] leading-snug font-semibold text-text-dark-primary">
                {locale === "zh"
                  ? "先用无需连接的数据检查网站基础。"
                  : "Start with a site check that does not require a connection."}
              </p>
              {/* 「去别处」型导航链接走次强调色，避免和页面主强调抢 */}
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
          )}
        </section>
      </div>
    </section>
  );
}
