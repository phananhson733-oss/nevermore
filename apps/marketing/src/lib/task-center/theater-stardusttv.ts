// @input  -- a StardustTV video id 北斗 gave; www.stardusttv.net/episodes/01-x-<id> through theater-http.ts
// @output -- the drama as that page shows it (its labels below 频道 as tags, 女频/男频 and the genre slug from its own label levels, pay start), or null after a second try; the page's link
// @pos    -- StardustTV's reader for theater-details.ts
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
//
// StardustTV is a Nuxt 3 site (2026-11-08). For an id it does not have,
// /episodes/01-x-<id> answers with an `_errors` entry instead of data (a 200
// page earlier that day, a 404 "not available in this region" later). Its own
// server also fails now and then for a drama it has: 3 of 20 tries from the
// production server got a 200 page whose entry is a 500 "[nuxt] instance
// unavailable", or a 404. From outside the two look alike, so a page without
// the drama is asked for once more, within the same deadline.
// The page's state is the `__NUXT_DATA__` script: a devalue array where every
// object value and array item is the index of another entry, and reactive
// wrappers are ["ShallowReactive", index]. The drama sits at
// data["episodes-data-<id>"]: video_info has the drama, start_pay_num and
// video_language sit next to it. video_info.labels are leveled: level 1 is
// 频道 (name 男频 / 女频), level 2 the genres, deeper levels themes and
// tropes. Their english_name is what the English site shows.

import type { DramaAudience } from "./contracts.ts";
import {
  count,
  field,
  genreSlug,
  httpsUrl,
  languageCode,
  list,
  MAX_TAGS_READ,
  scriptJson,
  text,
  type TheaterDetails,
  type TheaterGet,
} from "./theater-http.ts";

const HOST = "www.stardusttv.net";
export const STARDUSTTV_ID = /^[0-9]{1,12}$/;
const AUDIENCES: ReadonlyMap<string, DramaAudience> = new Map([
  ["男频", "male"],
  ["女频", "female"],
]);
const WRAPPERS: ReadonlySet<string> = new Set(["ShallowReactive", "Reactive", "ShallowRef", "Ref"]);

export function stardustTvPageUrl(id: string): string {
  return `https://${HOST}/episodes/01-x-${id}`;
}

/** One try and one more: the site's own failures come and go between requests. */
const ATTEMPTS = 2;

export async function readStardustTv(id: string, get: TheaterGet): Promise<TheaterDetails | null> {
  if (!STARDUSTTV_ID.test(id)) return null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const html = await get({ url: stardustTvPageUrl(id), hosts: [HOST], accept: "html" });
    const details = html === null ? null : parseStardustTvPage(html, id);
    if (details !== null) return details;
  }
  return null;
}

/** The page for one id, read field by field; null when the page has no such drama. */
export function parseStardustTvPage(html: string, id: string): TheaterDetails | null {
  if (!STARDUSTTV_ID.test(id)) return null;
  const raw = scriptJson(html, "__NUXT_DATA__");
  if (!Array.isArray(raw)) return null;
  const nuxt = new Devalue(raw);
  const key = `episodes-data-${id}`;
  const root = nuxt.at(0);
  const error = nuxt.get(nuxt.get(root, "_errors"), key);
  if (typeof error === "object" && error !== null) return null;
  const episodes = nuxt.get(nuxt.get(root, "data"), key);
  const info = nuxt.get(episodes, "video_info");
  if (nuxt.get(info, "id") !== Number(id)) return null;

  let audience: DramaAudience | null = null;
  let genre: string | null = null;
  const tags: string[] = [];
  for (const label of nuxt.items(nuxt.get(info, "labels"), MAX_TAGS_READ)) {
    const level = nuxt.get(label, "level");
    const name = text(nuxt.get(label, "english_name"));
    if (level === 1) {
      audience ??= AUDIENCES.get(text(nuxt.get(label, "name")) ?? "") ?? null;
      continue;
    }
    if (name === null || typeof level !== "number" || level < 2) continue;
    if (level === 2) genre ??= genreSlug(name);
    tags.push(name);
  }

  const isPay = nuxt.get(info, "is_pay");
  const paid = isPay === 1 ? true : isPay === 0 ? false : null;
  return {
    platform: "stardusttv",
    dramaId: id,
    title: text(nuxt.get(info, "english_name")),
    language: languageCode(nuxt.get(episodes, "video_language")),
    episodes: count(nuxt.get(info, "episode_total")),
    paid,
    payStart: paid === true ? count(nuxt.get(episodes, "start_pay_num") ?? nuxt.get(info, "start_pay_num")) : null,
    synopsis: text(nuxt.get(info, "intro")),
    tags,
    audience,
    genre,
    coverUrl: httpsUrl(nuxt.get(info, "cover_path")),
  };
}

/**
 * Reads a devalue array one step at a time, so nothing is resolved that is
 * not asked for and a cycle cannot loop. A returned object or array still
 * holds indices; get and items follow them.
 */
class Devalue {
  private readonly entries: readonly unknown[];

  constructor(entries: readonly unknown[]) {
    this.entries = entries;
  }

  /** The entry at an index, through reactive wrappers; undefined for devalue's negative specials. */
  at(index: unknown): unknown {
    let value: unknown = undefined;
    let at = index;
    for (let unwrap = 0; unwrap < 8; unwrap += 1) {
      if (typeof at !== "number" || !Number.isInteger(at) || at < 0 || at >= this.entries.length) return undefined;
      value = this.entries[at];
      const head: unknown = Array.isArray(value) ? value[0] : undefined;
      if (typeof head !== "string" || !WRAPPERS.has(head)) return value;
      at = (value as readonly unknown[])[1];
    }
    return undefined;
  }

  get(object: unknown, key: string): unknown {
    const index = field(object, key);
    return index === undefined ? undefined : this.at(index);
  }

  items(array: unknown, max: number): readonly unknown[] {
    return list(array)
      .slice(0, max)
      .map((index) => this.at(index));
  }
}
