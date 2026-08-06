// @input  -- metrics data array (label, before, after, change)
// @output -- CaseStudyMetrics grid component for embedding in case study blog posts
// @pos    -- reusable metrics display for case study articles, SPEC 2.7.3
// once this file is updated, update header comments and _DIR.md in this folder

export interface CaseStudyMetric {
  label: string;
  before: string;
  after: string;
  change: string;
}

interface CaseStudyMetricsProps {
  readonly metrics: readonly CaseStudyMetric[];
  readonly locale: string;
}

export function CaseStudyMetrics({ metrics, locale }: CaseStudyMetricsProps) {
  const beforeLabel = locale === "zh" ? "之前" : "Before";
  const afterLabel = locale === "zh" ? "之后" : "After";

  return (
    /*
     * 指标走伪表格：共享外框 + 1px 分隔线，让「之前/之后」读成同一张读数表的
     * 若干行，而不是几张彼此独立、可单独挑选的卡片。
     */
    <div className="my-10 grid grid-cols-1 gap-px overflow-hidden rounded-card border border-brand-border-card bg-brand-border-card sm:grid-cols-2">
      {metrics.map((metric) => (
        <div key={metric.label} className="bg-brand-panel-sunken p-[20px_22px]">
          <p className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
            {metric.label}
          </p>

          <div className="mt-4 flex items-baseline justify-between gap-3">
            <span className="font-mono text-[9.5px] tracking-[0.08em] text-text-dark-secondary uppercase">
              {beforeLabel}
            </span>
            <span className="font-mono text-[14px] text-text-dark-secondary">
              {metric.before}
            </span>
          </div>

          <div className="mt-2.5 flex items-baseline justify-between gap-3">
            <span className="font-mono text-[9.5px] tracking-[0.08em] text-text-dark-secondary uppercase">
              {afterLabel}
            </span>
            <span className="font-mono text-[22px] leading-none text-text-dark-primary">
              {metric.after}
            </span>
          </div>

          <p className="mt-4 border-t border-brand-border-faint pt-3 font-mono text-[12px] tracking-[0.04em] text-brand-accent-text">
            {metric.change}
          </p>
        </div>
      ))}
    </div>
  );
}
