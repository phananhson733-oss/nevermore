// @input  -- PICK_LOOKUP_URL and PICK_LOOKUP_TOKEN; a platform, a title and maybe a language from the admin; what the theater's own page shows, when theater-details.ts could read it
// @output -- the dramas the 选剧台 lookup found in its own 剧库 or on 北斗 (北斗's signed cover URL kept server-side; 完结 unknown for a 剧库 row), which of them is a drama already listed (by its platform id, or by its title when it has none), one of them fitted to the dramas table with the theater's page taking over field by field, and a cover image fetched from a URL either gave
// @pos    -- the only code that talks to pick-workbench's /api/pick/lookup/drama/ (contract: its deploy/lookup-api.md)
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
//
// 选剧台 runs on the same machine; the URL is its web container on the drama
// network, never a public address. For ReelShort, StardustTV, MoboReels and
// NetShort it answers from its own 剧库 when the drama is there (a second or
// two, no synopsis, cover, tags or 完结: the theater's page fills those). Any
// other lookup takes 北斗's shared account lock there, so one can take tens of
// seconds; the same 北斗 query is cached for ten minutes on that side, which
// is what lets the import re-run it cheaply.

import { z } from "zod";

import { IMAGE_TYPES, LOOKUP_LANGUAGES, MAX_IMAGE_BYTES, MAX_TAGS, PLATFORM_DRAMA_ID } from "./contracts.ts";
import type { ImportedDrama } from "./dramas-store.ts";
import type { TheaterDetails } from "./theater-details.ts";

export interface LookupConfig {
  readonly url: string;
  readonly token: string;
}

export function readLookupConfig(env: Readonly<Record<string, string | undefined>> = process.env): LookupConfig | null {
  const url = env.PICK_LOOKUP_URL?.trim().replace(/\/+$/, "");
  const token = env.PICK_LOOKUP_TOKEN?.trim();
  if (!url || !token || !/^https?:\/\/[^\s/]+$/.test(url)) return null;
  return { url, token };
}

const dramaSchema = z.object({
  platformDramaId: z.string().regex(PLATFORM_DRAMA_ID),
  title: z.string().min(1),
  titleCn: z.string().nullable(),
  exact: z.boolean(),
  language: z.string().nullable(),
  listedOn: z.string().nullable(),
  episodeCount: z.number().int().nullable(),
  payStart: z.number().int().nullable(),
  /** null: 选剧台's 剧库 does not say. */
  finished: z.boolean().nullable(),
  description: z.string().nullable(),
  tags: z.array(z.string()),
  coverUrl: z.string().nullable(),
});
export type LookupDrama = z.infer<typeof dramaSchema>;

