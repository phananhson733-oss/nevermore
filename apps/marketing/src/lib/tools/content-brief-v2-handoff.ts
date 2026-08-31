// @input -- an already validated confirmed revision and private tab storage
// @output -- a v2 envelope on the existing one-time Brief handoff channel
// @pos -- explicit payload versioning without a second stale storage slot or URL data
import { CONTENT_BRIEF_HANDOFF_KEY, CONTENT_BRIEF_HANDOFF_TTL_MS } from "@sf/public-tools/content-brief/contract";
import { CONFIRMED_BRIEF_V2_MAX_BYTES, parseConfirmedBriefV2 } from "@sf/public-tools/content-brief/v2-brief";
import type { ConfirmedBriefV2 } from "@sf/public-tools/content-brief/v2-generation-contract";
import type { ContentBriefHandoffWrite, WriteContentBriefHandoffOptions } from "./content-brief-handoff.ts";
import type { ToolHandoffStorage } from "./tool-handoff.ts";

type Parsed = Awaited<ReturnType<typeof parseConfirmedBriefV2>>;
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
function clearStale(storage: ToolHandoffStorage, preserve: string | null | undefined): void {
  try {
    if (preserve != null && storage.getItem(CONTENT_BRIEF_HANDOFF_KEY) === preserve) return;
    storage.removeItem(CONTENT_BRIEF_HANDOFF_KEY);
  } catch { /* The failed write is already reported; cleanup is best effort. */ }
}

/** The historical key names the private channel; envelope.version names the payload contract. */
export function writeConfirmedBriefHandoff(
  storage: ToolHandoffStorage, now: number, confirmed: ConfirmedBriefV2, options: WriteContentBriefHandoffOptions = {},
): ContentBriefHandoffWrite {
  let encoded: string;
  try { encoded = JSON.stringify(confirmed); } catch {
    clearStale(storage, options.preserve);
    return { ok: false, reason: "storage", bytes: 0 };
  }
  const size = bytes(encoded);
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + CONTENT_BRIEF_HANDOFF_TTL_MS) || size > CONFIRMED_BRIEF_V2_MAX_BYTES) {
    clearStale(storage, options.preserve);
    return { ok: false, reason: "too_large", bytes: size };
  }
  const raw = JSON.stringify({ version: 2, created_at: now, expires_at: now + CONTENT_BRIEF_HANDOFF_TTL_MS, brief: confirmed });
  try {
    storage.setItem(CONTENT_BRIEF_HANDOFF_KEY, raw);
    return { ok: true, bytes: size, raw };
  } catch {
    clearStale(storage, options.preserve);
    return { ok: false, reason: "storage", bytes: size };
  }
}

export async function parseConfirmedBriefHandoff(input: unknown, now = Date.now()): Promise<Parsed> {
  try { if (bytes(JSON.stringify(input)) > CONFIRMED_BRIEF_V2_MAX_BYTES + 1024) return { ok: false, code: "invalid_request", path: "handoff.bytes" }; }
  catch { return { ok: false, code: "invalid_request", path: "handoff" }; }
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, code: "invalid_request", path: "handoff" };
  const value = input as Record<string, unknown>;
  const keys = ["version", "created_at", "expires_at", "brief"];
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) return { ok: false, code: "invalid_request", path: "handoff" };
  if (value.version !== 2) return { ok: false, code: "brief_schema_mismatch", path: "version" };
  const created = value.created_at;
  const expires = value.expires_at;
  if (typeof created !== "number" || !Number.isSafeInteger(created) || created < 0 || !Number.isSafeInteger(now) || created > now) return { ok: false, code: "brief_reference_invalid", path: "created_at" };
  if (typeof expires !== "number" || !Number.isSafeInteger(expires) || expires <= now || expires <= created || expires - created > CONTENT_BRIEF_HANDOFF_TTL_MS) return { ok: false, code: "brief_reference_invalid", path: "expires_at" };
  return parseConfirmedBriefV2(value.brief);
}
