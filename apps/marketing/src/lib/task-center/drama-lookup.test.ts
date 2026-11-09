// @input  -- drama-lookup.ts with a fake fetch in place of 选剧台 and the cover CDN
// @output -- proof that the lookup client reads only well-formed answers, maps errors, fits a 北斗 row to the dramas table, and fetches only a sane cover
// @pos    -- unit tests for the task center's side of pick-workbench's lookup contract; no network, no database
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import { MAX_IMAGE_BYTES } from "./contracts.ts";
import { fetchCover, lookupDramas, readLookupConfig, toImportedDrama, type LookupDrama } from "./drama-lookup.ts";

const CONFIG = { url: "http://drama-platform-web-1:8088", token: "t0ken" };
const QUERY = { platform: "reelshort", title: "Surf God", language: null };

const ROW: LookupDrama = {
  platformDramaId: "68a1b2c3d4",
  title: "Surf God's Revenge",
  titleCn: "冲浪之神的复仇",
  exact: true,
  language: "en",
  listedOn: null,
  episodeCount: 70,
  payStart: 8,
  finished: true,
  description: "He came back.",
  tags: ["Revenge", "Sports"],
  coverUrl: "https://cdn.example.com/c.jpg?sig=1",
};

function answer(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

describe("readLookupConfig", () => {
  it("needs both values and a bare origin", () => {
    expect(readLookupConfig({ PICK_LOOKUP_URL: "http://web:8088/", PICK_LOOKUP_TOKEN: " x " })).toEqual({
      url: "http://web:8088",
      token: "x",
    });
    expect(readLookupConfig({ PICK_LOOKUP_URL: "http://web:8088" })).toBeNull();
    expect(readLookupConfig({ PICK_LOOKUP_URL: "http://web:8088/api", PICK_LOOKUP_TOKEN: "x" })).toBeNull();
    expect(readLookupConfig({ PICK_LOOKUP_URL: "ftp://web", PICK_LOOKUP_TOKEN: "x" })).toBeNull();
  });
});

describe("lookupDramas", () => {
  it("sends the token and query, and drops rows it cannot read", async () => {
    let seen: { url: string; auth: string | null } | null = null;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen = { url: String(input), auth: new Headers(init?.headers).get("authorization") };
      return new Response(JSON.stringify({ ok: true, dramas: [ROW, { title: "no id" }] }), { status: 200 });
    }) as typeof fetch;
    const result = await lookupDramas(CONFIG, { ...QUERY, language: "es" }, fetchImpl);
    expect(result).toEqual({ ok: true, dramas: [ROW] });
    expect(seen).toEqual({
      url: "http://drama-platform-web-1:8088/api/pick/lookup/drama/?platform=reelshort&title=Surf+God&language=es",
      auth: "Bearer t0ken",
    });
  });

  it("tells a query that will never work from one to retry", async () => {
    expect(await lookupDramas(CONFIG, QUERY, answer(422, { ok: false, error: "unknown_platform", message: "no" }))).toEqual({
      ok: false,
      reason: "rejected",
      message: "no",
    });
    expect(await lookupDramas(CONFIG, QUERY, answer(503, { ok: false, error: "beidou_unavailable" }))).toMatchObject({
      ok: false,
      reason: "unavailable",
      message: "beidou_unavailable",
    });
    expect(await lookupDramas(CONFIG, QUERY, answer(200, { ok: "yes" }))).toMatchObject({ reason: "unavailable" });
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(await lookupDramas(CONFIG, QUERY, down)).toMatchObject({ reason: "unavailable", message: "连不上选剧台" });
  });
});

describe("toImportedDrama", () => {
  it("prefers the operator's language and keeps 北斗's facts", () => {
    expect(toImportedDrama(ROW, { platform: "reelshort", language: "es" })).toEqual({
      title: "Surf God's Revenge",
      titleCn: "冲浪之神的复仇",
      platform: "reelshort",
      language: "es",
      episodes: 70,
      payStart: 8,
      synopsis: "He came back.",
      tags: ["Revenge", "Sports"],
      finished: true,
      sourceDramaId: "68a1b2c3d4",
    });
  });

  it("turns out-of-range numbers into unknown and trims what is too long", () => {
    const fitted = toImportedDrama(
      {
        ...ROW,
        episodeCount: 5000,
        payStart: 3000,
        description: "x".repeat(5000),
        titleCn: "  ",
        tags: [" Romance ", "romance", "", "y".repeat(60), ...Array.from({ length: 30 }, (_, n) => `t${n}`)],
      },
      { platform: "reelshort", language: null },
    );
    expect(fitted).toMatchObject({ episodes: null, payStart: null, titleCn: null });
    expect(fitted?.synopsis).toHaveLength(4000);
    expect(fitted?.tags).toHaveLength(20);
    expect(fitted?.tags.slice(0, 2)).toEqual(["Romance", "y".repeat(40)]);
    expect(toImportedDrama({ ...ROW, episodeCount: 6, payStart: 9 }, QUERY)).toMatchObject({ episodes: 6, payStart: null });
  });

  it("drops NUL and other control characters Postgres would refuse", () => {
    const fitted = toImportedDrama(
      { ...ROW, title: "Surf\u0000 God", titleCn: "\u0000", description: "a\nb\u0007", tags: ["Re\u0000venge"] },
      QUERY,
    );
    expect(fitted).toMatchObject({ title: "Surf God", titleCn: null, synopsis: "a\nb", tags: ["Revenge"] });
  });

  it("gives up when nobody knows the language", () => {
    expect(toImportedDrama({ ...ROW, language: null }, QUERY)).toBeNull();
  });
});

describe("fetchCover", () => {
  const image = (type: string, bytes: number, headers: Record<string, string> = {}) =>
    (async () =>
      new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": type, ...headers } })) as typeof fetch;

  it("returns the image when it is one", async () => {
    const cover = await fetchCover("https://cdn.example.com/c.jpg", image("image/jpeg; charset=binary", 10));
    expect(cover?.contentType).toBe("image/jpeg");
    expect(cover?.bytes.byteLength).toBe(10);
  });

  it("refuses anything that is not a public https image of sane size", async () => {
    const never = (async () => {
      throw new Error("must not be fetched");
    }) as typeof fetch;
    for (const url of [
      "http://cdn.example.com/c.jpg",
      "https://10.0.0.1/c.jpg",
      "https://[::1]/c.jpg",
      "https://drama-platform-web-1/c.jpg",
      "https://user:pw@cdn.example.com/c.jpg",
      "https://x.localhost/c.jpg",
      "https://svc.internal./c.jpg",
      "not a url",
    ]) {
      expect(await fetchCover(url, never)).toBeNull();
    }
    expect(await fetchCover("https://cdn.example.com/c", image("text/html", 10))).toBeNull();
    expect(await fetchCover("https://cdn.example.com/c", image("image/png", 0))).toBeNull();
    expect(
      await fetchCover("https://cdn.example.com/c", image("image/png", 1, { "content-length": String(MAX_IMAGE_BYTES + 1) })),
    ).toBeNull();
    expect(await fetchCover("https://cdn.example.com/c", image("image/png", MAX_IMAGE_BYTES + 1))).toBeNull();
    expect(await fetchCover("https://cdn.example.com/c", answer(404, {}))).toBeNull();
  });
});
