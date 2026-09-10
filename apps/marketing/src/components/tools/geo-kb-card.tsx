"use client";
// @input  -- one website's GEO knowledge base state, its two actions and its five section slots
// @output -- the Profile-shaped card: status line, billed/free actions, sections, publish box, published summary
// @pos    -- shell only: it fetches nothing, decides no state and holds no draft
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * The same card shape the Product Profile has, because it is the same kind of
 * thing: one website's saved settings, edited in place, confirmed once, then
 * standing still as a collapsed summary until something changes.
 *
 * Two actions, told apart by what they cost. "Update" crawls, reads Search
 * Console and calls models, so the sentence next to it says so. "Publish" is
 * free, makes no model call, and is the only thing that turns a reviewed draft
 * into a version anything downstream may read.
 *
 * The measurement section collapses with a button rather than a `details`
 * element on purpose: the frozen customer view is contractually free of
 * disclosure widgets, and a `details` here would reintroduce one.
 */
import { useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, Pencil } from "lucide-react";

import { Button } from "../ui/button.tsx";
import { geoKbFormatDate, useGeoKbCopy, type GeoKbCopy } from "./geo-kb-copy.ts";

/** One slot per lettered group in the redesign; each holds already-rendered modules. */
export interface GeoKbCardSections {
  readonly identity: ReactNode;
  readonly facts: ReactNode;
  readonly trust: ReactNode;
  readonly reachability: ReactNode;
  readonly measurement: ReactNode;
  /**
   * How many questions the measurement section holds, or null when there is no
   * count to state -- a draft has no question set of its own, because a set is
   * made for a published version. Null is not zero: "0 questions" says the set
   * exists and is empty, which is the one thing this card must never claim.
   */
  readonly measurementCount: number | null;
}

export interface GeoKbPublishPlan {
  readonly nextVersion: string;
  /** Null for a first publish: there is no previous version to compare with. */
  readonly previousVersion: string | null;
  /**
   * How many items differ from the published version, or null when that version
   * records no per-item decisions -- a v1/v2 predecessor. Null is not zero: the
   * card says the count cannot be given rather than giving a wrong one.
   */
  readonly changeCount: number | null;
  readonly itemCount: number;
  /** Items still `pending`, which publish as accepted in bulk rather than confirmed. */
  readonly pendingCount: number;
  readonly onPublish: () => void;
  readonly disabled?: boolean;
  readonly busy?: boolean;
}

export interface GeoKbPublishedSummary {
  readonly version: string;
  readonly name: string;
  readonly host: string;
  readonly publishedAt: string;
  /**
   * There is deliberately no off-site count here.
   *
   * Nothing in this deployment collects off-site evidence: the run route seeds
   * on-site fetches only (`planGeoRunCollection` emits `own` and `competitor`
   * scopes), and `kb-v3-assemble-handler.ts` passes `offsite: null` to the
   * assembler. A count of third-party sources could therefore only ever be
   * `0`, and `0` here would not read as "we never looked" -- it would read as
   * "we looked and found none", which is a stronger claim than this card can
   * make. Absent from the type rather than absent from the sentence, so wiring
   * one back in is a type error instead of a rendered lie.
   */
  readonly counts: {
    /**
     * `null` where the run never measured that module, which is not zero.
     *
     * Read through `geoKbModuleValue`, an `unavailable` module hands back an
     * empty list and every count it feeds becomes `0` -- and "Facts 0" in a
     * summary reads as "we looked and found none", the same stronger claim the
     * absent off-site count above refuses to make. `null` drops the clause
     * instead, and the module's own three-state notice, one Edit away, says
     * which of the two it is.
     */
    readonly facts: { readonly facts: number; readonly accepted: number } | null;
    readonly qa: { readonly qa: number } | null;
    readonly comparisons: { readonly available: number; readonly comparisons: number } | null;
  };
  readonly onEdit: () => void;
  readonly onView?: () => void;
}

export interface GeoKbCardProps {
  readonly host: string;
  readonly locale: string;
  /** The machine-readable state, mirrored onto the live region for tests and styling. */
  readonly state: string;
  readonly statusText: string;
  readonly onUpdate: () => void;
  readonly updateLabel?: string;
  readonly updateDisabled?: boolean;
  /** Replaces the standard billing sentence, e.g. with a language refusal. */
  readonly costNote?: ReactNode;
  readonly publish?: GeoKbPublishPlan | null;
  readonly sections?: GeoKbCardSections | null;
  readonly summary?: GeoKbPublishedSummary | null;
  readonly collapsed?: boolean;
  readonly inline?: boolean;
  /** Notices and legacy content, placed under the header the way they were. */
  readonly children?: ReactNode;
}

