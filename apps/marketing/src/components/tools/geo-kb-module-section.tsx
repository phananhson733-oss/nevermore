"use client";
// @input  -- one knowledge module's tri-state, and the group it was collected in
// @output -- available / partial(limitation) / unavailable(reason), and empty groups said out loud
// @pos    -- presentation only; it decides nothing about the module it draws
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * Two absences that used to look identical.
 *
 * The v1 renderer skipped an evidence group whose array was empty, and two of
 * those arrays were hard-coded empty upstream. A reader therefore could not
 * tell "we looked for press coverage and found none" from "we never looked",
 * and the second one silently rendered as the first. The pack contract now
 * carries `collected`, so this component states which of the two happened and
 * never omits a group.
 */
import { type ReactNode } from "react";

import type { GeoLimitationClause } from "../../lib/geo-tools/kb-knowledge-limitation.ts";
import type { GeoUnavailableReason } from "../../lib/geo-tools/kb-knowledge-shape.ts";
import { GeoKbSection } from "./geo-kb-section.tsx";
import { useGeoKbCopy, type GeoKbCopy } from "./geo-kb-copy.ts";

export type GeoKbHeading = 2 | 3 | 4;

/** The module tri-state, without the value it wraps. */
export type GeoKbModuleState =
  | { readonly status: "available" }
  | { readonly status: "partial"; readonly limitation: string; readonly limitationKeys?: readonly GeoLimitationClause[] }
  | { readonly status: "unavailable"; readonly reason: GeoUnavailableReason };

/** The shape every knowledge module has, in both the draft and the pack. */
export type GeoKbModuleLike<T> =
  | { readonly status: "available"; readonly value: T }
  | { readonly status: "partial"; readonly limitation: string; readonly limitationKeys?: readonly GeoLimitationClause[]; readonly value: T }
  | { readonly status: "unavailable"; readonly reason: GeoUnavailableReason };

/**
 * Drop the value and keep the state. Written as an exhaustive branch rather
 * than optional-field reads with a default: a default reason would invent an
 * explanation for a module that never said why it was unavailable.
 */
export function geoKbModuleState<T>(module: GeoKbModuleLike<T>): GeoKbModuleState {
  if (module.status === "unavailable") return { status: "unavailable", reason: module.reason };
  if (module.status === "partial") {
    return module.limitationKeys === undefined
      ? { status: "partial", limitation: module.limitation }
      : { status: "partial", limitation: module.limitation, limitationKeys: module.limitationKeys };
  }
  return { status: "available" };
}

/** The value a module carries, or null when it carries none. */
export function geoKbModuleValue<T>(module: GeoKbModuleLike<T>): T | null {
  return module.status === "unavailable" ? null : module.value;
}

/**
 * What a `partial` module says, in the reader's language where it can be.
 *
 * A payload published before 2026-09-10 carries only the server's English
 * sentence, and a payload written by a build newer than this one may carry a
 * clause key this build has never heard of. Both render the stored sentence:
 * it is the one thing that is always complete. `data-module-limitation` says
 * which of the two happened, so a test can tell a localized limitation from an
 * English one that merely happens to be short.
 */
function ModuleLimitation({ state, copy }: {
  readonly state: Extract<GeoKbModuleState, { status: "partial" }>;
  readonly copy: GeoKbCopy;
}) {
  const localized = state.limitationKeys === undefined ? null : copy.module.limitation(state.limitationKeys);
  return <Note data-module-limitation={localized === null ? "stored" : "localized"}>
    <span className="font-medium text-text-dark-primary">{copy.module.partial}:</span> {localized ?? state.limitation}
  </Note>;
}

function Note({ children, ...rest }: { readonly children: ReactNode } & Record<`data-${string}`, string | undefined>) {
  return <div
    {...rest}
    data-knowledge-copy="compact"
    className="min-w-0 whitespace-pre-wrap break-words rounded-[10px] border border-brand-border-card bg-brand-bg px-4 py-3 text-[13px] leading-relaxed text-text-dark-secondary [overflow-wrap:anywhere]"
  >{children}</div>;
}

/**
 * How one surface asks a module to be drawn. The module's STATE is the same on
 * every surface; these decide only how much of it is said, and where.
 *
 * The review card sets all three. The published pack sets none: a customer
 * reading one section has no rows to fall back on for the limitation, and the
 * frozen view is contractually free of disclosure widgets.
 */
export interface GeoKbModulePresentation {
  /** Fold the module to its header strip, closed until opened. */
  readonly collapsible?: boolean;
  /**
   * Draw a `partial` module's limitation sentence. Off on the review card,
   * where every absence the sentence would name is already said on the rows
   * beneath it and the Owner read it as one more line to skip (2026-09-11).
   */
  readonly limitation?: boolean;
  /**
   * The caller's own sentence for an `unavailable` module, replacing the
   * generic one for its reason. A sentence rather than a reason code: only
   * the caller knows what `not_applicable` means for the module it is drawing.
   */
  readonly unavailableNote?: string;
}

/**
 * One knowledge module drawn in the shared section card.
 *
 * `action` is where a module-level gesture goes -- "accept all" belongs beside
 * the module it accepts, not in a toolbar that has lost track of which module
 * it is pointing at.
 */
export function GeoKbModuleSection({
  title,
  heading = 3,
  state,
  action,
  collapsible = false,
  limitation = true,
  unavailableNote,
  children,
}: GeoKbModulePresentation & {
  readonly title: string;
  readonly heading?: GeoKbHeading;
  readonly state: GeoKbModuleState;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  const copy = useGeoKbCopy();
  return <GeoKbSection title={title} heading={heading} collapsible={collapsible}>
    <div data-geo-kb-module="" data-module-status={state.status} className="min-w-0 space-y-4">
      {state.status === "unavailable"
        ? <Note data-module-unavailable="">{unavailableNote ?? copy.module.unavailable(state.reason)}</Note>
        : <>
          {state.status === "partial" && limitation ? <ModuleLimitation state={state} copy={copy} /> : null}
          {action === undefined ? null : <div className="flex flex-wrap justify-end gap-2">{action}</div>}
          {children}
        </>}
    </div>
  </GeoKbSection>;
}

/**
 * One evidence group, always drawn.
 *
 * `collected` is the group's own record of whether it was looked for. An
 * uncollected group says so; a collected one that found nothing says that
 * instead. Neither is allowed to disappear, because a missing heading reads as
 * a complete report.
 */
export function GeoKbEvidenceGroup({
  title,
  heading = 3,
  collected,
  count,
  children,
}: {
  readonly title: string;
  readonly heading?: GeoKbHeading;
  readonly collected: boolean;
  readonly count: number;
  readonly children: ReactNode;
}) {
  const copy = useGeoKbCopy();
  const Tag = (heading === 2 ? "h3" : heading === 3 ? "h4" : "h5") as "h3" | "h4" | "h5";
  const state = !collected ? "not_collected" : count === 0 ? "collected_empty" : "available";
  return <section data-geo-kb-group="" data-group-state={state} className="min-w-0 space-y-3">
    <Tag className="min-w-0 break-words text-[15px] font-semibold leading-relaxed [overflow-wrap:anywhere]">{title}</Tag>
    {state === "not_collected" ? <Note data-group-note="">{copy.groups.notCollected}</Note> : null}
    {state === "collected_empty" ? <Note data-group-note="">{copy.groups.collectedEmpty}</Note> : null}
    {state === "available" ? children : null}
  </section>;
}
