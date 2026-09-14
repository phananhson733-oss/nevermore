"use client";

import { useEffect, useRef, useState } from "react";
import { GSC_IMPORT_MAX_BYTES, importGsc, type GscImport } from "@/lib/workbench/mock/gsc-import";
import { useWorkbench } from "@/lib/workbench/store/hooks";

/**
 * The import pane's one write: text (pasted, or read from a file) through
 * `importGsc` into `setGscRows(rows, "user")`, and the outcome the pane shows.
 *
 * - A parse that finds no row dispatches NOTHING. Replacing the saved rows with
 *   an empty list would be the clear, without the clear's confirmation; the
 *   notice says the saved rows were left unchanged instead.
 * - A file over `GSC_IMPORT_MAX_BYTES` is not read at all (Q8). A read that
 *   fails says so without a cause: the one `catch` around `file.text()` cannot
 *   tell encoding from permission from disk (Q4).
 * - Latest intent wins. Each import takes a new number; a file read that
 *   settles after a newer import, after a rendered some-to-none of the saved
 *   rows (below), or after unmount writes nothing and shows nothing. Without it
 *   a slow file would put its rows back over a paste or a confirmed clear.
 * - The result follows the saved rows (codex S6r4). When a render shows them
 *   gone from some to none — a confirmed clear, or any other write, another
 *   tab's included — the last result is dropped: it described rows that are
 *   gone. The transition is read from the store during render rather than
 *   reported by the clear button, and it bumps a state counter, not the import
 *   ref, to keep render free of ref increments. Rows replaced by rows keep the
 *   result.
 * - Only a some-to-none that renders is counted (codex S10r2, P3 residual). The
 *   comparison is between two renders, so a clear no render shows — folded into
 *   one batch with the writes around it, leaving rows on both sides or none on
 *   both — is not counted: the result stays, and a file read in flight still
 *   writes, which is the import's stated replace of the rows saved now. Clears
 *   in this tab run in `flushSync` and always render; only consecutive
 *   cross-tab storage events can batch that way, the accepted cross-tab
 *   last-write-wins residual (PR-4).
 *
 * Replacing non-empty rows is not confirmed: the plan asks for a confirmation
 * on clear only, and the pane says before the click that a parse which finds
 * rows replaces the saved ones (`import.replaceNote`).
 *
 * 一旦本文件被更新，务必更新开头注释
 */

export type ImportNotice =
  | { readonly kind: "result"; readonly result: GscImport }
  | { readonly kind: "tooLarge" }
  | { readonly kind: "readFailed" };

export interface GscImportControls {
  readonly notice: ImportNotice | null;
  readonly importText: (text: string) => void;
  readonly importFile: (file: File) => Promise<void>;
}

export function useGscImport(): GscImportControls {
  const { state, dispatch } = useWorkbench();
  const [notice, setNotice] = useState<ImportNotice | null>(null);
  const hasRows = state.gscRows.length > 0;
  const [hadRows, setHadRows] = useState(hasRows);
  const [emptied, setEmptied] = useState(0);
  if (hadRows !== hasRows) {
    setHadRows(hasRows);
    if (!hasRows) {
      setEmptied((times) => times + 1);
      setNotice(null);
    }
  }
  // The latest render's count, read when a file read settles.
  const emptiedRef = useRef(emptied);
  emptiedRef.current = emptied;
  const latest = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function begin(): number {
    latest.current += 1;
    return latest.current;
  }

  function apply(text: string): void {
    const result = importGsc(text);
    if (result.rows.length > 0) dispatch({ type: "setGscRows", rows: result.rows, source: "user" });
    setNotice({ kind: "result", result });
  }

  function importText(text: string): void {
    begin();
    apply(text);
  }

  async function importFile(file: File): Promise<void> {
    const run = begin();
    const emptiedAtStart = emptiedRef.current;
    if (file.size > GSC_IMPORT_MAX_BYTES) {
      setNotice({ kind: "tooLarge" });
      return;
    }
    const text = await file.text().then(
      (value) => value,
      () => null,
    );
    if (!alive.current || latest.current !== run || emptiedRef.current !== emptiedAtStart) return;
    if (text === null) {
      setNotice({ kind: "readFailed" });
      return;
    }
    apply(text);
  }

  return { notice, importText, importFile };
}
