"use client";

import { useTranslations } from "next-intl";
import { stampArtifact } from "@/lib/workbench/mock/provenance";
import { formatLocalStamp } from "@/lib/workbench/mock/time";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import type {
  Artifact,
  ArtifactType,
  Engine,
  ModuleId,
} from "@/lib/workbench/types";

export interface ArtifactDraft {
  readonly module: ModuleId;
  readonly type: ArtifactType;
  readonly engine: Engine;
  readonly title: string;
  /** The builder's output, unstamped: builders produce bodies only (design §6.8). */
  readonly body: string;
  /** A bare file name for the download; the drawer forces the extension from `type`. */
  readonly filename?: string;
}

export interface PreparedArtifact {
  readonly artifact: Artifact;
  /**
   * The canonical text (Q23). Copy, export, "save to basket" and the AI wrapper
   * all use this exact string, so the four actions cannot disagree about what the
   * artifact says. A body over `ARTIFACT_CONTENT_MAX` is truncated by the reducer
   * on its way into the basket (types.ts); what is returned here is the whole
   * text the operator asked for.
   */
  readonly content: string;
  /** Puts it in the basket. Calling it twice saves once. */
  readonly save: () => void;
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
    const artifact: Artifact =
      draft.filename === undefined ? base : { ...base, filename: draft.filename };
    let saved = false;
    return {
      artifact,
      content,
      save: () => {
        if (saved) return;
        saved = true;
        dispatch({ type: "addArtifact", artifact });
      },
    };
  }

  return ready ? prepare : null;
}
