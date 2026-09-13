"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { DEMO_LEVEL, DEMO_SEEDS } from "@/lib/workbench/mock/demo-constants";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import { hasDemoOverwrite } from "@/lib/workbench/store/selectors";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { BUTTON_PRIMARY } from "../../ui/panel.ts";

/**
 * "Load sample site" (design §6.7): one `loadDemo` that overwrites seventeen
 * fields of this project with `makeDemoSite`'s payload.
 *
 * - `mock/demo.ts` is reached ONLY through the `await import` below (Q13): it
 *   pulls in every artifact builder and the audit rule library. The constants
 *   come from `demo-constants.ts`, which imports nothing; importing them from
 *   `demo.ts` would undo the split. `overview-import-graph.test.ts` walks this
 *   file's static imports until T16 extends the store gate to components.
 * - The confirmation is asked only when `hasDemoOverwrite` says, BY VALUE, that
 *   something would be lost (Q11); a blank project loads straight away.
 * - The provenance line injected into `DemoDeps` is `workbench.provenance.artifact`
 *   formatted with the artifact's own stamp — the expression `useAddArtifact`
 *   stamps the operator's artifacts with, so the sample basket and the
 *   operator's basket carry one wording (Step 3b). `mock/provenance.ts` has no
 *   function that produces that line; the sweep in `provenance.fs.test.ts`
 *   checks the name `stampArtifact`, not the words, so the behavioural test in
 *   `LoadDemoButton.provenance.test.tsx` is what holds the two together.
 * - One load per intent: a ref, not state, is the gate, because two clicks in
 *   one event loop turn both run against the same render. The clock is read
 *   in the handler, which is the moment the sample is made.
 * - A failed load (a chunk that did not download, a builder that threw — one
 *   `catch` cannot tell them apart) says so without naming a cause and leaves
 *   the button usable.
 *
 * 一旦本文件被更新，务必更新开头注释
 */
export function LoadDemoButton() {
  const { state, dispatch } = useWorkbench();
  const t = useTranslations("workbench.overview.loadDemo");
  const tProvenance = useTranslations("workbench.provenance");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  async function load(): Promise<void> {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const { makeDemoSite } = await import("@/lib/workbench/mock/demo.ts");
      const payload = makeDemoSite(state.profile, DEMO_LEVEL, [...DEMO_SEEDS], {
        now: new Date(),
        provenanceLine: (at: string) => tProvenance("artifact", { at }),
      });
      dispatch({ type: "loadDemo", payload });
    } catch {
      setFailed(true);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function start(): void {
    if (pending.current) return;
    if (hasDemoOverwrite(state)) {
      setConfirming(true);
      return;
    }
    void load();
  }

  function confirm(): void {
    // ConfirmDialog never closes itself; an open box keeps #wb-app inert.
    setConfirming(false);
    void load();
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        ref={buttonRef}
        type="button"
        onClick={start}
        disabled={busy}
        aria-busy={busy}
        className={BUTTON_PRIMARY}
      >
        {busy ? t("busy") : t("button")}
      </button>
      {failed ? (
        <p role="alert" className="text-sm text-slate-700">
          {t("failed")}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={confirm}
        title={t("confirmTitle")}
        body={t("confirmBody")}
        confirmLabel={t("confirmOk")}
        cancelLabel={t("cancel")}
        returnFocusTo={buttonRef}
      />
    </div>
  );
}
