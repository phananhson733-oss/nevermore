"use client";
// @input  -- a section title and its content, at the heading depth the host set, and whether it may fold
// @output -- the Profile editor's section card, so both editors read as one asset; folded to its header when asked
// @pos    -- layout only; it gates nothing and knows nothing about the draft
import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * The Profile editor draws every section the same way: a raised header strip
 * carrying an accent rule and the title, then the fields below a divider. GEO
 * is the same kind of thing -- one website's saved settings -- so it is drawn
 * the same way rather than in a second visual language of its own.
 *
 * `collapsible` folds the section to its header strip, closed by default, and
 * the whole strip is the button that opens it. The review card asks for this
 * on the three modules that report observations rather than ask for
 * decisions (Owner, 2026-09-11): drawn open they put a screen of cards between
 * the reviewer and the next thing to decide. It is a button and not a
 * `details` element because the frozen customer view is contractually free of
 * disclosure widgets, and that view never asks. The body is not rendered
 * while folded, so nothing inside a folded module can be found, focused or
 * read aloud.
 */
export function GeoKbSection({ title, heading, collapsible = false, children }: {
  readonly title: string;
  readonly heading: 2 | 3 | 4;
  readonly collapsible?: boolean;
  readonly children: ReactNode;
}) {
  const id = useId();
  const bodyId = `${id}-body`;
  const [open, setOpen] = useState(false);
  const Heading = (heading === 2 ? "h2" : heading === 3 ? "h3" : "h4") as "h2" | "h3" | "h4";
  const expanded = !collapsible || open;
  const label = <>
    <span aria-hidden="true" className="h-5 w-1 shrink-0 rounded-full bg-brand-accent" />
    <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{title}</span>
  </>;
  return <section aria-labelledby={id} data-section-collapsed={collapsible ? String(!open) : undefined} className="min-w-0 overflow-hidden rounded-card border border-brand-border-strong bg-brand-panel">
    <div className={`bg-brand-panel-raised ${expanded ? "border-b border-brand-border-card" : ""}`}>
      <Heading id={id} className="text-[17px] font-semibold text-text-dark-primary">
        {collapsible
          ? <button
            type="button"
            data-section-toggle=""
            aria-expanded={open}
            // Only while the body is in the DOM: an id reference to nothing is
            // a dangling reference, not a closed disclosure.
            aria-controls={open ? bodyId : undefined}
            onClick={() => setOpen((current) => !current)}
            className="flex w-full items-center gap-3 px-5 py-5 text-left transition-colors duration-150 hover:bg-brand-panel-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-accent sm:px-7"
          >
            {label}
            <ChevronDown aria-hidden="true" className={`size-5 shrink-0 text-text-dark-secondary transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          </button>
          : <span className="flex items-center gap-3 px-5 py-5 sm:px-7">{label}</span>}
      </Heading>
    </div>
    {expanded ? <div id={bodyId} data-section-body="" className="px-5 py-6 sm:px-7">{children}</div> : null}
  </section>;
}

/**
 * One field row in the Profile editor's rhythm: the label above its value, the
 * rows separated by a rule rather than by guessed margins, and any per-row
 * action in the same place on every row instead of trailing the text it
 * belongs to at whatever width that text happens to end.
 *
 * The row is a named group. Its values are read out, not typed into, so there
 * is no control to hang `htmlFor` on -- and adjacency alone is a name only for
 * someone reading straight down. Anyone arriving at a value by paragraph or
 * list-item navigation lands inside the group and hears which field it is.
 */
export function GeoKbFieldRow({ label, hint, action, children, ...rest }: {
  readonly label: string;
  readonly hint?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
} & Record<`data-${string}`, string | boolean | undefined>) {
  const labelId = useId();
  return <div {...rest} role="group" aria-labelledby={labelId} className="min-w-0 py-6 first:pt-0 last:pb-0 sm:py-7">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <span id={labelId} className="text-[14px] font-medium text-text-dark-primary">{label}</span>
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
 * there. It is the Profile editor's own box -- `ui/input`'s recipe: a solid
 * `border-brand-border-strong` at 10px, 16px of side padding, and at least the
 * 44px an input is tall -- so a field reads at the same weight in both places
 * instead of as a faint dashed sketch of the real one. It grows past 44px the
 * way `ui/textarea` does, because these values are read whole, not scrolled.
 *
 * Deliberately still not an input: a read-only input carries this app's focus
 * ring, so it invites a click and then ignores the typing -- and an empty one
 * shows its "not provided" text as a placeholder, which is not the value any
 * assistive technology reads.
 */
export function GeoKbReadout({ value, empty }: { readonly value: string; readonly empty: string }) {
  const shown = value.trim() === "";
  return <p data-geo-readout className={`min-h-11 min-w-0 whitespace-pre-wrap break-words rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 py-2.5 text-[14px] leading-relaxed [overflow-wrap:anywhere] ${shown ? "text-text-dark-secondary" : "text-text-dark-primary"}`}>
    {shown ? empty : value}
  </p>;
}
