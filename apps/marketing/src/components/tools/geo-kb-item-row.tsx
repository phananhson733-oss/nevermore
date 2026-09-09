"use client";
// @input  -- one reviewable knowledge item: its content, where it came from, what was decided
// @output -- a row that shows source and decision as two independent facts, plus its actions
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
 * `cited_and_literals_match` is a third thing again, and is labelled "citation
 * check passed": it proves the cited page exists and that the numbers in the
 * claim occur in it. It does not prove the sentence true, and it is never
 * rendered as confirmation.
 *
 * The item key stays in the callbacks. It is an internal identity and the
 * frozen-view pruning contract keeps it, and every other internal identity,
 * out of the DOM.
 */
import { useId, type ReactNode } from "react";

import type { GeoEvidenceCheck } from "../../lib/geo-tools/kb-knowledge-shape.ts";
import type { GeoDecision } from "../../lib/geo-tools/kb-v3-contract.ts";
import { Button } from "../ui/button.tsx";
import { geoKbFormatDate, useGeoKbCopy, type GeoKbCopy, type GeoKbIndependence } from "./geo-kb-copy.ts";

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
   * Why this particular item cannot be excluded, when it cannot be. The
   * assembler withholds a whole section rather than publish a required field
   * the owner rejected, so offering the gesture and letting the owner find out
   * at publish time hides the consequence behind the one action that is hard to
   * take back. The button stays visible and disabled, with the reason rendered
   * beside it rather than in a tooltip: a tooltip is invisible on touch and to
   * a screen reader that never hovers.
   */
  readonly excludeBlockedReason?: string | null;
}

export interface GeoKbItemRowProps {
  /** The short kind chip on the left, e.g. the fact type or the question intent. */
  readonly typeLabel: string;
  readonly children: ReactNode;
  readonly source: GeoKbItemSource;
  readonly decision: GeoDecision;
  readonly evidenceChecks: GeoEvidenceCheck;
  readonly locale: string;
  readonly observedAt?: string | null;
  readonly nextReviewAt?: string | null;
  /** Set on an owner correction only; it is what "corrected on" reads from. */
  readonly ownerDeclaredAt?: string | null;
  /** What the correction replaced. Displayed, and never counted as support. */
  readonly priorSource?: GeoKbItemSource | null;
  readonly priorObservedAt?: string | null;
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

function Chip({ children, ...rest }: { readonly children: ReactNode } & Record<`data-${string}`, string | undefined>) {
  return <span
    {...rest}
    className="inline-flex rounded-full border border-brand-border-card px-2.5 py-1 text-[12px] leading-relaxed text-text-dark-secondary"
  >{children}</span>;
}

function Meta({ parts }: { readonly parts: readonly string[] }) {
  return <>{parts.map((part, index) => <span key={index} className="min-w-0 break-words [overflow-wrap:anywhere]">{index === 0 ? "" : " · "}{part}</span>)}</>;
}

function Actions({ actions, decision, corrected, copy, blockedNoteId }: {
  readonly actions: GeoKbItemActions;
  readonly decision: GeoDecision;
  readonly corrected: boolean;
  readonly copy: GeoKbCopy;
  readonly blockedNoteId: string | null;
}) {
  const disabled = actions.disabled === true;
  if (corrected) {
    return <Button type="button" variant="outline" size="sm" data-item-action="revert" disabled={disabled} onClick={actions.onRevert}>{copy.item.revert}</Button>;
  }
  return <>
    <Button type="button" variant="outline" size="sm" data-item-action="accept" aria-pressed={decision === "accepted" || decision === "accepted_in_bulk"} disabled={disabled} onClick={actions.onAccept}>{copy.item.accept}</Button>
    <Button type="button" variant="outline" size="sm" data-item-action="correct" disabled={disabled} onClick={actions.onCorrect}>{copy.item.correct}</Button>
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-item-action="exclude"
      data-exclude-blocked={blockedNoteId === null ? undefined : ""}
      aria-pressed={decision === "excluded"}
      disabled={disabled || blockedNoteId !== null}
      {...(blockedNoteId === null ? {} : { "aria-describedby": blockedNoteId })}
      onClick={actions.onExclude}
    >{copy.item.exclude}</Button>
  </>;
}

export function GeoKbItemRow({
  typeLabel,
  children,
  source,
  decision,
  evidenceChecks,
  locale,
  observedAt = null,
  nextReviewAt = null,
  ownerDeclaredAt = null,
  priorSource = null,
  priorObservedAt = null,
  newObservation = false,
  conflict = false,
  actions,
}: GeoKbItemRowProps) {
  const copy = useGeoKbCopy();
  const generatedId = useId();
  const corrected = source.origin === "declared_owner";
  // A correction replaces the value in place, so the reason to block an
  // exclusion does not apply while the row is showing one -- and `Actions`
  // renders only Revert then anyway.
  const blockedReason = corrected ? null : actions?.excludeBlockedReason ?? null;
  const blockedNoteId = blockedReason === null ? null : `${generatedId}-exclude-blocked`;
  const check = copy.evidenceChecks(evidenceChecks);
  const parts = [
    ...geoKbSourceParts(source, copy),
    ...(observedAt === null ? [] : [geoKbFormatDate(observedAt, locale)]),
    ...(nextReviewAt === null ? [] : [copy.item.review(geoKbFormatDate(nextReviewAt, locale))]),
    ...(corrected && ownerDeclaredAt !== null ? [copy.item.correctedAt(geoKbFormatDate(ownerDeclaredAt, locale))] : []),
    ...(check === null ? [] : [check]),
  ];
  const prior = priorSource === null ? [] : [
    copy.item.priorBasis,
    ...geoKbSourceParts(priorSource, copy),
    ...(priorObservedAt === null ? [] : [geoKbFormatDate(priorObservedAt, locale)]),
  ];
  return <article
    data-geo-kb-item=""
    data-decision={decision}
    data-origin={source.origin}
    className="min-w-0 rounded-[10px] border border-brand-border-card bg-brand-bg p-4 sm:p-5"
  >
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-5 gap-y-3">
      <div className="min-w-0 flex-1 basis-64 space-y-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-2">
          <Chip data-item-type="">{typeLabel}</Chip>
          <div data-knowledge-copy="compact" className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text-dark-primary [overflow-wrap:anywhere]">{children}</div>
        </div>
        <div data-item-source="" className="min-w-0 text-[12px] leading-relaxed text-text-dark-secondary">
          <Meta parts={parts} />
        </div>
        {prior.length === 0 ? null : <div data-item-prior-source="" className="min-w-0 text-[12px] leading-relaxed text-text-dark-secondary">
          <Meta parts={prior} />
        </div>}
        {blockedReason === null ? null : <p
          id={blockedNoteId ?? undefined}
          data-item-note="exclude-blocked"
          className="min-w-0 text-[12px] leading-relaxed text-text-dark-secondary"
        >{blockedReason}</p>}
        {newObservation || conflict ? <div className="flex flex-wrap gap-2">
          {newObservation ? <Chip data-item-flag="new_observation">{copy.item.newObservation}</Chip> : null}
          {conflict ? <Chip data-item-flag="conflict">{copy.item.conflict}</Chip> : null}
        </div> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <Chip data-decision-chip="">{copy.decisions[decision]}</Chip>
        {actions === undefined ? null : <Actions actions={actions} decision={decision} corrected={corrected} copy={copy} blockedNoteId={blockedNoteId} />}
      </div>
    </div>
  </article>;
}
