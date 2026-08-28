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
const SIGN_OUT_PREFIXES: readonly string[] = [
  ON_PAGE_STORAGE_PREFIX,
  "gengrowth:agent-intent:",
];

/**
 * The recent-checks list, and nothing beside it.
 *
 * The visitor's own "Clear" sits under "Recent checks" and means that list.
 * Two wider readings were both wrong: the sign-out sweep also cancels Agent
 * intents this tool never wrote, and even the narrower `gengrowth:onpage-*`
 * sweep deletes the draft while leaving the `page_focused_launch` intent that
 * was written with it — the Agent then resumes on the URL with the queries and
 * the page role gone, which is half a question rather than none.
 */
const HISTORY_FAMILY = `${ON_PAGE_STORAGE_PREFIX}history:`;

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
  /**
   * Null for a URL-only check, which measured no coverage to report.
   *
   * The list is what the visitor ran, not only what produced a coverage
   * figure. Skipping those rows outright meant somebody could check five pages
   * from a briefing handoff and watch "recent checks" stay empty.
   */
  readonly focus: {
    readonly covered: number;
    readonly applicable: number;
  } | null;
  /**
   * The published score, so the list can show a trend rather than a log.
   *
   * Optional on read and null on entries written before scoring existed. A
   * closed key set would have rejected those outright and silently emptied
   * somebody's list on upgrade, which is a worse trade than one column reading
   * "—" for the checks that predate the number.
   */
  readonly score?: {
    readonly value: number;
    readonly grade: "A" | "B" | "C" | "D";
  } | null;
  /**
   * What the crawl behind this check managed to see.
   *
   * Every count is nullable and the availability is carried, because both facts
   * are the visitor's only way to tell a page checked against a complete crawl
   * from one checked against a crawl that stopped early. A count the response
   * did not carry stays `null`: writing 0 there would turn "we were not told"
   * into "we looked and there were none".
   */
  readonly coverage: {
    readonly availability: "available" | "partial" | "unavailable";
    readonly pagesInspected: number | null;
    readonly urlsSkipped: number | null;
    readonly urlsBlocked: number | null;
    readonly urlsErrored: number | null;
  };
  readonly cacheStatus: "hit" | "miss" | "unknown";
}

/** Written by a build that predates the field, and still perfectly readable. */
const OPTIONAL_HISTORY_KEYS: ReadonlySet<string> = new Set(["score"]);

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
  // `crypto.randomUUID` needs a secure context, and this is called after the
  // result is already on screen: a throw here would discard a finished check
  // over a list identity. The fallback keeps the same shape so the reader that
  // validates it does not have to learn a second one.
  try {
    return crypto.randomUUID();
  } catch {
    return randomUuidV4FromBytes();
  }
}

/** Same shape, same version nibble, from whatever randomness is available. */
function randomUuidV4FromBytes(): string {
  const bytes = new Uint8Array(16);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
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

/**
 * Empty is a real list now: a URL-only check names no query.
 *
 * The floor of one predated that mode, and `appendOnPageHistory` drops an
 * invalid entry silently — so the whole row vanished rather than erroring, and
 * a visitor checking page after page watched the list stay empty.
 */
function isQueryList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
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

/** A count the response carried, or `null` for one it did not. Never 0 for absent. */
function isNullableCount(value: unknown): value is number | null {
  return value === null || isNonNegativeInteger(value);
}

function isCoverageAvailability(
  value: unknown,
): value is "available" | "partial" | "unavailable" {
  return (
    value === "available" || value === "partial" || value === "unavailable"
  );
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

/** Null for a URL-only check, which measured no coverage. */
function isNullableFocus(
  value: unknown,
): value is { readonly covered: number; readonly applicable: number } | null {
  return (
    value === null ||
    (isObject(value) &&
      isNonNegativeInteger(value.covered) &&
      isNonNegativeInteger(value.applicable))
  );
}

function isHistoryScore(
  value: unknown,
): value is { readonly value: number; readonly grade: "A" | "B" | "C" | "D" } {
  return (
    isObject(value) &&
    Object.keys(value).length === 2 &&
    isNonNegativeInteger(value.value) &&
    value.value <= 100 &&
    typeof value.grade === "string" &&
    ["A", "B", "C", "D"].includes(value.grade)
  );
}

function readHistoryEntry(value: unknown): OnPageHistoryEntry | null {
  if (!isObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.some((key) => !HISTORY_KEYS.has(key) && !OPTIONAL_HISTORY_KEYS.has(key)))
    return null;
  if ([...HISTORY_KEYS].some((key) => !keys.includes(key))) return null;
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
    score,
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
    !isNullableFocus(focus) ||
    !isObject(coverage) ||
    !isCoverageAvailability(coverage.availability) ||
    !isNullableCount(coverage.pagesInspected) ||
    !isNullableCount(coverage.urlsSkipped) ||
    !isNullableCount(coverage.urlsBlocked) ||
    !isNullableCount(coverage.urlsErrored) ||
    (cacheStatus !== "hit" && cacheStatus !== "miss" && cacheStatus !== "unknown") ||
    !(score === undefined || score === null || isHistoryScore(score))
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
    focus:
      focus === null
        ? null
        : { covered: focus.covered, applicable: focus.applicable },
    coverage: {
      availability: coverage.availability,
      pagesInspected: coverage.pagesInspected,
      urlsSkipped: coverage.urlsSkipped,
      urlsBlocked: coverage.urlsBlocked,
      urlsErrored: coverage.urlsErrored,
    },
    cacheStatus,
    score:
      score === undefined || score === null
        ? null
        : { value: score.value, grade: score.grade },
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
      // Both writes failed, so nothing was stored. Returning `next` here would
      // hand the caller a list to render that storage does not hold — the panel
      // would show this check as remembered and lose it on the next reload.
      // What is actually there is whatever the last successful write left.
      return readOnPageHistory(storage);
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
  clearPrefixes(SIGN_OUT_PREFIXES, storages);
}

/**
 * Delete the recent-checks list.
 *
 * For the visitor-facing "Clear" action. Any older history slot goes with it, so
 * a list written by a previous shape cannot come back; the draft and any pending
 * handoff are left alone, because they are not what the button names.
 */
export function clearOnPageHistory(
  ...storages: readonly (OnPageCheckerStorage | null | undefined)[]
): void {
  clearPrefixes([HISTORY_FAMILY], storages);
}

function clearPrefixes(
  prefixes: readonly string[],
  storages: readonly (OnPageCheckerStorage | null | undefined)[],
): void {
  for (const storage of storages) {
    if (!storage) continue;
    try {
      for (const key of keysUnder(storage, prefixes)) {
        storage.removeItem(key);
      }
    } catch {
      // A storage that refuses to be read or written is already not holding
      // anything this build put there.
    }
  }
}
