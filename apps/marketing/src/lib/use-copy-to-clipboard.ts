// @input  -- a caller-chosen key and the exact text that key should copy
// @output -- copy status scoped to one key, plus the same text to reveal on denial
// @pos    -- shared browser clipboard mechanism; owns no copy text of its own

"use client";

import { useState } from "react";

export type CopyStatus = "idle" | "done" | "failed";

export interface CopyToClipboard {
  readonly status: CopyStatus;
  /**
   * Which caller-supplied key the current status belongs to.
   *
   * Surfaces with several copy buttons share one hook, and a status that did
   * not say which button it came from would report success on all of them.
   */
  readonly copiedKey: string | null;
  /** The exact text that failed to copy, for the reader to select by hand. */
  readonly fallbackText: string | null;
  readonly copy: (key: string, text: string) => Promise<void>;
}

/**
 * Copy text, and stay honest when the browser says no.
 *
 * Browsers deny the clipboard in plenty of ordinary situations — an insecure
 * origin, a missing user gesture, a permission policy. The denial is not an
 * error to report; the text goes back to the caller so it can be put on the
 * page, which keeps "select this and copy it" a true instruction.
 */
export function useCopyToClipboard(): CopyToClipboard {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [fallbackText, setFallbackText] = useState<string | null>(null);

  async function copy(key: string, text: string): Promise<void> {
    setCopiedKey(key);
    try {
      await navigator.clipboard.writeText(text);
      setStatus("done");
      setFallbackText(null);
    } catch {
      setStatus("failed");
      setFallbackText(text);
    }
  }

  return { status, copiedKey, fallbackText, copy };
}
