"use client";
// @input  -- a section title and its content, at the heading depth the host set
// @output -- the Profile editor's section card, so both editors read as one asset
// @pos    -- layout only; it gates nothing and knows nothing about the draft
import { useId, type ReactNode } from "react";

/**
 * The Profile editor draws every section the same way: a raised header strip
 * carrying an accent rule and the title, then the fields below a divider. GEO
 * is the same kind of thing -- one website's saved settings -- so it is drawn
 * the same way rather than in a second visual language of its own.
 */
export function GeoKbSection({ title, heading, children }: {
  readonly title: string;
  readonly heading: 2 | 3 | 4;
  readonly children: ReactNode;
}) {
  const id = useId();
  const Heading = (heading === 2 ? "h2" : heading === 3 ? "h3" : "h4") as "h2" | "h3" | "h4";
  return <section aria-labelledby={id} className="min-w-0 overflow-hidden rounded-card border border-brand-border-strong bg-brand-panel">
    <div className="border-b border-brand-border-card bg-brand-panel-raised px-5 py-5 sm:px-7">
      <Heading id={id} className="flex items-center gap-3 text-[17px] font-semibold text-text-dark-primary">
        <span aria-hidden="true" className="h-5 w-1 shrink-0 rounded-full bg-brand-accent" />
        {title}
      </Heading>
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
  return <div {...rest} className="min-w-0 py-6 first:pt-0 last:pb-0 sm:py-7">
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

/**
 * A value that belongs to another editor, shown here and changeable only
 * there. Deliberately not an input: a read-only input carries this app's
 * editable styling and its focus ring, so it invites a click and then ignores
 * the typing -- and an empty one shows its "not provided" text as a
 * placeholder, which is not the value any assistive technology reads. The box
 * exists to hold the row's rhythm, not to look like a field.
 */
export function GeoKbReadout({ value, empty }: { readonly value: string; readonly empty: string }) {
  const shown = value.trim() === "";
  return <p data-geo-readout className={`min-w-0 whitespace-pre-wrap break-words rounded-md border border-dashed border-brand-border-card bg-brand-bg/40 px-3 py-2 text-[14px] leading-relaxed [overflow-wrap:anywhere] ${shown ? "text-text-dark-secondary" : "text-text-dark-primary"}`}>
    {shown ? empty : value}
  </p>;
}
