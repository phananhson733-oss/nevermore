import type { InfiniteData } from "@tanstack/react-query";

/** The API contract caps every cursor page at 100 rows. */
export const CURSOR_PAGE_LIMIT = 100;
export const COMPLETE_CURSOR_MAX_PAGES = 100;
export const COMPLETE_CURSOR_MAX_ITEMS = 10_000;
export const COMPLETE_CURSOR_MAX_BYTES = 16 * 1024 * 1024;

export interface CursorPage<T> {
  readonly data: readonly T[];
  readonly meta: {
    readonly nextCursor: string | null;
  };
}

/** Build one bounded cursor-list URL without leaking an opaque cursor unescaped. */
export function cursorPageUrl(path: string, cursor: string | null): string {
  const params = new URLSearchParams({ limit: String(CURSOR_PAGE_LIMIT) });
  if (cursor !== null) params.set("cursor", cursor);
  return `${path}?${params.toString()}`;
}

/**
 * Resolve the next page while fencing a malformed/cyclic server cursor. TanStack
 * treats `undefined` as the end of the list.
 */
export function nextCursorPageParam<T>(
  lastPage: CursorPage<T>,
  _pages: readonly CursorPage<T>[],
  _lastPageParam: string | null,
  pageParams: readonly (string | null)[],
): string | undefined {
  const next = lastPage.meta.nextCursor;
  if (next === null) return undefined;
  if (pageParams.includes(next)) {
    throw new Error("Cursor pagination returned a repeated cursor.");
  }
  return next;
}

/**
 * Flatten loaded pages in server order and keep the first canonical projection
 * of an id. This also prevents boundary duplicates after concurrent updates.
 */
export function uniqueCursorItems<T extends { readonly id: string }>(
  data: InfiniteData<CursorPage<T>, string | null> | undefined,
): readonly T[] {
  if (data === undefined) return [];
  const seen = new Set<string>();
  const items: T[] = [];
  for (const page of data.pages) {
    for (const item of page.data) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  return items;
}

/**
 * Exhaust a cursor chain when correctness requires the complete set rather than
 * a user-driven page window. Every transport request remains bounded at 100 by
 * the caller's use of {@link cursorPageUrl}; repeated cursors fail closed.
 */
export async function collectAllCursorItems<T extends { readonly id: string }>(
  fetchPage: (cursor: string | null) => Promise<CursorPage<T>>,
): Promise<readonly T[]> {
  const cursors = new Set<string>();
  const items = new Map<string, T>();
  const encoder = new TextEncoder();
  let cursor: string | null = null;
  let pagesRead = 0;
  let bytesRead = 0;

  for (;;) {
    const page = await fetchPage(cursor);
    pagesRead += 1;
    if (page.data.length > CURSOR_PAGE_LIMIT) {
      throw new Error("Cursor pagination exceeded the per-page item budget.");
    }
    bytesRead += encoder.encode(JSON.stringify(page)).byteLength;
    if (bytesRead > COMPLETE_CURSOR_MAX_BYTES) {
      throw new Error("Cursor pagination exceeded the byte budget.");
    }
    for (const item of page.data) {
      if (!items.has(item.id)) items.set(item.id, item);
    }
    if (items.size > COMPLETE_CURSOR_MAX_ITEMS) {
      throw new Error("Cursor pagination exceeded the item budget.");
    }
    const next = page.meta.nextCursor;
    if (next === null) return [...items.values()];
    if (cursors.has(next)) {
      throw new Error("Cursor pagination returned a repeated cursor.");
    }
    // The current page already consumed the full allowance. A non-terminal
    // cursor is therefore an over-budget response; fail before issuing request
    // MAX_PAGES + 1.
    if (pagesRead >= COMPLETE_CURSOR_MAX_PAGES) {
      throw new Error("Cursor pagination exceeded the page budget.");
    }
    cursors.add(next);
    cursor = next;
  }
}
