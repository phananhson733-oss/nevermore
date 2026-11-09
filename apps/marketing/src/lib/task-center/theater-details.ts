// @input  -- a platform and the drama id 北斗 gave for it; the theater's own public drama page (only www.reelshort.com so far)
// @output -- the drama as the theater itself shows it: title, language, episode count, first paid episode, synopsis, tags in the page's own language, 女频/男频, a genre slug, cover URL and the id the page settled on (null when there is no such page or it cannot be read), and a link to a drama's page there
// @pos    -- 查剧's second step: 北斗 (through 选剧台) finds the drama and its id, the theater's page fills it in; the import falls back to 北斗's row field by field
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

export interface TheaterDetails {
  readonly platform: "reelshort";
  /** The id of the drama the page shows; an old id redirects to the current one. */
  readonly dramaId: string;
  readonly title: string | null;
  /** The page's own language code; not always the code the task center uses. */
  readonly language: string | null;
  readonly episodes: number | null;
  /** false: every episode is free. null: the page did not say. */
  readonly paid: boolean | null;
  readonly payStart: number | null;
  readonly synopsis: string | null;
  readonly tags: readonly string[];
  readonly audience: DramaAudience | null;
  readonly genre: string | null;
  readonly coverUrl: string | null;
}

const REELSHORT_HOST = "www.reelshort.com";
const REELSHORT_ID = /^[0-9a-f]{24}$/;
const PAGE_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
/** A drama page is about 330 KB. */
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
/** The UA tried from the server on 2026-11-08; Node's own is not one a site expects. */
const USER_AGENT = "Mozilla/5.0 (compatible; GenGrowth-TaskCenter/1.0; +https://gengrowth.ai)";

const AUDIENCE_CATEGORY = "1000";
const GENRE_CATEGORY = "1010";
const CAST_CATEGORIES: ReadonlySet<string> = new Set(["1001", "1005"]);
const AUDIENCE_TAGS: Readonly<Record<string, DramaAudience>> = {
  "676d21074582b53a14081663": "female",
  "676d21074582b53a14081664": "male",
};
/** Every category-1010 tag seen on 130 English pages on 2026-11-08. */
const GENRE_TAGS: Readonly<Record<string, string>> = {
  "676d210c4582b53a140819bb": "comedy",
  "676d210c4582b53a140819bf": "fantasy",
  "676d210c4582b53a140819c0": "sports",
  "676d210c4582b53a140819c1": "romance",
  "676d210c4582b53a140819c2": "drama",
  "676d210c4582b53a140819c4": "animation",
};

/** The drama's page on the platform's own site, for a person to open; null where there is none to link. */
export function theaterPageUrl(platform: string, dramaId: string | null): string | null {
  return platform === "reelshort" && dramaId !== null && REELSHORT_ID.test(dramaId)
    ? `https://${REELSHORT_HOST}/movie/x-${dramaId}`
    : null;
}

/**
 * The drama on the platform's own page. Null for a platform without a reader
 * yet, an id that is not the platform's, or a page that could not be fetched
 * or read: the import then keeps what 北斗 said.
 */
export async function fetchTheaterDetails(
  platform: string,
  dramaId: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = PAGE_TIMEOUT_MS,
): Promise<TheaterDetails | null> {
  if (platform !== "reelshort" || !REELSHORT_ID.test(dramaId)) return null;
  const html = await fetchReelShortPage(dramaId, fetchImpl, Math.min(timeoutMs, PAGE_TIMEOUT_MS));
  return html === null ? null : parseReelShortPage(html);
}

async function fetchReelShortPage(dramaId: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<string | null> {
  const signal = AbortSignal.timeout(timeoutMs);
  let url = new URL(`https://${REELSHORT_HOST}/movie/x-${dramaId}`);
  const visited = new Set<string>();
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      visited.add(url.href);
      const response = await fetchImpl(url.href, {
        headers: { "user-agent": USER_AGENT, accept: "text/html" },
        cache: "no-store",
        redirect: "manual",
        signal,
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        const next = nextUrl(url, response.headers.get("location"));
        if (next === null || visited.has(next.href)) return null;
        url = next;
        continue;
      }
      if (!response.ok || response.body === null) return null;
      const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      if (type !== "text/html") {
        await response.body.cancel();
        return null;
      }
      return await readCapped(response.body, MAX_PAGE_BYTES);
    }
    return null;
  } catch (error) {
    console.error("[drama lookup] ReelShort page fetch failed", error instanceof Error ? error.name : error);
    return null;
  }
}

/** Only ReelShort's own https host, without credentials, is followed. */
function nextUrl(from: URL, location: string | null): URL | null {
  if (location === null) return null;
  let next: URL;
  try {
    next = new URL(location, from);
  } catch {
    return null;
  }
  const ok =
    next.protocol === "https:" &&
    next.hostname === REELSHORT_HOST &&
    next.port === "" &&
    next.username === "" &&
    next.password === "";
  return ok ? next : null;
}

async function readCapped(body: ReadableStream<Uint8Array>, max: number): Promise<string | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(bytes);
}

const NEXT_DATA = /<script[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;

/** A ReelShort drama page read field by field: a field it cannot read is null, a tag it cannot read is skipped. */
export function parseReelShortPage(html: string): TheaterDetails | null {
  const match = NEXT_DATA.exec(html);
  if (match?.[1] === undefined) return null;
  let next: unknown;
  try {
    next = JSON.parse(match[1]);
  } catch {
    return null;
  }
  const data = field(field(field(next, "props"), "pageProps"), "data");
  const dramaId = text(field(data, "book_id"));
  if (dramaId === null || !REELSHORT_ID.test(dramaId)) return null;

  const isPaid = field(data, "is_paid");
  const paid = isPaid === 1 ? true : isPaid === 0 ? false : null;
  const paidStart = count(field(data, "paid_start"));

  let audience: DramaAudience | null = null;
  let genre: string | null = null;
  const tags: string[] = [];
  const tagList = field(data, "tag_list");
  for (const tag of Array.isArray(tagList) ? tagList : []) {
    const id = text(field(tag, "id"));
    const category = text(field(tag, "category_id"));
    const name = text(field(tag, "text"));
    if (id === null || category === null || name === null) continue;
    if (category === AUDIENCE_CATEGORY) {
      audience ??= AUDIENCE_TAGS[id] ?? null;
      continue;
    }
    if (CAST_CATEGORIES.has(category)) continue;
    if (category === GENRE_CATEGORY) {
      const known = GENRE_TAGS[id];
      if (known === undefined) console.error("[drama lookup] ReelShort genre tag not mapped yet", id);
      genre ??= known ?? null;
    }
    tags.push(name);
  }
  const themes = field(data, "tag");
  for (const theme of Array.isArray(themes) ? themes : []) {
    const name = text(theme);
    if (name !== null) tags.push(name);
  }

  const cover = text(field(data, "book_pic"));
  return {
    platform: "reelshort",
    dramaId,
    title: text(field(data, "book_title")),
    language: text(field(data, "lang")),
    episodes: count(field(data, "total")),
    paid,
    payStart: paid === true ? paidStart : null,
    synopsis: text(field(data, "special_desc")),
    tags,
    audience,
    genre,
    coverUrl: cover !== null && cover.startsWith("https://") ? cover : null,
  };
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** A positive whole number, or null. */
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}
