// @input  -- what the visitor typed on the page checker, and finished run summaries
// @output -- a resume slot that survives sign-in and a local list of recent checks
// @pos    -- the only browser storage this tool writes, and the one place that clears it
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

export type OnPageCheckerPageType = "homepage" | "product" | "tool" | "guide";

/**
 * Every key this tool owns starts here.
 *
 * Clearing walks the prefix rather than naming keys, so a slot added later
 * cannot be left behind on a shared machine by a clear that predates it.
 */
export const ON_PAGE_STORAGE_PREFIX = "gengrowth:onpage-";

/**
 * Everything a page-scoped check leaves in the browser.
 *
 * The checker writes its own draft *and* an Agent intent, because a handoff has
 * to survive sign-in on the Agent's own terms. Signing out has to clear both:
 * leaving the intent behind lets the next account in the same tab inherit the
 * previous visitor's page URL for the rest of its ten-minute window.
 */
const CLEARED_PREFIXES: readonly string[] = [
  ON_PAGE_STORAGE_PREFIX,
  "gengrowth:agent-intent:",
];

export const ON_PAGE_DRAFT_KEY = `${ON_PAGE_STORAGE_PREFIX}draft:v1`;
export const ON_PAGE_HISTORY_KEY = `${ON_PAGE_STORAGE_PREFIX}history:v1`;

/** Matches the Agent intent window: long enough to sign in, short enough to forget. */
export const ON_PAGE_DRAFT_TTL_MS = 10 * 60 * 1000;

/** Entries kept, and the serialized size at which the oldest start leaving. */
export const ON_PAGE_HISTORY_MAX_ENTRIES = 30;
export const ON_PAGE_HISTORY_MAX_CHARS = 128 * 1024;
export const ON_PAGE_HISTORY_MAX_ENTRY_CHARS = 8 * 1024;

/**
 * What reading or writing one known key needs.
 *
 * Separate from the walking interface below because the Agent boundary holds a
 * storage handle with exactly these three methods, and requiring `key`/`length`
 * there would have forced a second handle for no reason.
 */
export interface OnPageKeyedStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** What clearing by prefix needs on top of that. */
export interface OnPageCheckerStorage extends OnPageKeyedStorage {
  key(index: number): string | null;
  readonly length: number;
}

export interface OnPageCheckerDraft {
  readonly url: string;
  readonly targetQueries: readonly string[];
  readonly country: string;
  readonly locale: string;
  readonly pageType: OnPageCheckerPageType;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface OnPageHistoryEntry {
  readonly id: string;
  readonly createdAt: number;
  readonly url: string;
  readonly host: string;
  readonly targetQueries: readonly string[];
  readonly country: string;
  readonly locale: string;
  readonly pageType: OnPageCheckerPageType;
  readonly focus: { readonly covered: number; readonly applicable: number };
  readonly coverage: {
    readonly pagesInspected: number;
    readonly urlsSkipped: number;
    readonly urlsBlocked: number;
    readonly urlsErrored: number;
  };
  readonly cacheStatus: "hit" | "miss" | "unknown";
}

const HISTORY_KEYS: ReadonlySet<string> = new Set([
  "id",
  "createdAt",
  "url",
  "host",
  "targetQueries",
  "country",
  "locale",
  "pageType",
  "focus",
  "coverage",
  "cacheStatus",
]);

/**
 * Entry identity is a UUID, generated here rather than accepted.
 *
 * A caller-supplied id can collide across tabs, and a list whose identities are
 * not unique cannot be de-duplicated or pointed at later.
 */
export function newOnPageHistoryId(): string {
  return crypto.randomUUID();
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PAGE_TYPES: ReadonlySet<string> = new Set([
  "homepage",
  "product",
  "tool",
  "guide",
]);

const DRAFT_KEYS: ReadonlySet<string> = new Set([
  "url",
  "targetQueries",
  "country",
  "locale",
  "pageType",
  "createdAt",
  "expiresAt",
]);

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isQueryList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 5 &&
    value.every(
      (entry) =>
        typeof entry === "string" &&
        entry.trim() !== "" &&
        entry.length <= 80,
    )
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/**
 * Read a draft, rejecting anything that is not exactly this shape.
 *
 * The key set is closed: an unknown field means the value was written by a
 * version that thought it meant something else, and prefilling a form from a
 * shape we do not recognize is how a visitor ends up submitting a value they
 * never typed.
 */
function readDraft(value: unknown, now: number): OnPageCheckerDraft | null {
  if (!isObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== DRAFT_KEYS.size) return null;
  if (keys.some((key) => !DRAFT_KEYS.has(key))) return null;

  const {
    url,
    targetQueries,
    country,
    locale,
    pageType,
    createdAt,
    expiresAt,
  } = value;

  if (
    typeof url !== "string" ||
    url.trim() === "" ||
    url.length > 2_048 ||
    !isQueryList(targetQueries) ||
    typeof country !== "string" ||
    !/^[A-Z]{2}$/.test(country) ||
    typeof locale !== "string" ||
    locale.trim() === "" ||
    typeof pageType !== "string" ||
    !PAGE_TYPES.has(pageType) ||
    !isFiniteNumber(createdAt) ||
    !isFiniteNumber(expiresAt) ||
    expiresAt <= createdAt ||
    expiresAt - createdAt > ON_PAGE_DRAFT_TTL_MS ||
    expiresAt <= now
  ) {
    return null;
  }

  return {
    url,
    targetQueries,
    country,
    locale,
    pageType: pageType as OnPageCheckerPageType,
    createdAt,
    expiresAt,
  };
}

/**
 * Keys under the given prefixes, collected before anything is deleted.
 *
 * Indices shift as keys are removed, so walking and deleting in one pass skips
 * entries. The list is taken first and then acted on.
 */
function keysUnder(
  storage: OnPageCheckerStorage,
  prefixes: readonly string[],
): readonly string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null && prefixes.some((prefix) => key.startsWith(prefix))) {
      keys.push(key);
    }
  }
  return keys;
}

