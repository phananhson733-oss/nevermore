// @input  -- theater-details.ts and the StardustTV, MoboReels, NetShort and YourChannel readers (and DramaBox's, switched off) with a fake fetch; data trimmed from what each site served on 2026-11-08
// @output -- proof that each site is read as it shows the drama (tags, 频道 and genre only where the site marks them, pay start only where it says), that each reader asks only its own host, and that each site's "no such drama" answer gives null
// @pos    -- unit tests for 查剧's second step beyond ReelShort; no network, no database
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import { fetchTheaterDetails } from "./theater-details.ts";
import { parseDramaBoxPage, readDramaBox } from "./theater-dramabox.ts";
import { genreSlug, languageCode, theaterGet } from "./theater-http.ts";
import { parseMoboReelsSeries } from "./theater-moboreels.ts";
import { parseNetShortPage } from "./theater-netshort.ts";
import { parseStardustTvPage } from "./theater-stardusttv.ts";
import { parseYourChannelPlaylet } from "./theater-yourchannel.ts";

interface Seen {
  readonly url: string;
  readonly method: string;
  readonly body: string | null;
}

/** A fake fetch that answers each request in turn and records what was asked. */
function site(...answers: Response[]): { readonly fetchImpl: typeof fetch; readonly seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null });
    expect(init?.redirect).toBe("manual");
    const answer = answers[seen.length - 1];
    if (answer === undefined) throw new Error("no more answers");
    return answer;
  }) as typeof fetch;
  return { fetchImpl, seen };
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json;charset=UTF-8" } });
}

function redirect(location: string): Response {
  return new Response(null, { status: 301, headers: { location } });
}

// Not read in production (its CloudFront refuses the server), but kept working for when it is.
describe("DramaBox", () => {
  const ID = "41000102839";
  const read = (fetchImpl: typeof fetch) => readDramaBox(ID, theaterGet(fetchImpl, 15_000));
  const BOOK = {
    bookId: ID,
    bookName: "A Breath Away From Forever",
    cover: "https://thwztchapter.dramaboxdb.com/data/cppartner/4x1/41x0/410x0/41000102839/41000102839.jpg@w=360&h=640",
    introduction: "Five years ago, Callista Summers rescued Jeremiah Fuller when he was drugged.",
    chapterCount: 104,
    tags: ["Second Chance", "Single Mom"],
    typeTwoList: [
      { id: 261, name: "Counterattack", replaceName: "counterattack" },
      { id: 254, name: "Bitter Love", replaceName: "bitter-love" },
    ],
    simpleLanguage: "en",
  };
  const CHAPTERS = [
    { index: 0, indexStr: "001", unlock: true },
    { index: 12, indexStr: "013", unlock: true },
    { index: 13, indexStr: "014", unlock: false },
    { index: 103, indexStr: "104", unlock: false },
  ];
  const page = (book: unknown, chapterList: unknown = CHAPTERS) =>
    `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { bookInfo: book, chapterList } },
    })}</script></body></html>`;

  it("reads the drama as the page shows it, with its genres before its tags", async () => {
    const { fetchImpl, seen } = site(html(page(BOOK)));
    expect(await read(fetchImpl)).toEqual({
      platform: "dramabox",
      dramaId: ID,
      title: "A Breath Away From Forever",
      language: "en",
      episodes: 104,
      paid: true,
      // index 13 is episode 14
      payStart: 14,
      synopsis: "Five years ago, Callista Summers rescued Jeremiah Fuller when he was drugged.",
      tags: ["Counterattack", "Bitter Love", "Second Chance", "Single Mom"],
      audience: "female",
      genre: "counterattack",
      coverUrl: BOOK.cover,
    });
    expect(seen.map((request) => request.url)).toEqual([`https://www.dramabox.com/drama/${ID}/x`]);
  });

  it("infers 频道 only for an English drama whose known genre ids agree", () => {
    const male = [{ id: 189, name: "Urban", replaceName: "urban" }];
    expect(parseDramaBoxPage(page({ ...BOOK, typeTwoList: male }))?.audience).toBe("male");
    expect(parseDramaBoxPage(page({ ...BOOK, typeTwoList: male, simpleLanguage: "es" }))).toMatchObject({
      audience: null,
      language: "es",
    });
    const mixed = [...male, { id: 254, name: "Bitter Love", replaceName: "bitter-love" }];
    expect(parseDramaBoxPage(page({ ...BOOK, typeTwoList: mixed }))?.audience).toBeNull();
    expect(parseDramaBoxPage(page({ ...BOOK, typeTwoList: [{ id: 9999, name: "New" }] }))).toMatchObject({
      audience: null,
      genre: "new",
    });
  });

  it("does not call a drama free because no episode on the page is locked", () => {
    expect(parseDramaBoxPage(page(BOOK, [{ index: 0, unlock: true }]))).toMatchObject({ paid: null, payStart: null });
    expect(parseDramaBoxPage(page(BOOK, "nope"))).toMatchObject({ paid: null, payStart: null });
  });

  it("refuses a page for another drama or none", async () => {
    expect(await read(site(html(page({ ...BOOK, bookId: "41000000001" }))).fetchImpl)).toBeNull();
    expect(await read(site(html(page(null))).fetchImpl)).toBeNull();
    expect(await read(site(html("<html>gone</html>", 404)).fetchImpl)).toBeNull();
    expect(await read(site(redirect("https://dramabox.evil.example/x")).fetchImpl)).toBeNull();
  });
});

