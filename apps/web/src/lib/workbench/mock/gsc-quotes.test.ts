import { describe, expect, it } from "vitest";
import type { GscRow } from "../types.ts";
import { parseGsc } from "./gsc.ts";

/** Quoted fields holding the delimiter and a line break, and the stray-quote recovery beside them. The rest of the record structure lives in gsc.test.ts. */
const row = (
  query: string,
  clicks: number | null,
  impressions: number | null,
  ctr: number | null,
  position: number | null,
): GscRow => ({ query, clicks, impressions, ctr, position });

const lines = (...parts: readonly string[]): string => parts.join("\n");

describe("parseGsc: quoted fields holding the delimiter and a line break", () => {
  it("keeps a quoted query holding a comma and a newline in a comma export as one row", () => {
    const text = `Query,Clicks,Impressions,CTR,Position\n"red,\nshoes",5,100,5%,7`;
    expect(parseGsc(text)).toEqual({
      rows: [row("red,\nshoes", 5, 100, 5, 7)],
      skipped: 0,
    });
  });

  it("unescapes doubled quotes inside a quoted field that also holds the delimiter and a newline", () => {
    const text = lines("Query,Clicks,Impressions,CTR,Position", `"say ""hi"",`, `there",5,100,5%,7`);
    expect(parseGsc(text)).toEqual({
      rows: [row(`say "hi",\nthere`, 5, 100, 5, 7)],
      skipped: 0,
    });
  });

  it("reads an unterminated quote before the delimiter as text instead of swallowing the paste", () => {
    const text = lines("Query,Clicks,Impressions,CTR,Position", `"red,`, "shoes,5,100,5%,7", "next,1,2,3%,4");
    expect(parseGsc(text)).toEqual({
      rows: [row("shoes", 5, 100, 5, 7), row("next", 1, 2, 3, 4)],
      skipped: 1,
    });
  });
});
