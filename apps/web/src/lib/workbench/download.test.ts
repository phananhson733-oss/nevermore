/** @vitest-environment jsdom */

/**
 * Everything this helper does is a side effect on the document and on the object
 * URL store, and all of it is invisible from its (void) return value: whether the
 * anchor was really a download, whether it left the DOM when `click()` threw, and
 * whether the blob is freed late enough for the browser to have fetched it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadText } from "./download.ts";

const URL_VALUE = "blob:test/artifact";
/** Must match `downloadText`'s revoke delay. */
const REVOKE_MS = 1000;

const createObjectURL = vi.fn<(blob: Blob) => string>();
const revokeObjectURL = vi.fn<(url: string) => void>();

function anchors(): readonly HTMLAnchorElement[] {
  return [...document.body.querySelectorAll("a")];
}

beforeEach(() => {
  vi.useFakeTimers();
  createObjectURL.mockReset();
  createObjectURL.mockReturnValue(URL_VALUE);
  revokeObjectURL.mockReset();
  // jsdom implements neither, and a missing createObjectURL would throw before
  // the anchor is ever built.
  Object.defineProperty(URL, "createObjectURL", {
    value: createObjectURL,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: revokeObjectURL,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (URL as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
  for (const node of anchors()) node.remove();
});

describe("downloadText", () => {
  it("clicks a download anchor and takes it back out of the document", () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        // Read the anchor at the only moment it is connected: afterwards there is
        // nothing left to assert against.
        expect(this.isConnected).toBe(true);
        expect(this.getAttribute("download")).toBe("keywords.csv");
        expect(this.getAttribute("href")).toBe(URL_VALUE);
        expect(this.rel).toBe("noopener");
      });

    downloadText("keywords.csv", "q\ngeo audit\n", "text/csv;charset=utf-8");

    expect(click).toHaveBeenCalledTimes(1);
    expect(anchors()).toHaveLength(0);
  });

  it("hands the blob the caller's mime type", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadText("notes.md", "# hi", "text/markdown;charset=utf-8");

    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob?.type).toBe("text/markdown;charset=utf-8");
    expect(await blob?.text()).toBe("# hi");
  });

  it("removes the anchor and still revokes when click() throws", () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => downloadText("a.txt", "x")).toThrow("blocked");

    expect(anchors()).toHaveLength(0);
    vi.advanceTimersByTime(REVOKE_MS);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(URL_VALUE);
  });

  it("keeps the object URL alive past the current task", () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadText("a.txt", "x");

    // Safari fetches the URL after the click task returns; a 0ms revoke races it.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REVOKE_MS - 1);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(URL_VALUE);
  });
});