function PublishButton({ plan, copy, ...rest }: {
  readonly plan: GeoKbPublishPlan;
  readonly copy: GeoKbCopy;
} & Record<`data-${string}`, string | undefined>) {
  return <Button
    {...rest}
    type="button"
    variant="outline"
    disabled={plan.disabled === true || plan.busy === true}
    onClick={plan.onPublish}
  >{copy.actions.publish(plan.nextVersion)}</Button>;
}

function CardHeader({ host, state, statusText, onUpdate, updateLabel, updateDisabled, costNote, publish, copy }: {
  readonly host: string;
  readonly state: string;
  readonly statusText: string;
  readonly onUpdate: () => void;
  readonly updateLabel: string;
  readonly updateDisabled: boolean;
  readonly costNote: ReactNode;
  readonly publish: GeoKbPublishPlan | null;
  readonly copy: GeoKbCopy;
}) {
  return <div className="flex min-w-0 flex-col gap-4 rounded-card border border-brand-border-card bg-brand-panel p-6">
    <div>
      <span className="block break-all text-[13px] text-brand-accent-text">{host}</span>
      {/* One persistent live region whose text changes: a node inserted per
          change is not reliably announced. */}
      <span aria-live="polite" aria-atomic="true" data-kb-state={state} className="mt-2 block min-h-5 text-[13px] text-text-dark-secondary">
        {statusText}
      </span>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button data-generate-kb type="button" disabled={updateDisabled} onClick={onUpdate}>{updateLabel}</Button>
      {publish === null ? null : <PublishButton data-publish-kb="header" plan={publish} copy={copy} />}
    </div>
    {costNote}
  </div>;
}

function SectionFrame({ name, title, items, children }: {
  readonly name: string;
  readonly title: string;
  readonly items: string;
  readonly children: ReactNode;
}) {
  const id = useId();
  return <section data-kb-section={name} aria-labelledby={id} className="min-w-0 space-y-4">
    <div className="min-w-0">
      <h3 id={id} className="text-[15px] font-semibold text-text-dark-primary">{title}</h3>
      <span className="mt-1 block text-[12px] leading-relaxed text-text-dark-secondary">{items}</span>
    </div>
    {children}
  </section>;
}

