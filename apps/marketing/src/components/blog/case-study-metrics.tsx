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

export function CaseStudyMetrics({
  metrics,
  locale,
}: CaseStudyMetricsProps) {
  const beforeLabel = locale === "zh" ? "之前" : "Before";
  const afterLabel = locale === "zh" ? "之后" : "After";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-10">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="bg-brand-bg-alt rounded-lg border border-brand-border/30 p-5"
        >
          <p className="text-text-dark-secondary text-[13px] mb-3 font-medium">
            {metric.label}
          </p>
          <div className="flex items-baseline gap-3 mb-2">
            <span className="text-text-dark-secondary text-[12px] uppercase tracking-wide">
              {beforeLabel}
            </span>
            <span className="text-text-dark-primary text-[15px]">
              {metric.before}
            </span>
          </div>
          <div className="flex items-baseline gap-3 mb-3">
            <span className="text-text-dark-secondary text-[12px] uppercase tracking-wide">
              {afterLabel}
            </span>
            <span className="text-text-dark-primary text-[15px] font-semibold">
              {metric.after}
            </span>
          </div>
          <p className="text-brand-accent-text text-[16px] font-semibold">
            {metric.change}
          </p>
        </div>
      ))}
    </div>
  );
}