const answerSchema = z.object({
  ok: z.literal(true),
  // A row without the platform's own id cannot be listed or told apart; drop it.
  dramas: z.array(z.unknown()).transform((rows) =>
    rows.flatMap((row) => {
      const parsed = dramaSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

const errorSchema = z.object({ ok: z.literal(false), error: z.string(), message: z.string().optional() });

export type LookupResult =
  | { readonly ok: true; readonly dramas: readonly LookupDrama[] }
  | {
      readonly ok: false;
      /** unavailable: try again later. rejected: this query will not work. */
      readonly reason: "unavailable" | "rejected";
      readonly message: string;
    };

/**
 * Under Cloudflare's 100 s cut-off for the admin's own request. A lookup still
 * waiting here keeps running in 选剧台 and lands in its cache, so the
 * operator's retry is quick.
 */
const LOOKUP_TIMEOUT_MS = 90_000;

export async function lookupDramas(
  config: LookupConfig,
  query: { readonly platform: string; readonly title: string; readonly language: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<LookupResult> {
  const params = new URLSearchParams({ platform: query.platform, title: query.title });
  if (query.language !== null) params.set("language", query.language);
  let response: Response;
  try {
    response = await fetchImpl(`${config.url}/api/pick/lookup/drama/?${params.toString()}`, {
      headers: { authorization: `Bearer ${config.token}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("[drama lookup] request failed", error instanceof Error ? error.name : error);
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return { ok: false, reason: "unavailable", message: timedOut ? "选剧台还在查，稍等一会儿再点一次" : "连不上选剧台" };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const parsed = answerSchema.safeParse(body);
    if (parsed.success) return { ok: true, dramas: parsed.data.dramas };
    return { ok: false, reason: "unavailable", message: "选剧台的回答看不懂" };
  }
  const failure = errorSchema.safeParse(body);
  // Shown to the admin as is, so kept short and on one line.
  const message = failure.success
    ? (failure.data.message ?? failure.data.error).replace(/\s+/g, " ").slice(0, 200)
    : `选剧台回了 HTTP ${response.status}`;
  return { ok: false, reason: response.status === 422 ? "rejected" : "unavailable", message };
}

const LANGUAGE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;

/** Postgres text cannot hold NUL; other control characters are noise. Newlines stay. */
function clean(value: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max).trim();
}

/** Two spellings of one title: case, curly quotes, full-width forms and runs of spaces aside. */
function sameTitle(a: string, b: string): boolean {
  const norm = (value: string) =>
    value.normalize("NFKC").replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();
  return norm(a) === norm(b);
}

/**
 * The lookup row this drama is: the one with its platform id when it has one,
 * otherwise the one whose title is the drama's. Never "the only result": a
 * near title is another drama.
 */
export function pickMatch(
  dramas: readonly LookupDrama[],
  drama: { readonly title: string; readonly sourceDramaId: string | null },
): LookupDrama | "none" | "several" {
  const matches =
    drama.sourceDramaId === null
      ? dramas.filter((found) => sameTitle(found.title, drama.title))
      : dramas.filter((found) => found.platformDramaId === drama.sourceDramaId);
  if (matches.length === 0) return "none";
  return matches.length === 1 && matches[0] !== undefined ? matches[0] : "several";
}

/**
 * One lookup row as a dramas row, inside 0001 and 0004's limits: an episode
 * count or pay start out of range becomes unknown rather than refused, text is
 * cut to length, tags are deduplicated. Null when no language is known, from
 * the operator, from 北斗 or from the theater's page: the operator then fills
 * the form by hand.
 *
 * With the theater's own page, what it shows wins field by field and 北斗
 * fills only what it left out: 北斗 often has no tags, and has no 频道 or
 * genre at all. 中文名 and 完结 are 北斗's alone. The page's id is kept, so
 * the two ids 北斗 sometimes has for one drama list it once.
 */
export function toImportedDrama(
  drama: LookupDrama,
  query: { readonly platform: string; readonly language: string | null },
  details: TheaterDetails | null = null,
): ImportedDrama | null {
  const theater = details?.platform === query.platform ? details : null;
  const pageLanguage = LOOKUP_LANGUAGES.find((known) => known === theater?.language) ?? null;
  const language = query.language ?? drama.language ?? pageLanguage;
  if (language === null || !LANGUAGE_PATTERN.test(language)) return null;
  const episodeCount = theater?.episodes ?? drama.episodeCount;
  const episodes = episodeCount !== null && episodeCount >= 1 && episodeCount <= 2000 ? episodeCount : null;
  const firstPaid =
    theater?.paid === false ? null : theater?.paid === true && theater.payStart !== null ? theater.payStart : drama.payStart;
  const payStart = firstPaid !== null && firstPaid >= 1 && firstPaid <= (episodes ?? 2000) ? firstPaid : null;
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of theater !== null && theater.tags.length > 0 ? theater.tags : drama.tags) {
    const tag = clean(raw, 40).replace(/\s+/g, " ");
    if (tag === "" || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
    if (tags.length === MAX_TAGS) break;
  }
  const titleCn = (drama.titleCn === null ? "" : clean(drama.titleCn, 200)) || null;
  const description = theater?.synopsis ?? drama.description;
  const synopsis = (description === null ? "" : clean(description, 4000)) || null;
  const sourceDramaId = theater?.dramaId ?? drama.platformDramaId;
  return {
    title: clean(theater?.title ?? "", 200) || clean(drama.title, 200) || sourceDramaId,
    titleCn,
    platform: query.platform,
    language,
    episodes,
    payStart,
    synopsis,
    tags,
    audience: theater?.audience ?? null,
    genre: theater?.genre ?? null,
    finished: drama.finished,
    sourceDramaId,
  };
}

/**
 * The cover host is 北斗's or the theater's CDN. Refuse an address that could only be inside
 * this machine's networks: an IP literal or a name without a dot.
 */
function isPublicHttpsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  // "x.internal." is the same name as "x.internal".
  const host = url.hostname.replace(/\.+$/, "");
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    host.includes(".") &&
    !host.startsWith("[") &&
    !/^[\d.]+$/.test(host) &&
    !host.endsWith(".localhost") &&
    !host.endsWith(".internal")
  );
}

export interface FetchedImage {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly contentType: (typeof IMAGE_TYPES)[number];
}

const COVER_TIMEOUT_MS = 30_000;

/**
 * Fetches a cover from the URL the theater's page or 北斗 (signed) gave. Null
 * for anything that is not a reasonable image over https: the drama is still
 * listed and the operator uploads a cover by hand.
 */
export async function fetchCover(
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = COVER_TIMEOUT_MS,
): Promise<FetchedImage | null> {
  if (!isPublicHttpsUrl(url)) return null;
  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(Math.min(timeoutMs, COVER_TIMEOUT_MS)),
    });
    if (!response.ok || response.body === null) return null;
    const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    const contentType = IMAGE_TYPES.find((allowed) => allowed === type);
    if (contentType === undefined) return null;
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_IMAGE_BYTES) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    if (size === 0) return null;
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.byteLength;
    }
    return { bytes, contentType };
  } catch (error) {
    // The URL is signed: log what went wrong, never the address.
    console.error("[drama lookup] cover fetch failed", error instanceof Error ? error.name : error);
    return null;
  }
}
