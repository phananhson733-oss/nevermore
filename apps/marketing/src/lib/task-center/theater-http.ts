// @input  -- one request a theater reader wants to make (a page or an API on that theater's own hosts) and the fetch and deadline 查剧 gives it
// @output -- the shape every theater reader returns, the body of that one response as text (null for anything off the theater's hosts, not the expected type, over 2 MB, late or failed), and the small readers every parser shares: a data script found in one pass, a field, a text, a positive count, the per-page tag cap, a language code the task center uses, a genre slug
// @pos    -- the one network door for theater-details.ts and its per-site readers (theater-*.ts); they parse, this fetches
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
//
// Kept free of runtime imports so a reader can be run on its own with node's
// type stripping (that is how the live check runs them on the server).

import type { DramaAudience, LookupPlatform } from "./contracts.ts";

export interface TheaterDetails {
  readonly platform: LookupPlatform;
  /** The id of the drama the page shows; an old id may redirect to the current one. */
  readonly dramaId: string;
  readonly title: string | null;
  /** A language code the task center uses, or what the page said when it is not one. */
  readonly language: string | null;
  readonly episodes: number | null;
  /** false: the site says every episode is free. null: it did not say. */
  readonly paid: boolean | null;
  readonly payStart: number | null;
  readonly synopsis: string | null;
  readonly tags: readonly string[];
  readonly audience: DramaAudience | null;
  readonly genre: string | null;
  readonly coverUrl: string | null;
}

export interface TheaterRequest {
  readonly url: string;
  /** The https hosts this theater serves from; a redirect anywhere else is refused. */
  readonly hosts: readonly string[];
  readonly accept: "html" | "json";
  /** Sent as a JSON POST. A POST never follows a redirect. */
  readonly json?: unknown;
}

/** One request to a theater's own host: the body as text, or null. Never throws. */
export type TheaterGet = (request: TheaterRequest) => Promise<string | null>;

const MAX_REDIRECTS = 3;
/** The biggest page seen is about 350 KB. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** The UA tried from the server on 2026-11-08; Node's own is not one a site expects. */
const USER_AGENT = "Mozilla/5.0 (compatible; GenGrowth-TaskCenter/1.0; +https://gengrowth.ai)";
const TYPES = { html: "text/html", json: "application/json" } as const;

/** A TheaterGet that shares one deadline across every request a reader makes. */
export function theaterGet(fetchImpl: typeof fetch, timeoutMs: number): TheaterGet {
  const signal = AbortSignal.timeout(timeoutMs);
  return (request) => fetchBody(request, fetchImpl, signal);
}

async function fetchBody(request: TheaterRequest, fetchImpl: typeof fetch, signal: AbortSignal): Promise<string | null> {
  let url = allowed(request.url, null, request.hosts);
  if (url === null) return null;
  const post = request.json !== undefined;
  const visited = new Set<string>();
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      visited.add(url.href);
      const response = await fetchImpl(url.href, {
        method: post ? "POST" : "GET",
        headers: {
          "user-agent": USER_AGENT,
          accept: TYPES[request.accept],
          ...(post ? { "content-type": "application/json" } : {}),
        },
        ...(post ? { body: JSON.stringify(request.json) } : {}),
        cache: "no-store",
        redirect: "manual",
        signal,
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        if (post) return null;
        const next = allowed(response.headers.get("location"), url, request.hosts);
        if (next === null || visited.has(next.href)) return null;
        url = next;
        continue;
      }
      if (!response.ok || response.body === null) {
        await response.body?.cancel();
        return null;
      }
      const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      if (type !== TYPES[request.accept]) {
        await response.body.cancel();
        return null;
      }
      return await readCapped(response.body, MAX_BODY_BYTES);
    }
    return null;
  } catch (error) {
    console.error("[drama lookup] theater fetch failed", url.hostname, error instanceof Error ? error.name : error);
    return null;
  }
}

/** Only the theater's own https hosts, on the default port, without credentials. */
function allowed(location: string | null, from: URL | null, hosts: readonly string[]): URL | null {
  if (location === null) return null;
  let next: URL;
  try {
    next = from === null ? new URL(location) : new URL(location, from);
  } catch {
    return null;
  }
  const ok =
    next.protocol === "https:" &&
    hosts.includes(next.hostname) &&
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

export function parseJson(body: string | null): unknown {
  if (body === null) return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/** At most this many tags or labels are looked at on one page; real pages have under 30. */
export const MAX_TAGS_READ = 60;

/**
 * The JSON inside the <script> tag whose id is `id`. Plain index searches,
 * each moving forward once, so a hostile 2 MB page cannot make it slow (a
 * regex over the whole page can be made quadratic).
 */
export function scriptJson(html: string, id: string): unknown {
  const marker = html.indexOf(`id="${id}"`);
  if (marker < 0) return undefined;
  const tag = html.lastIndexOf("<script", marker);
  const bodyStart = html.indexOf(">", marker) + 1;
  if (tag < 0 || bodyStart === 0 || html.indexOf(">", tag) < marker) return undefined;
  const bodyEnd = html.indexOf("</script>", bodyStart);
  return bodyEnd < 0 ? undefined : parseJson(html.slice(bodyStart, bodyEnd));
}

/** The `__NEXT_DATA__` JSON of a Next.js pages-router page. */
export function nextData(html: string): unknown {
  return scriptJson(html, "__NEXT_DATA__");
}

export function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

export function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** A positive whole number, or null. */
export function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

/** An https URL as a valid href (a raw non-ASCII path gets encoded), or null. */
export function httpsUrl(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * A site's language code as the task center writes it: `en_US`, `en-US` and
 * `en` are `en`; Chinese is `zh-TW` only when the code says traditional; `in`
 * is Indonesian's old code. Anything else keeps its main part, which the
 * import then ignores unless the task center knows it.
 */
export function languageCode(value: unknown): string | null {
  const raw = text(value);
  if (raw === null || raw.length > 16) return null;
  const parts = raw.toLowerCase().split(/[-_]/);
  const main = parts[0] ?? "";
  if (!/^[a-z]{2,3}$/.test(main)) return null;
  if (main === "zh") return parts.some((part) => part === "tw" || part === "hk" || part === "hant") ? "zh-TW" : "zh";
  return main === "in" ? "id" : main;
}

/** A site's genre name as a slug the dramas table takes: lowercase ASCII words joined by dashes, at most 32. */
export function genreSlug(value: unknown): string | null {
  const raw = text(value);
  if (raw === null || raw.length > 64) return null;
  const slug = raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return /^[a-z0-9][a-z0-9-]{0,31}$/.test(slug) && !/^(male|female|man|woman|men|women)$/.test(slug) ? slug : null;
}
