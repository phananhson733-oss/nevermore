// @input  -- theater-details.ts with a fake fetch in place of www.reelshort.com; a page trimmed from the real one for a Spanish drama
// @output -- proof that a ReelShort page is read field by field (tags as shown, 女频/男频 and genre by tag id), that only ReelShort's own host is followed, that anything odd gives null rather than a guess, and that only a ReelShort id gets a link
// @pos    -- unit tests for 查剧's second step; no network, no database
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import { fetchTheaterDetails, parseReelShortPage, theaterPageUrl } from "./theater-details.ts";

const BOOK_ID = "6ad88d9e996727b60c007958";
const ALIAS_ID = "6ad192a1f3d20df996045012";
const COVER = "https://v-img.crazymaplestudios.com/v-images/book_cover_batch/304200150000006446/88717e7a.jpg";

/** The fields 查剧 reads, as www.reelshort.com/es/movie/lazos-rotos-de-los-hermanos-fae-… served them on 2026-11-08. */
const DATA = {
  book_id: BOOK_ID,
  book_title: "Lazos rotos de los hermanos fae",
  lang: "es",
  total: 54,
  is_paid: 1,
  paid_start: 10,
  special_desc: "Traicionada por los príncipes fae a los que protegió durante años.",
  book_pic: COVER,
  tag: ["Haciéndose el Tonto"],
  tag_list: [
    { id: "676d21074582b53a14081663", category_id: "1000", text: "Mujer" },
    { id: "676d210e4582b53a14081a83", category_id: "1015", text: "Todas las edades" },
    { id: "676d210e4582b53a14081aae", category_id: "1020", text: "Inmortal" },
    { id: "676d210e4582b53a14081ab9", category_id: "1020", text: "Realeza/Nobleza" },
    { id: "676d210f4582b53a14081b01", category_id: "1022", text: "Amantes Destinados" },
    { id: "676d210d4582b53a14081a01", category_id: "1001", text: "Chase Mattson" },
    { id: "676d210d4582b53a14081a02", category_id: "1005", text: "Haley Lohrli" },
    { id: "676d210f4582b53a14081b20", category_id: "1024", text: "Vengarse del ex" },
    { id: "676d210c4582b53a140819c1", category_id: "1010", text: "Romance" },
    { id: "676d210f4582b53a14081b81", category_id: "1010001", text: "Dulce Romance" },
  ],
};

function page(data: unknown): string {
  const next = JSON.stringify({ props: { pageProps: { data } }, page: "/movie/[slug]" });
  return `<!DOCTYPE html><html><head><title>x</title></head><body><div id="__next"></div>
<script id="__NEXT_DATA__" type="application/json">${next}</script></body></html>`;
}

function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
}

describe("parseReelShortPage", () => {
  it("reads the drama as the page shows it", () => {
    expect(parseReelShortPage(page(DATA))).toEqual({
      platform: "reelshort",
      dramaId: BOOK_ID,
      title: "Lazos rotos de los hermanos fae",
      language: "es",
      episodes: 54,
      paid: true,
      payStart: 10,
      synopsis: "Traicionada por los príncipes fae a los que protegió durante años.",
      // In the page's language and order; 女频 goes to audience, cast names are left out, the theme comes last.
      tags: [
        "Todas las edades",
        "Inmortal",
        "Realeza/Nobleza",
        "Amantes Destinados",
        "Vengarse del ex",
        "Romance",
        "Dulce Romance",
        "Haciéndose el Tonto",
      ],
      audience: "female",
      genre: "romance",
      coverUrl: COVER,
    });
  });

  it("knows 男频 and every genre by id, whatever the page's language", () => {
    const male = { id: "676d21074582b53a14081664", category_id: "1000", text: "Masculino" };
    const genres: ReadonlyArray<readonly [string, string]> = [
      ["676d210c4582b53a140819bb", "comedy"],
      ["676d210c4582b53a140819bf", "fantasy"],
      ["676d210c4582b53a140819c0", "sports"],
      ["676d210c4582b53a140819c1", "romance"],
      ["676d210c4582b53a140819c2", "drama"],
      ["676d210c4582b53a140819c4", "animation"],
    ];
    for (const [id, genre] of genres) {
      const details = parseReelShortPage(page({ ...DATA, tag_list: [male, { id, category_id: "1010", text: "Anything" }] }));
      expect(details).toMatchObject({ audience: "male", genre, tags: ["Anything", "Haciéndose el Tonto"] });
    }
  });

  it("leaves 频道 and genre empty rather than guess", () => {
    const details = parseReelShortPage(
      page({
        ...DATA,
        tag_list: [
          { id: "676d21074582b53a14081666", category_id: "1000", text: "All" },
          { id: "676d210c4582b53a140819c3", category_id: "1010", text: "Unknown genre" },
        ],
      }),
    );
    expect(details).toMatchObject({ audience: null, genre: null, tags: ["Unknown genre", "Haciéndose el Tonto"] });
  });

  it("tells a free drama from one whose pay start is unknown", () => {
    expect(parseReelShortPage(page({ ...DATA, is_paid: 0, paid_start: 0 }))).toMatchObject({ paid: false, payStart: null });
    expect(parseReelShortPage(page({ ...DATA, is_paid: undefined, paid_start: undefined }))).toMatchObject({
      paid: null,
      payStart: null,
    });
    expect(parseReelShortPage(page({ ...DATA, paid_start: 0 }))).toMatchObject({ paid: true, payStart: null });
  });

  it("drops a field or a tag it cannot read and keeps the rest", () => {
    const details = parseReelShortPage(
      page({
        ...DATA,
        total: "54",
        lang: 3,
        special_desc: "   ",
        book_pic: "http://insecure.example.com/c.jpg",
        tag: "not a list",
        tag_list: [{ id: 1, category_id: "1020", text: "Bad id" }, { category_id: "1020", text: "No id" }, "x", { id: "a", category_id: "1022", text: " Revenge " }],
      }),
    );
    expect(details).toMatchObject({
      dramaId: BOOK_ID,
      episodes: null,
      language: null,
      synopsis: null,
      coverUrl: null,
      tags: ["Revenge"],
    });
  });

  it("refuses a page that is not one drama", () => {
    expect(parseReelShortPage("<html>no data</html>")).toBeNull();
    expect(parseReelShortPage(page({ ...DATA, book_id: "not-an-id" }))).toBeNull();
    expect(parseReelShortPage(page(null))).toBeNull();
    expect(parseReelShortPage('<script id="__NEXT_DATA__" type="application/json">{oops</script>')).toBeNull();
  });
});