function MeasurementSection({ count, children, copy }: {
  readonly count: number | null;
  readonly children: ReactNode;
  readonly copy: GeoKbCopy;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  // Read straight from the catalog rather than through `useGeoKbCopy`: the
  // copy object states the count, and this is the sentence for having none.
  const t = useTranslations("tools.geoKnowledgeBase.card");
  return <section data-kb-section="measurement" className="min-w-0 space-y-4">
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-text-dark-primary">{copy.sections.measurement.title}</h3>
        <span data-kb-measurement-items={count === null ? "unavailable" : "count"} className="mt-1 block text-[12px] leading-relaxed text-text-dark-secondary">
          {count === null ? t("sections.measurement.itemsUnavailable") : copy.sections.measurement.items(count)}
        </span>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-kb-measurement-toggle=""
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? copy.sections.measurement.hide : copy.sections.measurement.show}
        <ChevronDown aria-hidden="true" className={`size-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </Button>
    </div>
    {open ? <div id={id} data-kb-measurement-body="">{children}</div> : null}
  </section>;
}

function PublishBox({ plan, copy }: { readonly plan: GeoKbPublishPlan; readonly copy: GeoKbCopy }) {
  const id = useId();
  return <section data-kb-publish-box="" aria-labelledby={id} className="min-w-0 space-y-3 rounded-card border border-brand-border-card bg-brand-panel p-6">
    <h3 id={id} className="text-[15px] font-semibold text-text-dark-primary">{copy.publish.title}</h3>
    <span data-kb-publish-changes="" className="block text-[13px] leading-relaxed text-text-dark-secondary">
      {plan.previousVersion === null
        ? copy.publish.firstVersion(plan.itemCount)
        // A count of null is not a count of zero. The previous version was made
        // by the contract this one replaces and records no per-item decisions,
        // so it is named and dated without a number attached to it.
        : plan.changeCount === null
          ? copy.publish.changesUncountable(plan.itemCount, plan.previousVersion)
          : copy.publish.changes(plan.changeCount, plan.previousVersion)}
    </span>
    {/* Only when there IS something pending. "Nothing is left unconfirmed" is a
        sentence about the absence of a problem, and it occupied a line of the
        publish box on every draft that had none. */}
    {plan.pendingCount === 0 ? null : <span data-kb-publish-pending="" className="block text-[13px] leading-relaxed text-text-dark-secondary">
      {copy.publish.pending(plan.pendingCount)}
    </span>}
    <div className="flex flex-wrap items-center gap-3">
      <PublishButton data-publish-kb="box" plan={plan} copy={copy} />
      <span className="text-[12px] leading-relaxed text-text-dark-secondary">{copy.publishFree}</span>
    </div>
  </section>;
}

function PublishedSummary({ summary, locale, copy }: {
  readonly summary: GeoKbPublishedSummary;
  readonly locale: string;
  readonly copy: GeoKbCopy;
}) {
  const id = useId();
  return <div
    role="region"
    aria-labelledby={id}
    data-geo-kb-collapsed="true"
    className="min-w-0 space-y-5 rounded-card border border-brand-accent/40 bg-brand-panel p-6 sm:p-7"
  >
    <div className="flex flex-wrap items-start justify-between gap-4">
      <span role="status" data-kb-published-version="" className="flex items-center gap-2 text-[13px] font-medium text-brand-accent-text">
        <Check aria-hidden="true" className="size-4" />
        {copy.published.headline(summary.version)}
      </span>
      <div className="flex flex-wrap gap-2">
        {summary.onView === undefined ? null : <Button type="button" variant="outline" size="sm" data-kb-view="" onClick={summary.onView}>{copy.actions.view}</Button>}
        <Button type="button" variant="outline" size="sm" data-kb-edit="" aria-expanded={false} onClick={summary.onEdit}>
          <Pencil aria-hidden="true" className="size-4" />
          {copy.actions.edit}
        </Button>
      </div>
    </div>
    <h2 id={id} className="min-w-0 break-words text-[20px] font-semibold text-text-dark-primary [overflow-wrap:anywhere]">{summary.name}</h2>
    <span className="block break-all font-mono text-[12px] text-text-dark-secondary">{summary.host}</span>
    <span data-kb-published-counts="" className="block text-[13px] leading-relaxed text-text-dark-secondary">
      {/* Through `useGeoKbCopy` like every other string on this card: its
          `published.counts` asks for exactly the fields this summary holds.
          Dropping an unmeasured module's clause is decided here, not by the
          route the string travels -- a clause that is `null` is never built,
          so no number is invented for a section nobody looked at. Joined
          rather than templated for that reason; the separator is the one
          every catalog used inside the single sentence this replaced, and the
          date closes the line whether or not any clause survived. */}
      {[
        summary.counts.facts === null ? null : copy.published.counts.facts(summary.counts.facts),
        summary.counts.qa === null ? null : copy.published.counts.qa(summary.counts.qa),
        summary.counts.comparisons === null ? null : copy.published.counts.comparisons(summary.counts.comparisons),
        geoKbFormatDate(summary.publishedAt, locale),
      ].filter((clause) => clause !== null).join(" · ")}
    </span>
  </div>;
}

export function GeoKbCard({
  host,
  locale,
  state,
  statusText,
  onUpdate,
  updateLabel,
  updateDisabled = false,
  costNote,
  publish = null,
  sections = null,
  summary = null,
  collapsed = false,
  inline = false,
  children,
  ...rest
}: GeoKbCardProps & Record<`data-${string}`, string | boolean | undefined>) {
  const copy = useGeoKbCopy();
  if (collapsed && summary !== null) {
    return <section {...rest} data-geo-kb-card="" data-inline={inline} className="min-w-0 text-text-dark-primary">
      <PublishedSummary summary={summary} locale={locale} copy={copy} />
    </section>;
  }
  return <section {...rest} data-geo-kb-card="" data-inline={inline} className="min-w-0 space-y-6 text-text-dark-primary">
    <CardHeader
      host={host}
      state={state}
      statusText={statusText}
      onUpdate={onUpdate}
      updateLabel={updateLabel ?? copy.actions.update}
      updateDisabled={updateDisabled}
      costNote={costNote ?? <span data-kb-cost="" className="block text-[12px] leading-relaxed text-text-dark-secondary">{copy.cost}</span>}
      publish={publish}
      copy={copy}
    />
    {children}
    {sections === null ? null : <div className="min-w-0 space-y-8">
      <SectionFrame name="identity" title={copy.sections.identity.title} items={copy.sections.identity.items}>{sections.identity}</SectionFrame>
      <SectionFrame name="facts" title={copy.sections.facts.title} items={copy.sections.facts.items}>{sections.facts}</SectionFrame>
      <SectionFrame name="trust" title={copy.sections.trust.title} items={copy.sections.trust.items}>{sections.trust}</SectionFrame>
      <SectionFrame name="reachability" title={copy.sections.reachability.title} items={copy.sections.reachability.items}>{sections.reachability}</SectionFrame>
      <MeasurementSection count={sections.measurementCount} copy={copy}>{sections.measurement}</MeasurementSection>
    </div>}
    {publish === null ? null : <PublishBox plan={publish} copy={copy} />}
  </section>;
}