/** Writes a value the way Nuxt's devalue does: every object value and array item is an index into the array. */
class NuxtPayload {
  readonly entries: unknown[] = [];

  add(value: unknown): number {
    const at = this.entries.length;
    this.entries.push(null);
    if (value instanceof Reactive) {
      this.entries[at] = ["ShallowReactive", this.add(value.value)];
    } else if (Array.isArray(value)) {
      this.entries[at] = value.map((item) => this.add(item));
    } else if (typeof value === "object" && value !== null) {
      this.entries[at] = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.add(item)]));
    } else {
      this.entries[at] = value;
    }
    return at;
  }
}

class Reactive {
  readonly value: unknown;

  constructor(value: unknown) {
    this.value = value;
  }
}

describe("StardustTV", () => {
  const ID = "23560";
  const INFO = {
    id: 23560,
    english_name: "Blood Throne",
    intro: "Eternal Night falls. Vampires rule; humans are prey.",
    is_pay: 1,
    episode_total: 40,
    cover_path: "https://assets.stardusttv.cc/uploadfile/20260929/963517332694142976.jpg",
    labels: [
      { english_name: "Male", name: "男频", level: 1 },
      { english_name: "Rags to Riches", name: "逆袭", level: 2 },
      { english_name: "Fantasy", name: "幻想", level: 2 },
      { english_name: "Underdog Rise", name: "草根逆袭", level: 3 },
      { english_name: "Vampire", name: "吸血鬼", level: 5 },
      { english_name: "", name: "空", level: 4 },
    ],
  };
  const page = (data: Record<string, unknown>, errors: Record<string, unknown> = {}) => {
    const payload = new NuxtPayload();
    payload.add(new Reactive({ data: new Reactive(data), state: {}, _errors: new Reactive(errors) }));
    return `<html><body><script type="application/json" data-nuxt-data="nuxt-app" id="__NUXT_DATA__">${JSON.stringify(
      payload.entries,
    )}</script></body></html>`;
  };
  const DATA = { [`episodes-data-${ID}`]: { video_info: INFO, start_pay_num: 10, video_language: "en_US" } };

  it("reads the drama from the page's devalue payload, 频道 and genre from its label levels", async () => {
    const { fetchImpl, seen } = site(html(page(DATA)));
    expect(await fetchTheaterDetails("stardusttv", ID, fetchImpl)).toEqual({
      platform: "stardusttv",
      dramaId: ID,
      title: "Blood Throne",
      language: "en",
      episodes: 40,
      paid: true,
      payStart: 10,
      synopsis: "Eternal Night falls. Vampires rule; humans are prey.",
      tags: ["Rags to Riches", "Fantasy", "Underdog Rise", "Vampire"],
      audience: "male",
      genre: "rags-to-riches",
      coverUrl: INFO.cover_path,
    });
    expect(seen.map((request) => request.url)).toEqual([`https://www.stardusttv.net/episodes/01-x-${ID}`]);
  });

  it("tells a free drama from one it cannot say", () => {
    const with_ = (info: Record<string, unknown>) =>
      parseStardustTvPage(page({ [`episodes-data-${ID}`]: { video_info: { ...INFO, ...info }, video_language: "es_ES" } }), ID);
    expect(with_({ is_pay: 0 })).toMatchObject({ paid: false, payStart: null, language: "es" });
    expect(with_({ is_pay: 1, start_pay_num: 12 })).toMatchObject({ paid: true, payStart: 12 });
    expect(with_({ is_pay: "1", labels: [{ english_name: "Female", name: "女频", level: 1 }] })).toMatchObject({
      paid: null,
      audience: "female",
      genre: null,
      tags: [],
    });
  });

  it("gives null for the 200 page the site serves for an id it does not have", () => {
    expect(parseStardustTvPage(page({}, { [`episodes-data-${ID}`]: { statusCode: 500 } }), ID)).toBeNull();
    expect(parseStardustTvPage(page(DATA), "23561")).toBeNull();
    expect(parseStardustTvPage(page({ [`episodes-data-${ID}`]: { video_info: { ...INFO, id: 1 } } }), ID)).toBeNull();
    expect(parseStardustTvPage("<html>no payload</html>", ID)).toBeNull();
    expect(parseStardustTvPage('<script id="__NUXT_DATA__">[1,</script>', ID)).toBeNull();
  });

  it("does not loop on a payload that points at itself", () => {
    const loop = `<script id="__NUXT_DATA__" type="application/json">${JSON.stringify([["ShallowReactive", 0]])}</script>`;
    expect(parseStardustTvPage(loop, ID)).toBeNull();
  });
});