/** Every key this tool itself owns. */
function ownedKeys(storage: OnPageCheckerStorage): readonly string[] {
  return keysUnder(storage, [ON_PAGE_STORAGE_PREFIX]);
}

/** Drop slots this build no longer reads, so a stale URL cannot outlive its shape. */
function clearSupersededKeys(
  storage: OnPageCheckerStorage,
  current: string,
): void {
  const family = current.slice(0, current.lastIndexOf(":") + 1);
  for (const key of ownedKeys(storage)) {
    if (key !== current && key.startsWith(family)) storage.removeItem(key);
  }
}

export function storeOnPageDraft(
  storage: OnPageKeyedStorage,
  draft: Omit<OnPageCheckerDraft, "createdAt" | "expiresAt">,
  now = Date.now(),
): OnPageCheckerDraft | null {
  const candidate: OnPageCheckerDraft = {
    ...draft,
    createdAt: now,
    expiresAt: now + ON_PAGE_DRAFT_TTL_MS,
  };
  if (readDraft(candidate, now) === null) return null;
  try {
    if ("key" in storage) {
      clearSupersededKeys(storage as OnPageCheckerStorage, ON_PAGE_DRAFT_KEY);
    }
    storage.setItem(ON_PAGE_DRAFT_KEY, JSON.stringify(candidate));
    return candidate;
  } catch {
    return null;
  }
}

/** Read the draft, deleting it if it is expired, malformed, or unreadable. */
export function readOnPageDraft(
  storage: OnPageKeyedStorage,
  now = Date.now(),
): OnPageCheckerDraft | null {
  let parsed: unknown;
  try {
    const stored = storage.getItem(ON_PAGE_DRAFT_KEY);
    if (stored === null) return null;
    parsed = JSON.parse(stored);
  } catch {
    try {
      storage.removeItem(ON_PAGE_DRAFT_KEY);
    } catch {
      // A storage that cannot delete is a storage we cannot use; nothing to do.
    }
    return null;
  }

  const draft = readDraft(parsed, now);
  if (draft === null) {
    try {
      storage.removeItem(ON_PAGE_DRAFT_KEY);
    } catch {
      // Same.
    }
    return null;
  }
  return draft;
}

/**
 * Delete the draft and nothing else.
 *
 * Used the moment a handoff has been prefilled: a draft that outlives its use is
 * a stale URL waiting to fill in someone else's form. Clearing the whole prefix
 * there would also take the recent-checks list, which the visitor did not ask to
 * lose.
 */
export function clearOnPageDraft(storage: OnPageKeyedStorage): void {
  try {
    storage.removeItem(ON_PAGE_DRAFT_KEY);
  } catch {
    // A storage that refuses to delete is not holding anything we can act on.
  }
}

