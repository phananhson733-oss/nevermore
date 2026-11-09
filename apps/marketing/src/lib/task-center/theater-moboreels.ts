// @input  -- a MoboReels series id 北斗 gave; the series API the site's own drama page calls, through theater-http.ts
// @output -- the drama as the site shows it (its types as tags, first paid episode), or null; the page's link
// @pos    -- MoboReels's reader for theater-details.ts
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
//
// www.moboreels.com/drama/<slug>-<id> is a Nuxt 2 page whose state is a script
// to evaluate, which this reader does not do. The page gets the drama from
// videoapi-hk.cdreader.com/video/h5/series/homeSeriesDetail (a plain JSON
// POST, 2026-11-08), and so does this. data.seriesVO has the drama in its own
// language; an unknown id gives `data: {}`. language is the site's numeric
// language id (the page's language menu lists them). typeItemVOList are its
// types, which mix genre and tropes, so none of them is taken as the genre,
// and the site has no 女频/男频.

import {
  count,
  field,
  httpsUrl,
  list,
  MAX_TAGS_READ,
  parseJson,
  text,
  type TheaterDetails,
  type TheaterGet,
} from "./theater-http.ts";

const API_HOST = "videoapi-hk.cdreader.com";
const SITE_HOST = "www.moboreels.com";
export const MOBOREELS_ID = /^[0-9]{1,12}$/;
/** The site's language menu on 2026-11-08: its id for each language. */
const LANGUAGES: Readonly<Record<number, string>> = {
  1: "zh", 2: "zh-TW", 3: "en", 4: "es", 5: "pt", 6: "fr", 7: "ru", 8: "it", 9: "ja", 10: "ar", 11: "id",
  12: "th", 13: "vi", 14: "ko", 15: "fil", 16: "de", 17: "hi", 21: "ms", 22: "tr", 23: "pl",
};
/** English: the language of the API's own messages, not the drama's. */
const API_LANGUAGE = 3;

export function moboReelsPageUrl(id: string): string {
  return `https://${SITE_HOST}/drama/x-${id}`;
}

export async function readMoboReels(id: string, get: TheaterGet): Promise<TheaterDetails | null> {
  if (!MOBOREELS_ID.test(id)) return null;
  const body = await get({
    url: `https://${API_HOST}/video/h5/series/homeSeriesDetail`,
    hosts: [API_HOST],
    accept: "json",
    json: { langId: API_LANGUAGE, seriesId: Number(id), episNum: 1 },
  });
  return parseMoboReelsSeries(parseJson(body), id);
}

export function parseMoboReelsSeries(answer: unknown, id: string): TheaterDetails | null {
  if (field(answer, "code") !== 200) return null;
  const series = field(field(answer, "data"), "seriesVO");
  const seriesId = field(series, "seriesId");
  if (typeof seriesId !== "number" || String(seriesId) !== id) return null;

  const tags: string[] = [];
  for (const type of list(field(series, "typeItemVOList")).slice(0, MAX_TAGS_READ)) {
    const name = text(field(type, "typeName"));
    if (name !== null) tags.push(name);
  }
  const language = field(series, "language");
  const payStart = count(field(series, "payEpisFrom"));
  return {
    platform: "moboreels",
    dramaId: id,
    title: text(field(series, "seriesName")),
    language: typeof language === "number" ? (LANGUAGES[language] ?? null) : null,
    episodes: count(field(series, "allEpis")),
    // No pay start is not taken to mean free.
    paid: payStart === null ? null : true,
    payStart,
    synopsis: text(field(series, "description")),
    tags,
    audience: null,
    genre: null,
    coverUrl: httpsUrl(field(series, "coverUrl")),
  };
}