describe("MoboReels", () => {
  const ID = "107617322";
  const SERIES = {
    seriesId: 107617322,
    language: 3,
    coverUrl: "https://video-cdn3.cdreader.com//backend/1640191791625380233.webp",
    allEpis: 50,
    payEpisFrom: 11,
    seriesName: "Back With The Fairy Lord's Twins",
    description: "Five years ago, human princess Luna was abandoned by her fairy ex-husband Drake.",
    types: ["Western Fantasy", "Elf"],
    typeItemVOList: [
      { typeIdStr: "128847309600196401", typeName: "Western Fantasy" },
      { typeIdStr: "214760562578869735", typeName: "Elf" },
    ],
  };
  const answer = (seriesVO: unknown) => ({ code: 200, message: "success", data: { seriesVO } });

  it("asks the site's own series API and reads the drama it answers", async () => {
    const { fetchImpl, seen } = site(json(answer(SERIES)));
    expect(await fetchTheaterDetails("moboreels", ID, fetchImpl)).toEqual({
      platform: "moboreels",
      dramaId: ID,
      title: "Back With The Fairy Lord's Twins",
      language: "en",
      episodes: 50,
      paid: true,
      payStart: 11,
      synopsis: "Five years ago, human princess Luna was abandoned by her fairy ex-husband Drake.",
      tags: ["Western Fantasy", "Elf"],
      audience: null,
      genre: null,
      coverUrl: SERIES.coverUrl,
    });
    expect(seen).toEqual([
      {
        url: "https://videoapi-hk.cdreader.com/video/h5/series/homeSeriesDetail",
        method: "POST",
        body: JSON.stringify({ langId: 3, seriesId: 107617322, episNum: 1 }),
      },
    ]);
  });

  it("knows the site's language ids and leaves an unknown one empty", () => {
    expect(parseMoboReelsSeries(answer({ ...SERIES, language: 4 }), ID)?.language).toBe("es");
    expect(parseMoboReelsSeries(answer({ ...SERIES, language: 2 }), ID)?.language).toBe("zh-TW");
    expect(parseMoboReelsSeries(answer({ ...SERIES, language: 99 }), ID)?.language).toBeNull();
    expect(parseMoboReelsSeries(answer({ ...SERIES, payEpisFrom: 0 }), ID)).toMatchObject({ paid: null, payStart: null });
  });

  it("gives null for an unknown id, another drama, an error or a redirect", async () => {
    expect(parseMoboReelsSeries({ code: 200, message: "success", data: {} }, ID)).toBeNull();
    expect(parseMoboReelsSeries(answer({ ...SERIES, seriesId: 1 }), ID)).toBeNull();
    expect(parseMoboReelsSeries({ code: 500, data: { seriesVO: SERIES } }, ID)).toBeNull();
    const moved = site(redirect("https://videoapi-hk.cdreader.com/elsewhere"), json(answer(SERIES)));
    expect(await fetchTheaterDetails("moboreels", ID, moved.fetchImpl)).toBeNull();
    expect(moved.seen).toHaveLength(1);
    expect(await fetchTheaterDetails("moboreels", ID, site(html("<html></html>")).fetchImpl)).toBeNull();
  });
});

