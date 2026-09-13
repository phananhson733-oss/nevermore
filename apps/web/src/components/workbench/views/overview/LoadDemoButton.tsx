"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useTranslations } from "next-intl";
import { DEMO_LEVEL, DEMO_SEEDS } from "@/lib/workbench/mock/demo-constants";
import { demoFields, type DemoFields } from "@/lib/workbench/store/demo-fields";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import { hasDemoOverwrite } from "@/lib/workbench/store/selectors";
import type { DemoPayload } from "@/lib/workbench/types";
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
 *   after the import, which is the moment the sample is made.
 * - What is authorised is content, not a bare yes (codex S6r2 #1). The click on
 *   a project with nothing to lose, or the confirm on one with something, takes
 *   a `demoFields` snapshot of the render it happened in, and `loadDemo`
 *   carries it: the reducer loads only while those fields still hold the same
 *   content (`sameDemoFields`: the same reference, or equal once JSON-encoded,
 *   codex S6r3 #2). The dispatch comes after an `await import`, and the provider
 *   outlives this button (it sits in the project layout), so another tab's
 *   rows can land in between — rendered by then, or still queued behind the
 *   render the loader last saw, which no check in here can see.
 * - The loader does not guess which; it asks the store. The dispatch runs in
 *   `flushSync`, which renders it together with the updates queued ahead of it
 *   in the sync lanes (Sync, InputContinuous, Default), which is every store
 *   write the workbench makes today, so `stateRef` is current afterwards, and
 *   "the sample's rows array is in the store" is whether the reducer took it.
 *   A write queued in a Transition would be skipped by that render and replayed
 *   after the read-back, undoing its answer (codex S6r3 #3), so no store write
 *   may be wrapped in one (`lib/workbench/no-transition-store-writes.test.ts`
 *   is the gate). Refused → judged again on what
 *   is there now: something to lose opens the confirmation (a confirmed load
 *   asks again rather than spend the old yes on new content); nothing to lose
 *   loads against a fresh snapshot, and a second refusal says the load did not
 *   go through. Unmounted before the import settles → abandon, with no
 *   dispatch and no state update. `LoadDemoButton.stale.test.tsx` runs these
 *   against the real provider.
 * - The confirmation closes by itself once nothing is left to overwrite (the
 *   operator emptied the field, another tab cleared it): a box over a blank
 *   project would ask about nothing. Reset during render, so no frame commits
 *   it open.
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
  // The latest render's state: read after `await import`, and after each
  // `flushSync` to see what the reducer did with the dispatch.
  const stateRef = useRef(state);
  stateRef.current = state;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  if (confirming && !hasDemoOverwrite(state)) setConfirming(false);

  /** Dispatches `payload` authorised against `expected`; true when the reducer took it. */
  function commit(payload: DemoPayload, expected: DemoFields): boolean {
    flushSync(() => dispatch({ type: "loadDemo", payload, expected }));
    // `loadDemo` stores the payload's rows array as is, so only a load that
    // landed puts this very array in the store.
    return stateRef.current.gscRows === payload.gscRows;
  }

  async function load(expected: DemoFields): Promise<void> {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const { makeDemoSite } = await import("@/lib/workbench/mock/demo.ts");
      if (!alive.current) return;
      const sample = (): DemoPayload =>
        makeDemoSite(stateRef.current.profile, DEMO_LEVEL, [...DEMO_SEEDS], {
          now: new Date(),
          provenanceLine: (at: string) => tProvenance("artifact", { at }),
        });
      if (commit(sample(), expected)) return;
      // Refused (header): the project is no longer what was authorised.
      const latest = stateRef.current;
      if (hasDemoOverwrite(latest)) {
        setConfirming(true);
        return;
      }
      if (!commit(sample(), demoFields(latest))) setFailed(true);
    } catch {
      if (alive.current) setFailed(true);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }

  function start(): void {
    if (pending.current) return;
    if (hasDemoOverwrite(state)) {
      setConfirming(true);
      return;
    }
    // Nothing to lose in the render that was clicked: that is what the load covers.
    void load(demoFields(state));
  }

  function confirm(): void {
    // ConfirmDialog never closes itself; an open box keeps #wb-app inert.
    setConfirming(false);
    // The yes covers what this render shows, not what is there once the import is back.
    void load(demoFields(state));
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
