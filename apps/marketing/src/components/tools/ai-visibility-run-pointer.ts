// @input  -- a tab-scoped Storage and the sealed run pointer the start endpoint handed back
// @output -- that pointer again after a reload, or nothing when it is too old to be honoured
// @pos    -- the browser half of one visibility run pointer; never a server authority

/**
 * Why storage at all: a run takes about a quarter of an hour and costs real
 * provider calls, and the page promises the visitor they may leave it. A token
 * that lived only in a closure made that promise false — a reload threw away
 * the only handle on a run that had already been paid for.
 *
 * Why `sessionStorage` rather than `localStorage`: the pointer names one run
 * and is bound to the subject that started it, so it has no business outliving
 * the tab or travelling to a window signed in as somebody else, where the
 * server would answer 404 and the page would have to explain a run the visitor
 * never started. Nothing here is handed to a `_blank` tab, so the one thing
 * `sessionStorage` cannot do is not a thing this tool needs.
 */
export const VISIBILITY_RUN_STORAGE_KEY = "gengrowth.geo-visibility.run.v1";

/**
 * How long a stored pointer is worth presenting.
 *
 * The same twenty-four hours `RUN_POINTER_TTL_SECONDS` seals the token for in
 * `visibility-handler.ts`. Kept as its own constant because the client must not
 * import the server module; if the server's TTL moves, this moves with it.
 */
export const VISIBILITY_RUN_POINTER_TTL_MS = 24 * 60 * 60 * 1_000;

/** A sealed token is a few hundred bytes; this only rejects nonsense. */
const MAX_RUN_TOKEN_LENGTH = 8_192;
/** A pointer written by a clock a few minutes ahead is still this tab's. */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export interface VisibilityRunPointer {
  /** The sealed pointer the status endpoint reads. Opaque here. */
  readonly runToken: string;
  /** Epoch milliseconds the run was started at, used for the TTL and the clock. */
  readonly startedAt: number;
}

/** The slice of `Storage` this module uses, so a test can pass its own. */
export interface VisibilityRunStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function parsePointer(
  value: unknown,
  now: number,
): VisibilityRunPointer | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const runToken = record["runToken"];
  const startedAt = record["startedAt"];
  if (
    typeof runToken !== "string" ||
    runToken.length === 0 ||
    runToken.length > MAX_RUN_TOKEN_LENGTH ||
    typeof startedAt !== "number" ||
    !Number.isFinite(startedAt) ||
    startedAt <= 0 ||
    startedAt > now + MAX_CLOCK_SKEW_MS ||
    now - startedAt > VISIBILITY_RUN_POINTER_TTL_MS
  ) {
    return null;
  }
  return { runToken, startedAt };
}

/**
 * The stored pointer, or null.
 *
 * A pointer that fails to parse or has outlived the server's own TTL is
 * removed rather than returned: the alternative is a page stuck rendering a
 * "still running" panel for a run nothing can ever answer for.
 */
export function readVisibilityRunPointer(
  storage: VisibilityRunStorage,
  now: number = Date.now(),
): VisibilityRunPointer | null {
  try {
    const raw = storage.getItem(VISIBILITY_RUN_STORAGE_KEY);
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      storage.removeItem(VISIBILITY_RUN_STORAGE_KEY);
      return null;
    }
    const pointer = parsePointer(parsed, now);
    if (pointer === null) storage.removeItem(VISIBILITY_RUN_STORAGE_KEY);
    return pointer;
  } catch {
    // Private-mode Safari throws on the accessor itself. A tool that cannot
    // remember a run still has to run one.
    return null;
  }
}

export function writeVisibilityRunPointer(
  storage: VisibilityRunStorage,
  pointer: VisibilityRunPointer,
): boolean {
  try {
    storage.setItem(VISIBILITY_RUN_STORAGE_KEY, JSON.stringify(pointer));
    return true;
  } catch {
    return false;
  }
}

export function clearVisibilityRunPointer(
  storage: VisibilityRunStorage,
): boolean {
  try {
    storage.removeItem(VISIBILITY_RUN_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