describe("NetShort", () => {
  const ID = "2112388670085812226";
  const TITLE = "The Dragon's Silly Captive";
  const DETAIL = {
    shortPlayId: ID,
    shortPlayName: TITLE,
    shortPlayCover:
      "https://awscover.netshort.com/tos-vod-mya-v-da59d5a2040f5f77/coverG/prod/1793785791067_3比4.jpg~tplv-vod-noop.image",
    shortPlayLabels: {
      "Substitute Bride": "/drama/Substitute%20Bride-1983832092044419074",
      "Contract Lovers": "/drama/Contract%20Lovers-1983832091947950083",
      "Alternate History": "/drama/Alternate%20History-1983832090932928513",
    },
    shotIntroduce: "Sylph, a simple-minded girl, is forced to wed Astur in her sister's place.",
    videoEpisodeInfos: [
      { episodeNo: 1, isLock: false },
      { episodeNo: 8, isLock: false },
      { episodeNo: 9, isLock: true },
      { episodeNo: 40, isLock: true },
    ],
    language: "en_US",
  };
  const DESCRIPTION = `Watch ${TITLE} full episodes online. Movies in Fantasy,Contract Lovers,Substitute Bride,Alternate History,Sweet Romance,All Ages,Young Adult. Free to start from EP 1 on NetShort.`;
  /** The app-router stream, split across two pushes the way the site splits it. */
  const page = (detail: unknown, description = DESCRIPTION) => {
    const stream = `5:["$","div",null,{"data":{"shortPlayDetailVo":${JSON.stringify(detail)},"other":{"a":"}"}}}]\n`;
    const cut = Math.floor(stream.length / 2);
    const push = (chunk: string) => `<script>self.__next_f.push([1,${JSON.stringify(chunk)}])</script>`;
    return `<html><head><meta name="description" content="${description.replace(/'/g, "&#x27;")}"/></head><body>${push(
      stream.slice(0, cut),
    )}${push(stream.slice(cut))}</body></html>`;
  };

  it("follows the site's redirect to the drama's slug and reads the streamed drama", async () => {
    const { fetchImpl, seen } = site(redirect(`/episode/the-dragons-silly-captive-${ID}`), html(page(DETAIL)));
    expect(await fetchTheaterDetails("netshort", ID, fetchImpl)).toEqual({
      platform: "netshort",
      dramaId: ID,
      title: TITLE,
      language: "en",
      episodes: 40,
      paid: true,
      payStart: 9,
      synopsis: "Sylph, a simple-minded girl, is forced to wed Astur in her sister's place.",
      // In the order the page lists them; the labels the drama object names are among them.
      tags: ["Fantasy", "Contract Lovers", "Substitute Bride", "Alternate History", "Sweet Romance", "All Ages", "Young Adult"],
      audience: null,
      genre: null,
      coverUrl:
        "https://awscover.netshort.com/tos-vod-mya-v-da59d5a2040f5f77/coverG/prod/1793785791067_3%E6%AF%944.jpg~tplv-vod-noop.image",
    });
    expect(seen.map((request) => request.url)).toEqual([
      `https://netshort.com/episode/x-${ID}`,
      `https://netshort.com/episode/the-dragons-silly-captive-${ID}`,
    ]);
  });

  it("keeps the drama's own labels when the page's sentence is missing, and never a tag naming the title", () => {
    expect(parseNetShortPage(page(DETAIL, "Something else entirely."), ID)?.tags).toEqual([
      "Substitute Bride",
      "Contract Lovers",
      "Alternate History",
    ]);
    const odd = `Movies in ${TITLE} full movie,Fantasy & Magic. Free to start`;
    expect(parseNetShortPage(page(DETAIL, odd), ID)?.tags).toEqual([
      "Fantasy & Magic",
      "Substitute Bride",
      "Contract Lovers",
      "Alternate History",
    ]);
  });

  it("does not call a drama free because no episode on the page is locked", () => {
    const open = { ...DETAIL, videoEpisodeInfos: [{ episodeNo: 1, isLock: false }, { episodeNo: 2, isLock: false }] };
    expect(parseNetShortPage(page(open), ID)).toMatchObject({ episodes: 2, paid: null, payStart: null });
  });

  it("gives null for a missing drama, another drama, or a redirect off the site", async () => {
    expect(await fetchTheaterDetails("netshort", ID, site(html("<html>404</html>", 404)).fetchImpl)).toBeNull();
    expect(parseNetShortPage(page({ ...DETAIL, shortPlayId: "2112388670085812227" }), ID)).toBeNull();
    expect(parseNetShortPage("<html>no stream</html>", ID)).toBeNull();
    expect(parseNetShortPage('<script>self.__next_f.push([1,"{\\"shortPlayDetailVo\\":{\\"shortPlayId\\":"])</script>', ID)).toBeNull();
    expect(await fetchTheaterDetails("netshort", ID, site(redirect("https://evil.example/episode/x")).fetchImpl)).toBeNull();
    expect(await fetchTheaterDetails("netshort", ID, site(redirect("http://netshort.com/episode/x")).fetchImpl)).toBeNull();
  });
});

