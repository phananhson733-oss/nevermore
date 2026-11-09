// @input  -- a DramaBox book id 北斗 gave; www.dramabox.com/drama/<id>/x through theater-http.ts
// @output -- the drama as that page shows it (its genres then its tags, the genre slug, 女频/男频 inferred from its genre ids on the English site only, the first locked episode), or null; the page's link
// @pos    -- DramaBox's reader, switched off in theater-details.ts: its CloudFront answers the production server 403 (2026-11-08); the link there stays
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
//
// DramaBox serves a drama at /drama/<book id>/<any slug> (2026-11-08). It is a
// Next.js page; props.pageProps.bookInfo holds the drama, typeTwoList its
// genres ({id, name, replaceName}) and tags its tags, both in the page's
// language. props.pageProps.chapterList has every episode with a 0-based
// index and `unlock`: the first locked one is where paying starts.
//
// The page never says 女频 or 男频. DramaBox's English genre ids each belong to
// one of the two on its own genre listing: the table below is what a 183-book
// sample of that listing showed on 2026-11-08. Genre ids differ per language,
// so 频道 is only inferred for an English drama, and only when every genre id
// it has that the table knows agrees.

import type { DramaAudience } from "./contracts.ts";
import {
  count,
  field,
  genreSlug,
  httpsUrl,
  languageCode,
  list,
  MAX_TAGS_READ,
  nextData,
  text,
  type TheaterDetails,
  type TheaterGet,
} from "./theater-http.ts";

const HOST = "www.dramabox.com";
export const DRAMABOX_ID = /^[0-9]{6,20}$/;

const MALE_GENRES: readonly number[] = [
  160, 181, 184, 185, 187, 189, 192, 197, 202, 204, 207, 212, 218, 224, 226, 227, 278, 280, 281, 286, 288,
];
const FEMALE_GENRES: readonly number[] = [
  161, ...Array.from({ length: 276 - 248 + 1 }, (_, n) => 248 + n), 283, 291, 292, 498, 563, 567, 583, 676,
];
const ENGLISH_AUDIENCE: ReadonlyMap<number, DramaAudience> = new Map([
  ...MALE_GENRES.map((id) => [id, "male"] as const),
  ...FEMALE_GENRES.map((id) => [id, "female"] as const),
]);

export function dramaBoxPageUrl(id: string): string {
  return `https://${HOST}/drama/${id}/x`;
}

export async function readDramaBox(id: string, get: TheaterGet): Promise<TheaterDetails | null> {
  const html = await get({ url: dramaBoxPageUrl(id), hosts: [HOST], accept: "html" });
  const details = html === null ? null : parseDramaBoxPage(html);
  return details?.dramaId === id ? details : null;
}

export function parseDramaBoxPage(html: string): TheaterDetails | null {
  const props = field(field(nextData(html), "props"), "pageProps");
  const book = field(props, "bookInfo");
  const dramaId = text(field(book, "bookId"));
  if (dramaId === null || !DRAMABOX_ID.test(dramaId)) return null;
  const language = languageCode(field(book, "simpleLanguage"));

  const tags: string[] = [];
  let genre: string | null = null;
  const audiences = new Set<DramaAudience>();
  for (const type of list(field(book, "typeTwoList")).slice(0, MAX_TAGS_READ)) {
    const name = text(field(type, "name"));
    if (name === null) continue;
    tags.push(name);
    genre ??= genreSlug(field(type, "replaceName")) ?? genreSlug(name);
    const id = field(type, "id");
    const audience = typeof id === "number" ? ENGLISH_AUDIENCE.get(id) : undefined;
    if (audience !== undefined) audiences.add(audience);
  }
  for (const tag of list(field(book, "tags")).slice(0, MAX_TAGS_READ)) {
    const name = text(tag);
    if (name !== null) tags.push(name);
  }
  const [audience] = audiences;
  const chapters = list(field(props, "chapterList"));
  const locked = chapters.find((chapter) => field(chapter, "unlock") === false);
  const lockedIndex = field(locked, "index");

  return {
    platform: "dramabox",
    dramaId,
    title: text(field(book, "bookName")),
    language,
    episodes: count(field(book, "chapterCount")),
    // A drama with no locked episode on the page is not said to be free.
    paid: locked === undefined ? null : true,
    payStart: typeof lockedIndex === "number" ? count(lockedIndex + 1) : null,
    synopsis: text(field(book, "introduction")),
    tags,
    audience: language === "en" && audiences.size === 1 && audience !== undefined ? audience : null,
    genre,
    coverUrl: httpsUrl(field(book, "cover")),
  };
}