function readHistoryEntry(value: unknown): OnPageHistoryEntry | null {
  if (!isObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== HISTORY_KEYS.size) return null;
  if (keys.some((key) => !HISTORY_KEYS.has(key))) return null;
  const {
    id,
    createdAt,
    url,
    host,
    targetQueries,
    country,
    locale,
    pageType,
    focus,
    coverage,
    cacheStatus,
  } = value;

  if (
    typeof id !== "string" ||
    !UUID_PATTERN.test(id) ||
    !isNonNegativeInteger(createdAt) ||
    typeof url !== "string" ||
    url === "" ||
    typeof host !== "string" ||
    host === "" ||
    !isQueryList(targetQueries) ||
    typeof country !== "string" ||
    typeof locale !== "string" ||
    typeof pageType !== "string" ||
    !PAGE_TYPES.has(pageType) ||
    !isObject(focus) ||
    !isNonNegativeInteger(focus.covered) ||
    !isNonNegativeInteger(focus.applicable) ||
    !isObject(coverage) ||
    !isNonNegativeInteger(coverage.pagesInspected) ||
    !isNonNegativeInteger(coverage.urlsSkipped) ||
    !isNonNegativeInteger(coverage.urlsBlocked) ||
    !isNonNegativeInteger(coverage.urlsErrored) ||
    (cacheStatus !== "hit" && cacheStatus !== "miss" && cacheStatus !== "unknown")
  ) {
    return null;
  }

  return {
    id,
    createdAt,
    url,
    host,
    targetQueries,
    country,
    locale,
    pageType: pageType as OnPageCheckerPageType,
    focus: { covered: focus.covered, applicable: focus.applicable },
    coverage: {
      pagesInspected: coverage.pagesInspected,
      urlsSkipped: coverage.urlsSkipped,
      urlsBlocked: coverage.urlsBlocked,
      urlsErrored: coverage.urlsErrored,
    },
    cacheStatus,
  };
}

/**
 * Read the recent checks.
 *
 * Bad entries are dropped in memory and not written back: this list is a
 * convenience, and a read that repairs storage would let one corrupt entry
 * silently delete the rest on a page the visitor only opened.
 */
export function readOnPageHistory(
  storage: OnPageCheckerStorage,
): readonly OnPageHistoryEntry[] {
  let parsed: unknown;
  try {
    const stored = storage.getItem(ON_PAGE_HISTORY_KEY);
    if (stored === null) return [];
    parsed = JSON.parse(stored);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const entries: OnPageHistoryEntry[] = [];
  for (const candidate of parsed) {
    const entry = readHistoryEntry(candidate);
    if (entry !== null) entries.push(entry);
  }
  return entries;
}

function withinBudget(entries: readonly OnPageHistoryEntry[]): boolean {
  return JSON.stringify(entries).length <= ON_PAGE_HISTORY_MAX_CHARS;
}

/**
 * Append a finished check.
 *
 * Only whole successes reach here, so the list never suggests a run produced
 * something it did not. Oldest first out on both limits, and a full quota
 * costs the oldest few rather than the write: losing the tail of a convenience
 * list is not worth failing the thing the visitor actually asked for.
 */
export function appendOnPageHistory(
  storage: OnPageCheckerStorage,
  entry: OnPageHistoryEntry,
): readonly OnPageHistoryEntry[] {
  if (readHistoryEntry(entry) === null) return readOnPageHistory(storage);
  if (JSON.stringify(entry).length > ON_PAGE_HISTORY_MAX_ENTRY_CHARS) {
    return readOnPageHistory(storage);
  }

  let next = [...readOnPageHistory(storage), entry].sort(
    (left, right) => left.createdAt - right.createdAt,
  );
  while (next.length > ON_PAGE_HISTORY_MAX_ENTRIES) next = next.slice(1);
  while (next.length > 1 && !withinBudget(next)) next = next.slice(1);

  try {
    clearSupersededKeys(storage, ON_PAGE_HISTORY_KEY);
    storage.setItem(ON_PAGE_HISTORY_KEY, JSON.stringify(next));
    return next;
  } catch {
    const trimmed = next.slice(Math.min(5, Math.max(next.length - 1, 0)));
    try {
      storage.setItem(ON_PAGE_HISTORY_KEY, JSON.stringify(trimmed));
      return trimmed;
    } catch {
      return next;
    }
  }
}

/**
 * Delete everything this tool stores, in every storage it was given.
 *
 * Walks prefixes rather than naming keys, and takes both storages because
 * signing out clears cookies only: on a shared machine the previous visitor's
 * URL, queries and pending Agent handoff would otherwise still be there.
 */
export function clearOnPageStorage(
  ...storages: readonly (OnPageCheckerStorage | null | undefined)[]
): void {
  for (const storage of storages) {
    if (!storage) continue;
    try {
      for (const key of keysUnder(storage, CLEARED_PREFIXES)) {
        storage.removeItem(key);
      }
    } catch {
      // A storage that refuses to be read or written is already not holding
      // anything this build put there.
    }
  }
}
