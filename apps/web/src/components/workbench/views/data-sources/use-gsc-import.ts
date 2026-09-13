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
 * - Latest intent wins. Each import, and `forget` (called when the rows are
 *   cleared), takes a new number; a file read that settles after a newer import,
 *   after a clear, or after unmount writes nothing and shows nothing. Without it
 *   a slow file would put its rows back over a paste or a confirmed clear.
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
  /** Drops the notice and abandons any file read still in flight. */
  readonly forget: () => void;
}

export function useGscImport(): GscImportControls {
  const { dispatch } = useWorkbench();
  const [notice, setNotice] = useState<ImportNotice | null>(null);
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
    if (file.size > GSC_IMPORT_MAX_BYTES) {
      setNotice({ kind: "tooLarge" });
      return;
    }
    const text = await file.text().then(
      (value) => value,
      () => null,
    );
    if (!alive.current || latest.current !== run) return;
    if (text === null) {
      setNotice({ kind: "readFailed" });
      return;
    }
    apply(text);
  }

  function forget(): void {
    begin();
    setNotice(null);
  }

  return { notice, importText, importFile, forget };
}
