"use client";
// @input  -- one reviewable knowledge item: its content, where it came from, what was decided
// @output -- a row that shows source and decision as two independent facts, plus its actions; and the tinted chip every GEO surface labels with
// @pos    -- presentation only; it holds no item key and writes nothing
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * Two properties, never collapsed into one.
 *
 * `origin` says where a claim came from. `decision` says what the owner did
 * about it. They stay apart because a model summary the owner accepted is
 * still a model summary, and the source line must keep saying so.
 *
 * `accepted_in_bulk` is a retired decision only older drafts carry; it renders
 * and behaves exactly as `accepted`, including the accept button's pressed
 * state, because the Owner's ruling is that a batch acceptance IS one.
 *
 * The source line says the origin and nothing else. It used to add the
 * observation date, a "review by" date ninety days out and the citation-check
 * verdict; the Owner read the review date as an error and the rest as noise
 * (2026-09-11). The citation check is still carried by every item and still
 * gates nothing here: it proves a cited page exists and that the claim's
 * numbers occur in it, which was never a confirmation and is now not drawn
 * either. The origin word stays because it is the only place that says an
 * accepted summary is still a summary.
 *
 * The item key stays in the callbacks. It is an internal identity and the
 * frozen-view pruning contract keeps it, and every other internal identity,
 * out of the DOM.
 */
import { type ReactNode } from "react";

import type { GeoEvidenceCheck } from "../../lib/geo-tools/kb-knowledge-shape.ts";
import type { GeoDecision } from "../../lib/geo-tools/kb-v3-contract.ts";
import { Button } from "../ui/button.tsx";
import { useGeoKbCopy, type GeoKbCopy, type GeoKbIndependence } from "./geo-kb-copy.ts";

/**
 * Where one item came from, in the vocabulary a customer can check. Each
 * origin carries only the detail that origin actually has: a competitor page
 * has a path, an off-site page has a domain and an independence verdict, a
 * model summary has a count of what it cited.
 */
export type GeoKbItemSource =
  | { readonly origin: "observed_own"; readonly path: string | null }
  | { readonly origin: "observed_competitor"; readonly path: string | null }
  | { readonly origin: "observed_third_party"; readonly domain: string | null; readonly independence: GeoKbIndependence }
  | { readonly origin: "observed_gsc" }
  | { readonly origin: "declared_profile"; readonly revision: string | null }
  | { readonly origin: "declared_owner" }
  | { readonly origin: "synthesized"; readonly evidenceCount: number };

export interface GeoKbItemActions {
  readonly onAccept: () => void;
  readonly onCorrect: () => void;
  readonly onExclude: () => void;
  readonly onRevert: () => void;
  readonly disabled?: boolean;
  /**
   * The section has no shape without this item, so it cannot be excluded. The
   * assembler withholds a whole section rather than publish a required field
   * the owner rejected; offering the gesture and letting the owner find out at
   * publish time would hide the consequence behind the one action that is hard
   * to take back. The first version kept the button, disabled, with a sentence
   * explaining why. The Owner's ruling (2026-09-11): a gesture that cannot be
   * taken is not offered, and a sentence about a button that is not there is
   * not written.
   */
  readonly required?: boolean;
}

export interface GeoKbItemRowProps {
  /** The short kind chip on the left, e.g. the fact type or the question intent. */
  readonly typeLabel: string;
  readonly children: ReactNode;
  readonly source: GeoKbItemSource;
  readonly decision: GeoDecision;
  /** Carried by every item; see the file comment for why it is not drawn. */
  readonly evidenceChecks: GeoEvidenceCheck;
  /** What the correction replaced. Displayed, and never counted as support. */
  readonly priorSource?: GeoKbItemSource | null;
  /** The same key was seen again on the same page, with different content. */
  readonly newObservation?: boolean;
  /** The same key arrived from a different page, so both now exist. */
  readonly conflict?: boolean;
  /** Omitted on a published version: there is nothing left to decide there. */
  readonly actions?: GeoKbItemActions;
}

/** The readable parts of one source line, in order, already localized. */
export function geoKbSourceParts(source: GeoKbItemSource, copy: GeoKbCopy): readonly string[] {
  switch (source.origin) {
    case "observed_own":
    case "observed_competitor":
      return source.path === null
        ? [copy.origins[source.origin]]
        : [copy.origins[source.origin], source.path];
    case "observed_third_party":
      return [
        source.domain === null ? copy.origins.observed_third_party : copy.originDetail.thirdParty(source.domain),
        copy.independence[source.independence],
      ];
    case "observed_gsc":
      return [copy.origins.observed_gsc];
    case "declared_profile":
      return [source.revision === null ? copy.origins.declared_profile : copy.originDetail.profile(source.revision)];
    case "declared_owner":
      return [copy.origins.declared_owner];
    case "synthesized":
      return [copy.originDetail.synthesized(source.evidenceCount)];
  }
}

