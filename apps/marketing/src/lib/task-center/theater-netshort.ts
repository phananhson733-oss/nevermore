// @input  -- a NetShort short play id 北斗 gave; netshort.com/episode/x-<id> through theater-http.ts
// @output -- the drama as that page shows it (its categories as tags, the first locked episode), or null; the page's link
// @pos    -- NetShort's reader for theater-details.ts
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
//
// NetShort redirects /episode/<anything>-<id> to the drama's own slug and
// answers 404 for an id it does not have (2026-11-08). It is a Next.js
// app-router page: its data is streamed in self.__next_f.push([1,"…"])
// scripts, and the drama is the object after "shortPlayDetailVo". That object
// names only some of the drama's categories (shortPlayLabels); the page shows
// all of them in its description, "… Movies in A,B,C. Free to start …", so
// those come first when the page has that sentence. The cover URL carries
// raw non-ASCII ("3比4") and is stored encoded. The site has no 女频/男频 and
// does not say which category is the genre.

import {
  count,
  field,
  httpsUrl,
  languageCode,
  list,
  MAX_TAGS_READ,
  parseJson,
  text,
  type TheaterDetails,
  type TheaterGet,
} from "./theater-http.ts";

const HOSTS: readonly string[] = ["netshort.com", "www.netshort.com"];
export const NETSHORT_ID = /^[0-9]{10,20}$/;
const MAX_TAG_LENGTH = 40;

export function netShortPageUrl(id: string): string {
  return `https://netshort.com/episode/x-${id}`;
}

export async function readNetShort(id: string, get: TheaterGet): Promise<TheaterDetails | null> {
  const html = await get({ url: netShortPageUrl(id), hosts: HOSTS, accept: "html" });
  return html === null ? null : parseNetShortPage(html, id);
}

const PUSH = 'self.__next_f.push([1,"';
const DETAIL_KEY = '"shortPlayDetailVo":';
const CATEGORIES_START = "Movies in ";
const CATEGORIES_END = ". Free to start";
const MAX_CATEGORIES_LENGTH = 400;

export function parseNetShortPage(html: string, id: string): TheaterDetails | null {
  const flight = flightText(html);
  const at = flight.indexOf(DETAIL_KEY);
  const detail = at < 0 ? undefined : parseJson(jsonObjectAt(flight, at + DETAIL_KEY.length));
  if (text(field(detail, "shortPlayId")) !== id) return null;

  const title = text(field(detail, "shortPlayName"));
  const labelLinks = field(detail, "shortPlayLabels");
  const labels = typeof labelLinks === "object" && labelLinks !== null && !Array.isArray(labelLinks) ? Object.keys(labelLinks) : [];
  const shown = unescapeHtml(categoriesShown(html)).split(",");
  const lowerTitle = title?.toLowerCase() ?? null;
  const tags = new Set<string>();
  for (const raw of [...shown.slice(0, MAX_TAGS_READ), ...labels.slice(0, MAX_TAGS_READ)]) {
    const tag = raw.trim();
    if (tag === "" || tag.length > MAX_TAG_LENGTH) continue;
    if (lowerTitle !== null && tag.toLowerCase().includes(lowerTitle)) continue;
    tags.add(tag);
  }

  let episodes: number | null = null;
  let payStart: number | null = null;
  for (const episode of list(field(detail, "videoEpisodeInfos"))) {
    const number = count(field(episode, "episodeNo"));
    if (number === null) continue;
    episodes = Math.max(episodes ?? 0, number);
    if (field(episode, "isLock") === true && (payStart === null || number < payStart)) payStart = number;
  }
  return {
    platform: "netshort",
    dramaId: id,
    title,
    language: languageCode(field(detail, "language")),
    episodes,
    // A drama with no locked episode on the page is not said to be free.
    paid: payStart === null ? null : true,
    payStart,
    synopsis: text(field(detail, "shotIntroduce")),
    tags: [...tags],
    audience: null,
    genre: null,
    coverUrl: httpsUrl(field(detail, "shortPlayCover")),
  };
}

/** Every string pushed to the app-router stream, joined. Each search moves forward, so the page is read once. */
function flightText(html: string): string {
  let flight = "";
  let from = 0;
  for (;;) {
    const at = html.indexOf(PUSH, from);
    if (at < 0) return flight;
    const quote = at + PUSH.length - 1;
    const end = stringEnd(html, quote);
    if (end < 0) return flight;
    const chunk = parseJson(html.slice(quote, end + 1));
    if (typeof chunk === "string") flight += chunk;
    from = end + 1;
  }
}

/** The index of the quote closing the string literal that opens at `quote`, or -1. */
function stringEnd(source: string, quote: number): number {
  for (let at = quote + 1; at < source.length; at += 1) {
    const char = source[at];
    if (char === "\\") at += 1;
    else if (char === '"') return at;
  }
  return -1;
}

/** "A,B,C" from the page's first "Movies in A,B,C. Free to start", or "" when it has none. */
function categoriesShown(html: string): string {
  const at = html.indexOf(CATEGORIES_START);
  if (at < 0) return "";
  const start = at + CATEGORIES_START.length;
  const end = html.indexOf(CATEGORIES_END, start);
  if (end < 0 || end - start > MAX_CATEGORIES_LENGTH) return "";
  const shown = html.slice(start, end);
  return /["<>]/.test(shown) ? "" : shown;
}

/** The few entities a category name could carry in an attribute. */
function unescapeHtml(value: string): string {
  return value
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

/** The JSON object that starts at `start`, by matching braces outside strings; null when it does not close. */
function jsonObjectAt(source: string, start: number): string | null {
  if (source[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  for (let at = start; at < source.length; at += 1) {
    const char = source[at];
    if (inString) {
      if (char === "\\") at += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, at + 1);
    }
  }
  return null;
}
