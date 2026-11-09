// @input  -- a YourChannel playlet id 北斗 gave; the playlet API the site's own player page calls, through theater-http.ts
// @output -- the drama as the site shows it (its tags, first paid episode or all free), or null; the page's link
// @pos    -- YourChannel's reader for theater-details.ts
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
//
// yourchannel.ai's player page is a client-side app; it reads the drama from
// /yourchannel/app/playlet/v4/<id> (JSON, no sign-in, 2026-11-08). An id it
// does not have gives success false. result.playlet has the drama; tags is a
// comma-separated string in the site's language; beginFeeNo is the first paid
// episode and the player treats a playlet without one as free. Ids are 18
// digits, so they stay strings. The site has no 女频/男频 and no genre apart
// from its tags.

import {
  count,
  field,
  httpsUrl,
  languageCode,
  MAX_TAGS_READ,
  parseJson,
  text,
  type TheaterDetails,
  type TheaterGet,
} from "./theater-http.ts";

const HOST = "yourchannel.ai";
export const YOURCHANNEL_ID = /^[0-9]{10,20}$/;

export function yourChannelPageUrl(id: string): string {
  return `https://${HOST}/pagesSub/player?id=${id}&type=shotDrama`;
}

export async function readYourChannel(id: string, get: TheaterGet): Promise<TheaterDetails | null> {
  if (!YOURCHANNEL_ID.test(id)) return null;
  const body = await get({ url: `https://${HOST}/yourchannel/app/playlet/v4/${id}`, hosts: [HOST], accept: "json" });
  return parseYourChannelPlaylet(parseJson(body), id);
}

export function parseYourChannelPlaylet(answer: unknown, id: string): TheaterDetails | null {
  if (field(answer, "success") !== true || field(answer, "code") !== 200) return null;
  const playlet = field(field(answer, "result"), "playlet");
  if (field(playlet, "id") !== id) return null;

  const tags = (text(field(playlet, "tags")) ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "")
    .slice(0, MAX_TAGS_READ);
  const begin = field(playlet, "beginFeeNo");
  const payStart = count(begin);
  return {
    platform: "yourchannel",
    dramaId: id,
    title: text(field(playlet, "title")),
    language: languageCode(field(playlet, "localeCode")),
    episodes: count(field(playlet, "episodeCount")),
    paid: payStart !== null ? true : begin === null || begin === undefined ? false : null,
    payStart,
    synopsis: text(field(playlet, "description")),
    tags,
    audience: null,
    genre: null,
    coverUrl: httpsUrl(field(playlet, "coverImage")),
  };
}
