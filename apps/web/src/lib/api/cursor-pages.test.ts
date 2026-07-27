import { describe, expect, it } from "vitest";
import {
  COMPLETE_CURSOR_MAX_BYTES,
  COMPLETE_CURSOR_MAX_ITEMS,
  COMPLETE_CURSOR_MAX_PAGES,
  collectAllCursorItems,
  cursorPageUrl,
  nextCursorPageParam,
  uniqueCursorItems,
} from "./cursor-pages";

describe("cursor pages", () => {
  it("requests at most 100 rows and escapes opaque cursors", () => {
    expect(cursorPageUrl("/projects/p/actions", null)).toBe(
      "/projects/p/actions?limit=100",
    );
    expect(cursorPageUrl("/projects/p/actions", "next+/=")).toBe(
      "/projects/p/actions?limit=100&cursor=next%2B%2F%3D",
    );
    expect(
      cursorPageUrl("/projects/p/snapshots", "next+/=", {
        provider: "gsc",
      }),
    ).toBe(
      "/projects/p/snapshots?limit=100&cursor=next%2B%2F%3D&provider=gsc",
    );
  });

  it("follows nextCursor, stops null, and exposes cyclic cursors as errors", () => {
    const page = { data: [], meta: { nextCursor: "cursor-2" } };
    expect(nextCursorPageParam(page, [page], null, [null])).toBe("cursor-2");
    expect(() =>
      nextCursorPageParam(page, [page], "cursor-2", [null, "cursor-2"]),
    ).toThrow("repeated cursor");
    expect(
      nextCursorPageParam(
        { data: [], meta: { nextCursor: null } },
        [],
        null,
        [null],
      ),
    ).toBe(undefined);
  });

  it("aggregates multiple pages in order without duplicate ids", () => {
    expect(
      uniqueCursorItems({
        pages: [
          {
            data: [
              { id: "a", value: "first-a" },
              { id: "b", value: "first-b" },
            ],
            meta: { nextCursor: "cursor-2" },
          },
          {
            data: [
              { id: "b", value: "duplicate-b" },
              { id: "c", value: "second-c" },
            ],
            meta: { nextCursor: null },
          },
        ],
        pageParams: [null, "cursor-2"],
      }),
    ).toEqual([
      { id: "a", value: "first-a" },
      { id: "b", value: "first-b" },
      { id: "c", value: "second-c" },
    ]);
  });

  it("exhausts a complete cursor chain and de-duplicates boundaries", async () => {
    const calls: (string | null)[] = [];
    await expect(
      collectAllCursorItems(async (cursor) => {
        calls.push(cursor);
        return cursor === null
          ? {
              data: [{ id: "a" }, { id: "b" }],
              meta: { nextCursor: "cursor-2" },
            }
          : {
              data: [{ id: "b" }, { id: "c" }],
              meta: { nextCursor: null },
            };
      }),
    ).resolves.toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(calls).toEqual([null, "cursor-2"]);
  });

  it("fails closed instead of looping on a repeated cursor", async () => {
    await expect(
      collectAllCursorItems(async () => ({
        data: [],
        meta: { nextCursor: "cycle" },
      })),
    ).rejects.toThrow("repeated cursor");
  });

  it("fails closed after the complete-chain page budget", async () => {
    let page = 0;
    await expect(
      collectAllCursorItems(async () => {
        page += 1;
        return { data: [], meta: { nextCursor: `cursor-${page}` } };
      }),
    ).rejects.toThrow("page budget");
    expect(page).toBe(COMPLETE_CURSOR_MAX_PAGES);
  });

  it("fails closed when one page exceeds the API item limit", async () => {
    await expect(
      collectAllCursorItems(async () => ({
        data: Array.from(
          { length: COMPLETE_CURSOR_MAX_ITEMS + 1 },
          (_, index) => ({ id: `item-${index}` }),
        ),
        meta: { nextCursor: null },
      })),
    ).rejects.toThrow("per-page item budget");
  });

  it("fails closed when the complete chain exceeds the byte budget", async () => {
    await expect(
      collectAllCursorItems(async () => ({
        data: [
          {
            id: "large",
            value: "x".repeat(COMPLETE_CURSOR_MAX_BYTES),
          },
        ],
        meta: { nextCursor: null },
      })),
    ).rejects.toThrow("byte budget");
  });
});
