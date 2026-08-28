// @input  -- sessionStorage-like access, the current time, and one ContentBrief
// @output -- the one-time, tab-scoped brief → draft handoff of contract §"页内交接"
// @pos    -- the only writer and the only reader of CONTENT_BRIEF_HANDOFF_KEY; the draft
//            page parses what this hands it with parseContentBriefHandoff, never trusts it

import {
  CONTENT_BRIEF_HANDOFF_KEY,
  CONTENT_BRIEF_HANDOFF_MAX_BYTES,
  CONTENT_BRIEF_HANDOFF_TTL_MS,
  type ContentBrief,
  type ContentBriefHandoff,
} from "@sf/public-tools/content-brief/contract";

import type { ToolHandoffStorage } from "./tool-handoff.ts";

/**
 * Separate from tool-handoff.ts on purpose: that key carries a fixed small
 * payload with an exact key set, and a whole brief does not fit its shape.
 * The link that follows this write must still use TOOL_HANDOFF_LINK_PROPS —
 * session storage only reaches a new tab that keeps an opener.
 */
export type ContentBriefHandoffWrite =
  | { readonly ok: true; readonly bytes: number }
  | { readonly ok: false; readonly reason: "too_large"; readonly bytes: number }
  | { readonly ok: false; readonly reason: "storage"; readonly bytes: number };

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
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
): ContentBriefHandoffWrite {
  const bytes = utf8Bytes(JSON.stringify(brief));
  if (!Number.isFinite(now) || bytes > CONTENT_BRIEF_HANDOFF_MAX_BYTES) {
    return { ok: false, reason: "too_large", bytes };
  }
  const handoff: ContentBriefHandoff = {
    version: 1,
    created_at: now,
    expires_at: now + CONTENT_BRIEF_HANDOFF_TTL_MS,
    brief,
  };
  try {
    storage.setItem(CONTENT_BRIEF_HANDOFF_KEY, JSON.stringify(handoff));
    return { ok: true, bytes };
  } catch {
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