describe("fetchTheaterDetails", () => {
  it("only knows ReelShort, and only its own ids", async () => {
    const never = (async () => {
      throw new Error("no request expected");
    }) as typeof fetch;
    expect(await fetchTheaterDetails("dramabox", BOOK_ID, never)).toBeNull();
    expect(await fetchTheaterDetails("reelshort", "../../etc", never)).toBeNull();
    expect(await fetchTheaterDetails("reelshort", "68a1b2c3d4", never)).toBeNull();
  });

  it("follows ReelShort's own redirect to the drama the id now points at", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(String(input));
      expect(init?.redirect).toBe("manual");
      expect(new Headers(init?.headers).get("user-agent")).toMatch(/Mozilla/);
      if (seen.length === 1) {
        return new Response(null, { status: 301, headers: { location: `/es/movie/lazos-rotos-de-los-hermanos-fae-${BOOK_ID}` } });
      }
      return html(page(DATA));
    }) as typeof fetch;
    const details = await fetchTheaterDetails("reelshort", ALIAS_ID, fetchImpl);
    expect(seen).toEqual([
      `https://www.reelshort.com/movie/x-${ALIAS_ID}`,
      `https://www.reelshort.com/es/movie/lazos-rotos-de-los-hermanos-fae-${BOOK_ID}`,
    ]);
    expect(details?.dramaId).toBe(BOOK_ID);
  });

  it("refuses a redirect off ReelShort, a loop, an error page and a body too big", async () => {
    const redirectTo = (location: string) =>
      (async () => new Response(null, { status: 302, headers: { location } })) as typeof fetch;
    expect(await fetchTheaterDetails("reelshort", BOOK_ID, redirectTo("https://evil.example.com/x"))).toBeNull();
    expect(await fetchTheaterDetails("reelshort", BOOK_ID, redirectTo("http://www.reelshort.com/x"))).toBeNull();
    expect(await fetchTheaterDetails("reelshort", BOOK_ID, redirectTo("https://user:pw@www.reelshort.com/x"))).toBeNull();
    expect(await fetchTheaterDetails("reelshort", BOOK_ID, redirectTo("/movie/again"))).toBeNull();
    expect(await fetchTheaterDetails("reelshort", BOOK_ID, (async () => html(page(DATA), 404)) as typeof fetch)).toBeNull();
    expect(
      await fetchTheaterDetails(
        "reelshort",
        BOOK_ID,
        (async () => new Response(page(DATA), { headers: { "content-type": "application/json" } })) as typeof fetch,
      ),
    ).toBeNull();
    const huge = page(DATA) + " ".repeat(3 * 1024 * 1024);
    expect(await fetchTheaterDetails("reelshort", BOOK_ID, (async () => html(huge)) as typeof fetch)).toBeNull();
  });

  it("gives null, never throws, when the site is down or slow", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(await fetchTheaterDetails("reelshort", BOOK_ID, down)).toBeNull();
    const slow = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch;
    expect(await fetchTheaterDetails("reelshort", BOOK_ID, slow, 20)).toBeNull();
  });
});

describe("theaterPageUrl", () => {
  it("links a ReelShort id to its page and nothing else", () => {
    expect(theaterPageUrl("reelshort", BOOK_ID)).toBe(`https://www.reelshort.com/movie/x-${BOOK_ID}`);
    expect(theaterPageUrl("reelshort", "68a1b2c3d4")).toBeNull();
    expect(theaterPageUrl("reelshort", null)).toBeNull();
    expect(theaterPageUrl("dramabox", BOOK_ID)).toBeNull();
  });
});