describe("YourChannel", () => {
  const ID = "376265469448953856";
  const PLAYLET = {
    id: ID,
    title: "My President, My Love",
    description: "Linda, America's first female president, is tormented by the accidental bombing.",
    coverImage: "https://images.yourwebnovel.com/playlet/cover/1793775867401-nqerrj.jpg",
    episodeCount: 31,
    tags: "Drama,Modern Romance,Revenge",
    beginFeeNo: 8,
    localeCode: "en-US",
  };
  const answer = (playlet: unknown) => ({ success: true, message: "", code: 200, result: { playlet } });

  it("asks the site's own playlet API and reads the drama it answers", async () => {
    const { fetchImpl, seen } = site(json(answer(PLAYLET)));
    expect(await fetchTheaterDetails("yourchannel", ID, fetchImpl)).toEqual({
      platform: "yourchannel",
      dramaId: ID,
      title: "My President, My Love",
      language: "en",
      episodes: 31,
      paid: true,
      payStart: 8,
      synopsis: "Linda, America's first female president, is tormented by the accidental bombing.",
      tags: ["Drama", "Modern Romance", "Revenge"],
      audience: null,
      genre: null,
      coverUrl: PLAYLET.coverImage,
    });
    expect(seen.map((request) => [request.method, request.url])).toEqual([
      ["GET", `https://yourchannel.ai/yourchannel/app/playlet/v4/${ID}`],
    ]);
  });

  it("takes a playlet without a first paid episode as free, as its player does", () => {
    expect(parseYourChannelPlaylet(answer({ ...PLAYLET, beginFeeNo: null }), ID)).toMatchObject({ paid: false, payStart: null });
    expect(parseYourChannelPlaylet(answer({ ...PLAYLET, beginFeeNo: undefined }), ID)).toMatchObject({ paid: false });
    expect(parseYourChannelPlaylet(answer({ ...PLAYLET, beginFeeNo: "8" }), ID)).toMatchObject({ paid: null });
  });

  it("gives null for an unknown id or another drama, and never reads the id as a number", () => {
    expect(parseYourChannelPlaylet({ success: false, code: 500, message: "not found", result: null }, ID)).toBeNull();
    expect(parseYourChannelPlaylet(answer({ ...PLAYLET, id: Number(ID) }), ID)).toBeNull();
    expect(parseYourChannelPlaylet(answer({ ...PLAYLET, id: "376265469448953857" }), ID)).toBeNull();
  });
});

describe("the shared readers", () => {
  it("writes a site's language code the way the task center does", () => {
    expect(["en_US", "en-US", "EN", "es_ES", "pt-BR", "zh_TW", "zh-Hant", "zh-CN", "in", "", "english", "12"].map(languageCode)).toEqual([
      "en", "en", "en", "es", "pt", "zh-TW", "zh-TW", "zh", "id", null, null, null,
    ]);
  });

  it("makes a genre slug the dramas table takes, or nothing", () => {
    expect(["Rags to Riches", "bitter-love", "Love & Revenge", "Female", "爱情", "x".repeat(40)].map(genreSlug)).toEqual([
      "rags-to-riches", "bitter-love", "love-and-revenge", null, null, null,
    ]);
  });
});
