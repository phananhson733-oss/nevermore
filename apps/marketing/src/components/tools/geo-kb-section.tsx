"use client";
// @input  -- a section title and its content, at the heading depth the host set
// @output -- the Profile editor's section card, so both editors read as one asset
// @pos    -- layout only; it gates nothing and knows nothing about the draft
import { useId, type ReactNode } from "react";

/** Depth of the section heading, so each host keeps one unbroken outline. */
export type GeoKbHeadingLevel = 2 | 3 | 4;

/**
 * The Profile editor draws every section the same way: a raised header strip
 * carrying an accent rule and the title, then the fields below a divider. GEO
 * is the same kind of thing -- one website's saved settings -- so it is drawn
 * the same way rather than in a second visual language of its own.
 */
export function GeoKbSection({ title, description, heading = 3, action, children, ...rest }: {
  readonly title: string;
  readonly description?: string;
  readonly heading?: GeoKbHeadingLevel;
  readonly action?: ReactNode;
  readonly children: ReactNode;
} & Record<`data-${string}`, string | boolean | undefined>) {
  const id = useId();
  const Heading = (heading === 2 ? "h2" : heading === 3 ? "h3" : "h4") as "h2" | "h3" | "h4";
  return <section {...rest} aria-labelledby={id} className="min-w-0 overflow-hidden rounded-card border border-brand-border-strong bg-brand-panel">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-brand-border-card bg-brand-panel-raised px-5 py-5 sm:px-7">
      <div className="min-w-0 space-y-1.5">
        <Heading id={id} className="flex items-center gap-3 text-[17px] font-semibold text-text-dark-primary">
          <span aria-hidden="true" className="h-5 w-1 shrink-0 rounded-full bg-brand-accent" />
          {title}
        </Heading>
        {description === undefined ? null : <p className="text-[13px] leading-relaxed text-text-dark-secondary">{description}</p>}
      </div>
      {action === undefined ? null : <div className="shrink-0">{action}</div>}
    </div>
    <div className="px-5 py-6 sm:px-7">{children}</div>
  </section>;
}

/**
 * One field row in the Profile editor's rhythm: the label above its value, the
 * rows separated by a rule rather than by guessed margins, and any per-row
 * action in the same place on every row instead of trailing the text it
 * belongs to at whatever width that text happens to end.
 */
export function GeoKbFieldRow({ label, hint, action, children, ...rest }: {
  readonly label: string;
  readonly hint?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
} & Record<`data-${string}`, string | boolean | undefined>) {
  return <div {...rest} className="min-w-0 py-5 first:pt-0 last:pb-0">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <span className="text-[14px] font-medium text-text-dark-primary">{label}</span>
      {action === undefined ? null : <div className="shrink-0">{action}</div>}
    </div>
    <div className="mt-3 min-w-0">{children}</div>
    {hint === undefined ? null : <p className="mt-2 text-[12px] leading-relaxed text-text-dark-secondary">{hint}</p>}
  </div>;
}

/** The rows of one section, divided the way the Profile editor divides its fields. */
export function GeoKbFieldRows({ children }: { readonly children: ReactNode }) {
  return <div className="min-w-0 divide-y divide-brand-border-card">{children}</div>;
}
