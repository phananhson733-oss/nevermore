"use client";

import { useTranslations } from "next-intl";
import {
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
  /** A bare file name for the download; the drawer forces the extension from `type`. */
  readonly filename?: string;
}

/** What `save()` did: stored the text (now or on an earlier call), or refused it as too large. */
export type SaveResult = "saved" | "tooLarge";

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
   * Puts it in the basket and says whether it did. Over `ARTIFACT_CONTENT_MAX`
   * UTF-16 units it dispatches nothing and returns `"tooLarge"` (Q37): the
   * reducer would otherwise cut the text short on its way in, and the basket
   * would hold a different text from the one just copied or exported, under a
   * row that said "saved". Within the limit, calling it twice saves once and
   * both calls return `"saved"`.
   */
  readonly save: () => SaveResult;
}

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
  const { dispatch, ready } = useWorkbench();
  const tProvenance = useTranslations("workbench.provenance");

  // Not memoised on purpose: it reads no state, and a `useCallback` would need
  // `tProvenance` in its dependency list — a wrong list there is how a handler
  // ends up stamping with a translation from the render before last.
  function prepare(draft: ArtifactDraft): PreparedArtifact {
    const at = formatLocalStamp(new Date());
    const content = stampArtifact(
      draft.type,
      draft.body,
      tProvenance("artifact", { at }),
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
    let saved = false;
    return Object.freeze({
      artifact,
      content,
      save: (): SaveResult => {
        if (tooLarge) return "tooLarge";
        if (!saved) {
          saved = true;
          dispatch({ type: "addArtifact", artifact });
        }
        return "saved";
      },
    });
  }

  return ready ? prepare : null;
}
