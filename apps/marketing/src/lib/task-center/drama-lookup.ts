// @input  -- PICK_LOOKUP_URL and PICK_LOOKUP_TOKEN; a platform, a title and maybe a language from the admin
// @output -- the 北斗 dramas the 选剧台 lookup found (its signed cover URL kept server-side), one of them fitted to the dramas table, and a cover image fetched from one
// @pos    -- the only code that talks to pick-workbench's /api/pick/lookup/drama/ (contract: its deploy/lookup-api.md)
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
//
// 选剧台 runs on the same machine; the URL is its web container on the drama
// network, never a public address. Every lookup takes 北斗's shared account
// lock there, so one can take tens of seconds; the same query is cached for
// ten minutes on that side, which is what lets the import re-run it cheaply.

import { z } from "zod";

import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_TAGS } from "./contracts.ts";
import type { ImportedDrama } from "./dramas-store.ts";

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
  platformDramaId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  title: z.string().min(1),
  titleCn: z.string().nullable(),
  exact: z.boolean(),
  language: z.string().nullable(),
  listedOn: z.string().nullable(),
  episodeCount: z.number().int().nullable(),
  payStart: z.number().int().nullable(),
  finished: z.boolean(),
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

/**
 * One lookup row as a dramas row, inside 0001 and 0004's limits: an episode
 * count or pay start out of range becomes unknown rather than refused, text is
 * cut to length, tags are deduplicated. Null when no language is known, from
 * the operator or from 北斗: the operator then fills the form by hand.
 */
export function toImportedDrama(
  drama: LookupDrama,
  query: { readonly platform: string; readonly language: string | null },
): ImportedDrama | null {
  const language = query.language ?? drama.language;
  if (language === null || !LANGUAGE_PATTERN.test(language)) return null;
  const episodes =
    drama.episodeCount !== null && drama.episodeCount >= 1 && drama.episodeCount <= 2000 ? drama.episodeCount : null;
  const payStart =
    drama.payStart !== null && drama.payStart >= 1 && drama.payStart <= (episodes ?? 2000) ? drama.payStart : null;
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of drama.tags) {
    const tag = clean(raw, 40).replace(/\s+/g, " ");
    if (tag === "" || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
    if (tags.length === MAX_TAGS) break;
  }
  const titleCn = (drama.titleCn === null ? "" : clean(drama.titleCn, 200)) || null;
  const synopsis = (drama.description === null ? "" : clean(drama.description, 4000)) || null;
  return {
    title: clean(drama.title, 200) || drama.platformDramaId,
    titleCn,
    platform: query.platform,
    language,
    episodes,
    payStart,
    synopsis,
    tags,
    finished: drama.finished,
    sourceDramaId: drama.platformDramaId,
  };
}

/**
 * The cover host is 北斗's CDN. Refuse an address that could only be inside
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
 * Fetches a cover from the signed URL 北斗 gave. Null for anything that is not
 * a reasonable image over https: the drama is still listed and the operator
 * uploads a cover by hand.
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