/**
 * A chip is a label, not a footnote. Drawn as a grey outline it read as part
 * of the source line under it, and the Owner asked for the labels to stand out
 * (2026-09-11: "tint the background or make them bold"). `label` is the
 * ordinary tone -- the kind of item, the decision -- on the sunken panel tint
 * this app uses for status strips. `flag` is for the two things a reviewer
 * must not miss, a new observation and a possible conflict, in the warning
 * tone `limitation-hint` already uses for the same job.
 */
export type GeoKbChipTone = "label" | "flag";

const CHIP_TONE: Readonly<Record<GeoKbChipTone, string>> = {
  label: "border-brand-border-strong bg-brand-panel-sunken text-text-dark-primary",
  flag: "border-brand-warning/55 bg-brand-warning/10 text-brand-warning",
};

export function GeoKbChip({ tone = "label", children, ...rest }: {
  readonly tone?: GeoKbChipTone;
  readonly children: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  return <span
    {...rest}
    data-chip-tone={tone}
    className={`inline-flex rounded-full border px-2.5 py-1 text-[12px] font-medium leading-relaxed ${CHIP_TONE[tone]}`}
  >{children}</span>;
}

function Meta({ parts }: { readonly parts: readonly string[] }) {
  return <>{parts.map((part, index) => <span key={index} className="min-w-0 break-words [overflow-wrap:anywhere]">{index === 0 ? "" : " · "}{part}</span>)}</>;
}

function Actions({ actions, decision, corrected, copy }: {
  readonly actions: GeoKbItemActions;
  readonly decision: GeoDecision;
  readonly corrected: boolean;
  readonly copy: GeoKbCopy;
}) {
  const disabled = actions.disabled === true;
  if (corrected) {
    return <Button type="button" variant="outline" size="sm" data-item-action="revert" disabled={disabled} onClick={actions.onRevert}>{copy.item.revert}</Button>;
  }
  return <>
    <Button type="button" variant="outline" size="sm" data-item-action="accept" aria-pressed={decision === "accepted" || decision === "accepted_in_bulk"} disabled={disabled} onClick={actions.onAccept}>{copy.item.accept}</Button>
    <Button type="button" variant="outline" size="sm" data-item-action="correct" disabled={disabled} onClick={actions.onCorrect}>{copy.item.correct}</Button>
    {actions.required === true ? null : <Button
      type="button"
      variant="outline"
      size="sm"
      data-item-action="exclude"
      aria-pressed={decision === "excluded"}
      disabled={disabled}
      onClick={actions.onExclude}
    >{copy.item.exclude}</Button>}
  </>;
}

export function GeoKbItemRow({
  typeLabel,
  children,
  source,
  decision,
  priorSource = null,
  newObservation = false,
  conflict = false,
  actions,
}: GeoKbItemRowProps) {
  const copy = useGeoKbCopy();
  const corrected = source.origin === "declared_owner";
  const parts = geoKbSourceParts(source, copy);
  const prior = priorSource === null ? [] : [copy.item.priorBasis, ...geoKbSourceParts(priorSource, copy)];
  return <article
    data-geo-kb-item=""
    data-decision={decision}
    data-origin={source.origin}
    className="min-w-0 rounded-[10px] border border-brand-border-card bg-brand-bg p-4 sm:p-5"
  >
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-5 gap-y-3">
      <div className="min-w-0 flex-1 basis-64 space-y-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-2">
          <GeoKbChip data-item-type="">{typeLabel}</GeoKbChip>
          <div data-knowledge-copy="compact" className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text-dark-primary [overflow-wrap:anywhere]">{children}</div>
        </div>
        <div data-item-source="" className="min-w-0 text-[12px] leading-relaxed text-text-dark-secondary">
          <Meta parts={parts} />
        </div>
        {prior.length === 0 ? null : <div data-item-prior-source="" className="min-w-0 text-[12px] leading-relaxed text-text-dark-secondary">
          <Meta parts={prior} />
        </div>}
        {newObservation || conflict ? <div className="flex flex-wrap gap-2">
          {newObservation ? <GeoKbChip tone="flag" data-item-flag="new_observation">{copy.item.newObservation}</GeoKbChip> : null}
          {conflict ? <GeoKbChip tone="flag" data-item-flag="conflict">{copy.item.conflict}</GeoKbChip> : null}
        </div> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <GeoKbChip data-decision-chip="">{copy.decisions[decision]}</GeoKbChip>
        {actions === undefined ? null : <Actions actions={actions} decision={decision} corrected={corrected} copy={copy} />}
      </div>
    </div>
  </article>;
}
