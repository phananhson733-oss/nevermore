// @input  -- stubbed single-image transports, healthy and hostile
// @output -- proof the run-level byte ceiling holds and that only images count
// @pos    -- unit coverage for the only subresource fetch the Agent audit makes

import { describe, expect, it, vi } from "vitest";

import {
  createImageWeightReader,
  type WeighOutcome,
} from "./image-weight-reader.ts";

const KB = 1024;
const MB = 1024 * KB;

const image = (url: string, bytes: number, complete = true): WeighOutcome => ({
  spentBytes: bytes,
  measured: { url, transferredBytes: bytes, complete },
});

/** Bytes arrived, nothing measurable came back — a 404 body, or an HTML page. */
const spentNothingUsable = (bytes: number): WeighOutcome => ({
  spentBytes: bytes,
  measured: null,
});

const sources = (count: number, prefix = "https://cdn.test/i") =>
  Array.from({ length: count }, (_, i) => `${prefix}${i}.jpg`);

function reader(weighImage: (url: string) => Promise<WeighOutcome>) {
  const seen: string[] = [];
  const spy = vi.fn(async (url: string) => {
    seen.push(url);
    return weighImage(url);
  });
  return { seen, spy, read: createImageWeightReader({ weighImage: spy }) };
}

describe("what counts as a measured image", () => {
  it("weighs the images the page declared", async () => {
    const { read } = reader(async (url) => image(url, 40 * KB));
    const result = await read({ sources: sources(3) });

    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.images).toHaveLength(3);
    expect(result.status === "ok" && result.complete).toBe(true);
  });

  it("says nothing was fetched rather than reporting a clean page", async () => {
    const { read } = reader(async () => spentNothingUsable(0));
    const result = await read({ sources: sources(3) });

    expect(result).toEqual({
      status: "unavailable",
      reason: "no_image_could_be_fetched",
    });
  });

  it("says the page declared none when it declared none", async () => {
    const { read } = reader(async (url) => image(url, 1));
    expect(await read({ sources: [] })).toEqual({
      status: "unavailable",
      reason: "no_images_declared",
    });
  });
});

describe("the run-level byte ceiling", () => {
  it("stops the run once the declared images have cost enough", async () => {
    // The page chooses these URLs, so the ceiling is what keeps the cost of a
    // run fixed no matter what it declares.
    const { seen, read } = reader(async (url) => image(url, 1 * MB));
    await read({ sources: sources(25) });

    // Four at a time, stopping at the first batch boundary past three
    // megabytes: eight fetched, not twenty-five.
    expect(seen.length).toBeLessThanOrEqual(8);
  });

  it("charges bytes that produced no measurement", async () => {
    // The defect this exists to prevent: the ledger moved only on success,
    // while the transport reads the bounded body before the status is
    // inspected. Twenty-five 200 KB error bodies transferred five megabytes
    // against a three-megabyte cap that never saw a byte.
    const { seen, read } = reader(async () => spentNothingUsable(200 * KB));
    await read({ sources: sources(25) });

    expect(seen.length).toBeLessThan(25);
  });

  it("does not call a truncated run complete", async () => {
    const { read } = reader(async (url) => image(url, 1 * MB));
    const result = await read({ sources: sources(25) });

    // Some images were never looked at, so "no image is over budget" is not a
    // claim this run may make.
    expect(result.status === "ok" && result.complete).toBe(false);
  });

  it("does not call a count-capped run complete either", async () => {
    const { read } = reader(async (url) => image(url, 1 * KB));
    const result = await read({ sources: sources(40) });

    expect(result.status === "ok" && result.images).toHaveLength(25);
    expect(result.status === "ok" && result.complete).toBe(false);
  });

  it("does not call a run with a dropped image complete", async () => {
    const { read } = reader(async (url) =>
      url.endsWith("i1.jpg") ? spentNothingUsable(2 * KB) : image(url, 4 * KB),
    );
    const result = await read({ sources: sources(4) });

    expect(result.status === "ok" && result.images).toHaveLength(3);
    expect(result.status === "ok" && result.complete).toBe(false);
  });
});
