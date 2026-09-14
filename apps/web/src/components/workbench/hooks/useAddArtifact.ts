"use client";

import { useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { useTranslations } from "next-intl";
import {
  type ArtifactGscData,
  stampArtifact,
  type StampedText,
  type UnstampedBody,
} from "@/lib/workbench/mock/provenance";
import { formatLocalStamp } from "@/lib/workbench/mock/time";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import {
  ARTIFACT_CONTENT_MAX,
  type Artifact,
  type ArtifactType,
  type Engine,
  type ModuleId,
} from "@/lib/workbench/types";

export interface ArtifactDraft {
  readonly module: ModuleId;
  readonly type: ArtifactType;
  readonly engine: Engine;
  readonly title: string;
  /**
   * The builder's output, unstamped: builders produce bodies only (design §6.8).
   * Any plain string fits. `prepared.content` or `prepared.artifact.content`
   * passed back exactly as they are does NOT (S2 #2): that would stamp the text
   * twice, and it is a compile error. Only that direct hand-back is caught — a
   * template literal, `.trim()`, `.slice()` or a detour through a `string`
   * variable drops the brand and compiles (see `UnstampedBody`).
   */
  readonly body: UnstampedBody;
  /**
   * Where the GSC data the body shows came from (Q36); it picks the provenance
   * declaration stamped above the body. Required, with no default: a producer
   * that left it out would ship the operator's own rows under "sample data".
   * `none` when the body shows no GSC-derived data at all.
   */
  readonly gscData: ArtifactGscData;
  /** A bare file name for the download; the drawer forces the extension from `type`. */
  readonly filename?: string;
}

/**
 * What `save()` answers: the text is in the basket after the call (put there
 * now, or still there from an earlier call), it was refused as too large to
 * store whole (nothing dispatched), or the basket was full and did not take it.
 */
export type SaveResult = "saved" | "tooLarge" | "full";

/**
 * An artifact whose `content` carries the stamp brand, so that field handed
 * straight back to `prepare` is refused the same way `prepared.content` is. The
 * same limit applies: any string operation on it, or reading it back out of the
 * basket, yields a plain `string` that compiles.
 */
export type StampedArtifact = Artifact & { readonly content: StampedText };

/**
 * Frozen, and so is `artifact` (S2 #3). `readonly` and `as const` vanish at
 * runtime; without the freeze, `Object.assign(prepared.artifact, { content })`
 * would make `save()` put text in the basket that copy and export never saw.
 */
export interface PreparedArtifact {
  readonly artifact: StampedArtifact;
  /**
   * The canonical text (Q23), whole. Copy and export hand out exactly this
   * string, "copy for an AI" wraps exactly this string, and `save()` stores
   * exactly this string or nothing at all — nothing on this object is ever a
   * shortened copy. (That the AI block carries it byte for byte is
   * `stampArtifact`'s canonical shape, not something this field guarantees.)
   */
  readonly content: StampedText;
  /**
   * Puts it in the basket and says whether it is there. Over
   * `ARTIFACT_CONTENT_MAX` UTF-16 units it dispatches nothing and returns
   * `"tooLarge"` (Q37): the reducer would otherwise cut the text short on its
   * way in, and the basket would hold a different text from the one just copied
   * or exported, under a row that said "saved". With `ARTIFACT_LIMIT` artifacts
   * already in the basket and this one not among them it returns `"full"`:
   * nothing is stored, and nothing is evicted to make room. Otherwise it returns
   * `"saved"`.
   *
   * Nothing is remembered between calls; the basket is the only record. Called
   * again while this artifact is still in the basket, it stores nothing new (the
   * reducer ignores an id it already holds) and returns `"saved"`. Called after
   * the artifact was removed or the basket cleared, it stores it again. A call
   * refused as `"full"` saves once there is room; `"tooLarge"` never does.
   *
   * Call it from an event handler while the component that called
   * `useAddArtifact` is still mounted. The answer is read back from the basket
   * as that component last committed it, and is only right under those two
   * conditions. In particular, while that component sits in a Suspense boundary
   * showing its fallback, or is unmounting, the answer can be `"full"` for an
   * artifact that did go in; a retry is then harmless, because the reducer will
   * not add a second copy of the same id.
   */
  readonly save: () => SaveResult;
}

/**
 * The declaration each GSC source is stamped with (Q36). `none` and `sample`
 * share the sample sentence: with no GSC data, or only the sample's, everything
 * in the artifact is a local demonstration. The other two name where the rows
 * came from and still say the rest is not a measurement (in PR-3, audit and
 * visibility results are always local simulations).
 */
const PROVENANCE_KEY = {
  none: "artifact",
  sample: "artifact",
  user: "artifactWithUserGsc",
  unknown: "artifactWithUnknownGsc",
} as const satisfies Readonly<Record<ArtifactGscData, string>>;

/**
 * The one place an artifact is stamped (Q23, R5): `stampArtifact` folds the
 * localised §6.8 provenance line into the body, and the same text is what every
 * action hands out. Builders never stamp, and no view may call `stampArtifact`
 * itself — two stamping sites are two wordings, and the wrong one is a claim
 * about measurement that is not true.
 *
 * The clock is read when the operator clicks, not during render: this runs in an
 * event handler, so there is no SSR/CSR mismatch to avoid here (that is what
 * `useNowStamp` is for), and the stamp is the time the artifact was made.
 *
 * `null` until the project is hydrated, the same shape as `useNowStamp` (Q22), so
 * the caller renders a skeleton instead of an action it cannot honour. Not
 * defensive programming: before `ready` a `save()` is discarded twice over. The
 * provider's persistence effect returns early while `ready` is false, so nothing
 * reaches storage, and the `loadPersisted` that hydration dispatches replaces the
 * state by identity rather than merging into it (`reducer.ts`), so the artifact in
 * memory goes too. The basket would be empty under a row that just said "saved".
 */
export function useAddArtifact():
  | ((draft: ArtifactDraft) => PreparedArtifact)
  | null {
  const { dispatch, ready, state } = useWorkbench();
  const tProvenance = useTranslations("workbench.provenance");
  // The basket as last COMMITTED, so `save()` can read its own outcome back.
  // Not `state.artifacts` captured at render or at `prepare()`: a view keeps a
  // prepared artifact across renders, and two saves in one tick (a double
  // click, or two views) would each see the count from before the other's.
  const committedArtifacts = useRef(state.artifacts);
  useLayoutEffect(() => {
    committedArtifacts.current = state.artifacts;
  }, [state.artifacts]);

  // Not memoised on purpose: it reads no state, and a `useCallback` would need
  // `tProvenance` in its dependency list — a wrong list there is how a handler
  // ends up stamping with a translation from the render before last.
  function prepare(draft: ArtifactDraft): PreparedArtifact {
    const at = formatLocalStamp(new Date());
    const content = stampArtifact(
      draft.type,
      draft.body,
      tProvenance(PROVENANCE_KEY[draft.gscData], { at }),
    );
    const base = {
      id: crypto.randomUUID(),
      at,
      module: draft.module,
      type: draft.type,
      engine: draft.engine,
      title: draft.title,
      content,
    } as const;
    // Both layers frozen (S2 #3): `save()` dispatches this exact snapshot, and a
    // caller can neither rewrite its `content` nor swap the object it points at.
    const artifact: StampedArtifact = Object.freeze(
      draft.filename === undefined ? base : { ...base, filename: draft.filename },
    );
    // Counted in UTF-16 units, the unit `boundArtifact` truncates by (reducer.ts),
    // and measured once: the text cannot change after this point. The reducer's
    // truncation stays as the last defence; this check keeps it from ever firing
    // on a text the operator was just shown whole.
    const tooLarge = content.length > ARTIFACT_CONTENT_MAX;
    return Object.freeze({
      artifact,
      content,
      save: (): SaveResult => {
        if (tooLarge) return "tooLarge";
        // Always written first, then read back; never answered from the basket
        // as it stood before this call. Asked beforehand, "already in?" and
        // "full?" both read the last commit, which misses a dispatch the same
        // handler queued just before (a removal, another save) and answers for a
        // basket about to change. Writing an id the basket already holds is safe:
        // the reducer, the one judge of both questions, hands back the same state.
        //
        // In a normal commit `flushSync` runs this hook's layout effect before
        // returning, so the committed basket says whether this artifact is in —
        // judged at write time, after every earlier save. Not under a Suspense
        // fallback or during unmount; see `PreparedArtifact.save`.
        flushSync(() => dispatch({ type: "addArtifact", artifact }));
        return committedArtifacts.current.some((entry) => entry.id === artifact.id)
          ? "saved"
          : "full";
      },
    });
  }

  return ready ? prepare : null;
}
