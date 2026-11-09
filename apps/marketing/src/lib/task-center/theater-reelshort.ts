// @input  -- a ReelShort book id 北斗 gave; www.reelshort.com/movie/x-<id> through theater-http.ts
// @output -- the drama as that page shows it (tags in the page's language, 女频/男频 and a genre slug by tag id), or null; the page's link
// @pos    -- ReelShort's reader for theater-details.ts
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
//
// ReelShort serves every drama at /movie/<anything>-<book id> and redirects an
// old id to the drama it now is (2026-11-08: both 北斗 ids of "Lazos rotos de
// los hermanos fae" land on 6ad88d9e…). The page is a Next.js page; the drama
// is in __NEXT_DATA__ at props.pageProps.data. Its tag_list carries tags in the
// page's language, each with an id and a category that are the same in every
// language (676d…663 is "Female" on the English site and "Mujer" on the
// Spanish one). Categories seen on 130 pages that day:
//   1000 audience (Female/Male/LGBTQ/All)  -> 频道, not a tag
//   1001, 1005 actor and actress names     -> left out
//   1010 genre (Romance, Fantasy, …)       -> the genre slug by id, and a tag
//   everything else (sub-genre, character, trope, mood, setting, place, era,
//   age rating, region)                    -> tags, in page order
// The page's `tag` list (its themes) comes after them.

import type { DramaAudience } from "./contracts.ts";
import {
  count,
  field,
  httpsUrl,
  languageCode,
  list,
  MAX_TAGS_READ,
  nextData,
  text,
  type TheaterDetails,
  type TheaterGet,
} from "./theater-http.ts";

const HOST = "www.reelshort.com";
export const REELSHORT_ID = /^[0-9a-f]{24}$/;

const AUDIENCE_CATEGORY = "1000";
const GENRE_CATEGORY = "1010";
const CAST_CATEGORIES: ReadonlySet<string> = new Set(["1001", "1005"]);
const AUDIENCE_TAGS: ReadonlyMap<string, DramaAudience> = new Map([
  ["676d21074582b53a14081663", "female"],
  ["676d21074582b53a14081664", "male"],
]);
/** Every category-1010 tag seen on 130 English pages on 2026-11-08. */
const GENRE_TAGS: ReadonlyMap<string, string> = new Map([
  ["676d210c4582b53a140819bb", "comedy"],
  ["676d210c4582b53a140819bf", "fantasy"],
  ["676d210c4582b53a140819c0", "sports"],
  ["676d210c4582b53a140819c1", "romance"],
  ["676d210c4582b53a140819c2", "drama"],
  ["676d210c4582b53a140819c4", "animation"],
]);

export function reelShortPageUrl(id: string): string {
  return `https://${HOST}/movie/x-${id}`;
}

export async function readReelShort(id: string, get: TheaterGet): Promise<TheaterDetails | null> {
  const html = await get({ url: reelShortPageUrl(id), hosts: [HOST], accept: "html" });
  // An old id redirects to the drama it now is, so the page's id is not checked against it.
  return html === null ? null : parseReelShortPage(html);
}

/** A ReelShort drama page read field by field: a field it cannot read is null, a tag it cannot read is skipped. */
export function parseReelShortPage(html: string): TheaterDetails | null {
  const data = field(field(field(nextData(html), "props"), "pageProps"), "data");
  const dramaId = text(field(data, "book_id"));
  if (dramaId === null || !REELSHORT_ID.test(dramaId)) return null;

  const isPaid = field(data, "is_paid");
  const paid = isPaid === 1 ? true : isPaid === 0 ? false : null;

  let audience: DramaAudience | null = null;
  let genre: string | null = null;
  const tags: string[] = [];
  for (const tag of list(field(data, "tag_list")).slice(0, MAX_TAGS_READ)) {
    const id = text(field(tag, "id"));
    const category = text(field(tag, "category_id"));
    const name = text(field(tag, "text"));
    if (id === null || category === null || name === null) continue;
    if (category === AUDIENCE_CATEGORY) {
      audience ??= AUDIENCE_TAGS.get(id) ?? null;
      continue;
    }
    if (CAST_CATEGORIES.has(category)) continue;
    if (category === GENRE_CATEGORY) {
      const known = GENRE_TAGS.get(id);
      if (known === undefined) console.error("[drama lookup] ReelShort genre tag not mapped yet", id);
      genre ??= known ?? null;
    }
    tags.push(name);
  }
  for (const theme of list(field(data, "tag")).slice(0, MAX_TAGS_READ)) {
    const name = text(theme);
    if (name !== null) tags.push(name);
  }

  return {
    platform: "reelshort",
    dramaId,
    title: text(field(data, "book_title")),
    language: languageCode(field(data, "lang")),
    episodes: count(field(data, "total")),
    paid,
    payStart: paid === true ? count(field(data, "paid_start")) : null,
    synopsis: text(field(data, "special_desc")),
    tags,
    audience,
    genre,
    coverUrl: httpsUrl(field(data, "book_pic")),
  };
}
