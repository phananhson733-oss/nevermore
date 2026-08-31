// @input  -- sessionStorage-like access, the current time, and one ContentBrief
// @output -- the one-time, tab-scoped brief → draft handoff of contract §"页内交接"
// @pos    -- the only writer and the only reader of CONTENT_BRIEF_HANDOFF_KEY; the draft
//            page parses what this hands it with parseContentBriefHandoff, never trusts it

import {
  CONTENT_BRIEF_HANDOFF_KEY,
  CONTENT_BRIEF_HANDOFF_MAX_BYTES,
  CONTENT_BRIEF_HANDOFF_TTL_MS,
} from "@sf/public-tools/content-brief/contract";
import type { SharedContentBrief as ContentBrief, SharedContentBriefHandoff as ContentBriefHandoff } from "@sf/public-tools/content-brief/geo-contract";

import type { ToolHandoffStorage } from "./tool-handoff.ts";

/**
 * Separate from tool-handoff.ts on purpose: that key carries a fixed small
 * payload with an exact key set, and a whole brief does not fit its shape.
 * The link that follows this write must still use TOOL_HANDOFF_LINK_PROPS —
 * session storage only reaches a new tab that keeps an opener.
 */
export type ContentBriefHandoffWrite =
  | { readonly ok: true; readonly bytes: number; readonly raw: string }
  | { readonly ok: false; readonly reason: "too_large"; readonly bytes: number }
  | { readonly ok: false; readonly reason: "storage"; readonly bytes: number };

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

export interface WriteContentBriefHandoffOptions {
  /**
   * An envelope the caller wrote earlier and still wants if this write fails.
   * A failed write clears whatever is stored UNLESS it is character for
   * character this value: a fresh write that fails must not delete the
   * still-valid envelope it was only refreshing.
   */
  readonly preserve?: string | null;
}

/** A failed write must not leave an older, foreign brief behind for the next tab to pick up. */
function clearStale(storage: ToolHandoffStorage, preserve: string | null | undefined): void {
  try {
    if (preserve != null && storage.getItem(CONTENT_BRIEF_HANDOFF_KEY) === preserve) return;
    storage.removeItem(CONTENT_BRIEF_HANDOFF_KEY);
  } catch {
    // Best effort: a store that refuses removal is the same store that just
    // refused the write, and the caller already reports that.
  }
}

/**
 * The size check is on the brief alone, because that is the bound the draft
 * parser enforces (handoff §5.1: "brief 本身 ≤ CONTENT_BRIEF_HANDOFF_MAX_BYTES").
 * The envelope's three numbers add a few dozen bytes the parser does not count.
 */
export function writeContentBriefHandoff(
  storage: ToolHandoffStorage,
  now: number,
  brief: ContentBrief,
  options: WriteContentBriefHandoffOptions = {},
): ContentBriefHandoffWrite {
  const bytes = utf8Bytes(JSON.stringify(brief));
  if (!Number.isFinite(now) || bytes > CONTENT_BRIEF_HANDOFF_MAX_BYTES) {
    clearStale(storage, options.preserve);
    return { ok: false, reason: "too_large", bytes };
  }
  const handoff: ContentBriefHandoff = {
    version: 1,
    created_at: now,
    expires_at: now + CONTENT_BRIEF_HANDOFF_TTL_MS,
    brief,
  };
  const raw = JSON.stringify(handoff);
  try {
    storage.setItem(CONTENT_BRIEF_HANDOFF_KEY, raw);
    return { ok: true, bytes, raw };
  } catch {
    clearStale(storage, options.preserve);
    return { ok: false, reason: "storage", bytes };
  }
}

/**
 * Reads the raw handoff once and removes it in the same step, so a reload of
 * the draft page starts empty (handoff §8 item 32) and a second tab cannot
 * consume a brief the first one already took. Parsing is the caller's job:
 * the string is returned untouched so the exact parser sees exactly what was
 * stored.
 */
export function takeContentBriefHandoff(storage: ToolHandoffStorage): string | null {
  try {
    const raw = storage.getItem(CONTENT_BRIEF_HANDOFF_KEY);
    if (raw !== null) storage.removeItem(CONTENT_BRIEF_HANDOFF_KEY);
    return raw;
  } catch {
    return null;
  }
}

/**
 * The raw handoff waiting, without consuming it. For a visitor the server
 * already knows is signed out: the sign-in they are about to do reloads the
 * page, and a brief taken before that reload would be lost. Returned verbatim
 * so a later guarded clear can match it exactly.
 */
export function peekContentBriefHandoff(storage: ToolHandoffStorage): string | null {
  try {
    return storage.getItem(CONTENT_BRIEF_HANDOFF_KEY);
  } catch {
    return null;
  }
}

/**
 * Puts a consumed envelope back exactly as it was read, TTL and all.
 *
 * For one path only: a signed-out visitor whose sign-in will reload the page.
 * The reload would otherwise find the handoff already taken and open on the
 * empty state, looking like it lost the brief. The envelope is not rebuilt,
 * so the parser's window and fingerprint checks see the original.
 */
export function restoreContentBriefHandoff(storage: ToolHandoffStorage, raw: string): boolean {
  try {
    storage.setItem(CONTENT_BRIEF_HANDOFF_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Deletes the opener's copy of a handoff this tab consumed, but only while it
 * is still character for character the envelope that was consumed. A newer
 * brief the opener wrote for another tab is left alone.
 */
export function clearMatchingContentBriefHandoff(storage: ToolHandoffStorage, raw: string): boolean {
  try {
    if (storage.getItem(CONTENT_BRIEF_HANDOFF_KEY) !== raw) return false;
    storage.removeItem(CONTENT_BRIEF_HANDOFF_KEY);
    return true;
  } catch {
    return false;
  }
}
