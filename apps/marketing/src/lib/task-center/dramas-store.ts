// @input  -- a TaskDb and admin or visitor requests already parsed by contracts.ts
// @output -- dramas (with their optional platform link) and their clip assets: the public grid, one card per published drama fronted by its first matching clip (filtered by any one tag, with this week's hot dramas, each drama's clip count, and each listed drama's details and clips with their types and stills) and its filter choices (tags included), the drama list and detail, the reader's drama page (/watch/<id>: cover, synopsis, trailer, whether there is a platform link, never the link itself), and the admin reads and writes, including a drama imported from 查剧 (北斗 through the 选剧台 lookup, filled in from the theater's own page) and one already listed filled in again from it (从官网补全)
// @pos    -- every SQL statement on task_center.dramas and task_center.drama_assets
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { ClipType, DramaAudience, DramaInput, DramaStatus } from "./contracts.ts";
import { toSafeInteger, type TaskDb } from "./db.ts";

export interface DramaSummary {
  readonly id: string;
  readonly title: string;
  readonly titleCn: string | null;
  readonly platform: string;
  readonly language: string;
  readonly episodes: number | null;
  readonly payStart: number | null;
  readonly coverKey: string | null;
  readonly audience: DramaAudience | null;
  readonly genre: string | null;
  /** As 北斗 or the theater gave them, or as typed; shown, and the /tasks 标签 filter matches one exactly. */
  readonly tags: readonly string[];
  readonly listedAt: string | null;
  /** People who claimed at least one channel, counted from task_claims. */
  readonly promoterCount: number;
}

export interface DramaDetail extends DramaSummary {
  readonly synopsis: string | null;
  /** Null when nobody told us whether every episode is out. */
  readonly finished: boolean | null;
  /** "beidou" when the details came from the 选剧台 lookup; null when typed. */
  readonly source: "beidou" | null;
  readonly sourceDramaId: string | null;
  readonly status: DramaStatus;
  /**
   * The platform's own link to this drama: where 去看全集 on our drama page
   * goes, with the promoter's code in `promoCodeParam`. Optional: without it
   * our drama page is the whole landing.
   */
  readonly promoTargetUrl: string | null;
  readonly promoCodeParam: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DramaAsset {
  readonly id: string;
  readonly dramaId: string;
  readonly kind: "video" | "image";
  readonly title: string;
  readonly objectKey: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly status: "pending" | "ready";
  readonly sort: number;
  readonly uploadedAt: string | null;
  readonly clipType: ClipType | null;
  /** The still cut from a video at upload; null for images and older videos. */
  readonly posterKey: string | null;
}

export type DramaSort = "newest" | "promoters";

interface DramaRow {
  id: string;
  title: string;
  title_cn: string | null;
  platform: string;
  language: string;
  episodes: number | null;
  pay_start: number | null;
  cover_key: string | null;
  audience: DramaAudience | null;
  genre: string | null;
  listed_at: Date | null;
  promoter_count: string | number;
  synopsis?: string | null;
  tags?: string[];
  finished?: boolean | null;
  source?: "beidou" | null;
  source_drama_id?: string | null;
  status?: DramaStatus;
  promo_target_url?: string | null;
  promo_code_param?: string | null;
  created_at?: Date;
  updated_at?: Date;
}

interface AssetRow {
  id: string;
  drama_id: string;
  kind: "video" | "image";
  title: string;
  object_key: string;
  content_type: string;
  byte_size: string | number;
  status: "pending" | "ready";
  sort: number;
  uploaded_at: Date | null;
  clip_type: ClipType | null;
  poster_key: string | null;
}

const PROMOTER_COUNT = `(select count(distinct c.user_id) from task_center.task_claims c where c.drama_id = d.id)`;

const SUMMARY_COLUMNS = `d.id, d.title, d.title_cn, d.platform, d.language, d.episodes, d.pay_start,
  d.cover_key, d.audience, d.genre, d.tags, d.listed_at, ${PROMOTER_COUNT} as promoter_count`;

const DETAIL_COLUMNS = `${SUMMARY_COLUMNS}, d.synopsis, d.finished, d.source, d.source_drama_id,
  d.status, d.promo_target_url, d.promo_code_param, d.created_at, d.updated_at`;

function toSummary(row: DramaRow): DramaSummary {
  return {
    id: row.id,
    title: row.title,
    titleCn: row.title_cn,
    platform: row.platform,
    language: row.language,
    episodes: row.episodes,
    payStart: row.pay_start,
    coverKey: row.cover_key,
    audience: row.audience,
    genre: row.genre,
    tags: row.tags ?? [],
    listedAt: row.listed_at?.toISOString() ?? null,
    promoterCount: toSafeInteger(row.promoter_count) ?? 0,
  };
}

function toDetail(row: DramaRow): DramaDetail {
  return {
    ...toSummary(row),
    synopsis: row.synopsis ?? null,
    finished: row.finished ?? null,
    source: row.source ?? null,
    sourceDramaId: row.source_drama_id ?? null,
    status: row.status ?? "draft",
    promoTargetUrl: row.promo_target_url ?? null,
    promoCodeParam: row.promo_code_param ?? null,
    createdAt: (row.created_at ?? new Date(0)).toISOString(),
    updatedAt: (row.updated_at ?? new Date(0)).toISOString(),
  };
}

function toAsset(row: AssetRow): DramaAsset {
  return {
    id: row.id,
    dramaId: row.drama_id,
    kind: row.kind,
    title: row.title,
    objectKey: row.object_key,
    contentType: row.content_type,
    byteSize: toSafeInteger(row.byte_size) ?? 0,
    status: row.status,
    sort: row.sort,
    uploadedAt: row.uploaded_at?.toISOString() ?? null,
    clipType: row.clip_type,
    posterKey: row.poster_key,
  };
}

/** `%` and `_` in a search box are letters, not wildcards. */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// ---------------------------------------------------------------- public reads

/**
 * 本周爆款: the three published dramas the most people took a link for in the
 * last seven days, among those with at least one. Computed on every read and
 * never stored, so with no claims there is simply no badge. Ties go to the
 * drama claimed most recently.
 */
const HOT_DRAMAS = `select c.drama_id
    from task_center.task_claims c
    join task_center.dramas hd on hd.id = c.drama_id and hd.status = 'published'
   where c.claimed_at >= now() - interval '7 days'
   group by c.drama_id
   order by count(distinct c.user_id) desc, max(c.claimed_at) desc, c.drama_id
   limit 3`;

export interface PlazaAsset {
  readonly id: string;
  readonly kind: "video" | "image";
  readonly title: string;
  readonly objectKey: string;
  readonly byteSize: number;
  readonly clipType: ClipType | null;
  readonly posterKey: string | null;
  readonly uploadedAt: string | null;
  readonly drama: DramaSummary;
  /** Its drama is one of this week's three most claimed. */
  readonly hot: boolean;
  /** Every ready clip of its drama, filters or not: what 系列资源 numbers. */
  readonly clipCount: number;
}

export interface PlazaQuery {
  readonly platform?: string | null;
  readonly language?: string | null;
  readonly audience?: DramaAudience | null;
  readonly genre?: string | null;
  /** One of the drama's tags, spelled exactly as stored: the choices come from listPublishedFacets. */
  readonly tag?: string | null;
  readonly clipType?: ClipType | null;
  readonly search?: string | null;
  readonly sort: DramaSort;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * The grid on /tasks: one card per published drama with a ready clip that
 * matches, never one per clip, so a drama uploaded as twelve episodes is one
 * card and its dialog numbers the twelve (系列资源). The card is fronted by
 * the drama's first matching clip in upload order, the one numbered lowest.
 * Dramas come newest upload first; `total` counts dramas.
 */
export async function listPublishedAssets(
  db: TaskDb,
  query: PlazaQuery,
): Promise<{ readonly items: readonly PlazaAsset[]; readonly total: number }> {
  const where = ["d.status = 'published'", "a.status = 'ready'"];
  const values: unknown[] = [];
  const equal = (column: string, value: string | null | undefined) => {
    if (!value) return;
    values.push(value);
    where.push(`${column} = $${values.length}`);
  };
  equal("d.platform", query.platform);
  equal("d.language", query.language);
  equal("d.audience", query.audience);
  equal("d.genre", query.genre);
  equal("a.clip_type", query.clipType);
  if (query.tag) {
    values.push(query.tag);
    where.push(`$${values.length} = any(d.tags)`);
  }
  const search = query.search?.trim();
  if (search) {
    values.push(likePattern(search));
    const n = values.length;
    where.push(`(a.title ilike $${n} or d.title ilike $${n} or d.title_cn ilike $${n})`);
  }
  // Outside the CTE: its columns, so unqualified.
  const order =
    query.sort === "promoters"
      ? "promoter_count desc, latest_upload desc nulls last, id"
      : "latest_upload desc nulls last, id";
  const from = `task_center.drama_assets a join task_center.dramas d on d.id = a.drama_id`;
  const whereSql = where.join(" and ");

  const { rows: countRows } = await db.query<{ total: string }>(
    `select count(distinct d.id) as total from ${from} where ${whereSql}`,
    values,
  );
  values.push(query.pageSize, (query.page - 1) * query.pageSize);
  const { rows } = await db.query<
    DramaRow & {
      asset_id: string;
      kind: "video" | "image";
      asset_title: string;
      object_key: string;
      byte_size: string | number;
      clip_type: ClipType | null;
      poster_key: string | null;
      uploaded_at: Date | null;
      hot: boolean;
      clip_count: string | number;
    }
  >(
    // distinct on keeps each drama's first matching clip by the order 系列资源
    // numbers them in; the window functions see every matching clip of it.
    `with hot as (${HOT_DRAMAS}),
     cards as (
       select distinct on (d.id)
              a.id as asset_id, a.kind, a.title as asset_title, a.object_key, a.byte_size,
              a.clip_type, a.poster_key, a.uploaded_at,
              max(a.uploaded_at) over (partition by d.id) as latest_upload,
              ${SUMMARY_COLUMNS},
              (select count(*) from task_center.drama_assets x
                where x.drama_id = d.id and x.status = 'ready') as clip_count,
              exists (select 1 from hot where hot.drama_id = d.id) as hot
         from ${from}
        where ${whereSql}
        order by d.id, a.sort, a.created_at, a.id
     )
     select * from cards
      order by ${order}
      limit $${values.length - 1} offset $${values.length}`,
    values,
  );
  return {
    items: rows.map((row) => ({
      id: row.asset_id,
      kind: row.kind,
      title: row.asset_title,
      objectKey: row.object_key,
      byteSize: toSafeInteger(row.byte_size) ?? 0,
      clipType: row.clip_type,
      posterKey: row.poster_key,
      uploadedAt: row.uploaded_at?.toISOString() ?? null,
      drama: toSummary(row),
      hot: row.hot,
      clipCount: toSafeInteger(row.clip_count) ?? 1,
    })),
    total: toSafeInteger(countRows[0]?.total) ?? 0,
  };
}

/**
 * What a drama's dialog on /tasks shows beyond the card: the synopsis and the
 * drama's ready clips in the same order as /tasks/<id>, for the numbered
 * 系列资源 that switch the player. Never the platform's link: this goes to the browser.
 */
export interface PlazaDramaDetail {
  readonly synopsis: string | null;
  readonly clips: readonly {
    readonly id: string;
    readonly title: string;
    readonly byteSize: number;
    readonly kind: "video" | "image";
    readonly clipType: ClipType | null;
    /** The clip's still, or an image itself; null when a video has none. */
    readonly stillKey: string | null;
  }[];
}

/** Details for the published dramas on one page of the grid, by drama id. Unknown or unpublished ids are left out. */
export async function listPlazaDramaDetails(
  db: TaskDb,
  dramaIds: readonly string[],
): Promise<Readonly<Record<string, PlazaDramaDetail>>> {
  const ids = [...new Set(dramaIds)];
  if (ids.length === 0) return {};
  // One after the other: a TaskDb may be a single client, which runs one query at a time.
  const dramas = await db.query<{ id: string; synopsis: string | null }>(
    `select d.id, d.synopsis
       from task_center.dramas d
      where d.id = any($1::uuid[]) and d.status = 'published'`,
    [ids],
  );
  const assets = await db.query<{
    id: string;
    drama_id: string;
    title: string;
    byte_size: string | number;
    kind: "video" | "image";
    clip_type: ClipType | null;
    still_key: string | null;
  }>(
    `select a.id, a.drama_id, a.title, a.byte_size, a.kind, a.clip_type,
            coalesce(a.poster_key, case when a.kind = 'image' then a.object_key end) as still_key
       from task_center.drama_assets a
      where a.drama_id = any($1::uuid[]) and a.status = 'ready'
      order by a.drama_id, a.sort, a.created_at, a.id`,
    [ids],
  );
  const clips = new Map<string, PlazaDramaDetail["clips"][number][]>();
  for (const row of assets.rows) {
    const list = clips.get(row.drama_id) ?? [];
    list.push({
      id: row.id,
      title: row.title,
      byteSize: toSafeInteger(row.byte_size) ?? 0,
      kind: row.kind,
      clipType: row.clip_type,
      stillKey: row.still_key,
    });
    clips.set(row.drama_id, list);
  }
  const details: Record<string, PlazaDramaDetail> = {};
  for (const row of dramas.rows) {
    details[row.id] = { synopsis: row.synopsis, clips: clips.get(row.id) ?? [] };
  }
  return details;
}

/** The platforms, languages, genres and tags that currently have something published. */
export async function listPublishedFacets(
  db: TaskDb,
): Promise<{
  readonly platforms: readonly string[];
  readonly languages: readonly string[];
  readonly genres: readonly string[];
  readonly tags: readonly string[];
}> {
  // Tags in a subquery of their own: unnesting them in the main FROM would
  // drop every published drama without tags from the other three lists.
  const { rows } = await db.query<{
    platforms: string[] | null;
    languages: string[] | null;
    genres: string[] | null;
    tags: string[] | null;
  }>(
    `select array_agg(distinct platform order by platform) as platforms,
            array_agg(distinct language order by language) as languages,
            array_agg(distinct genre order by genre) filter (where genre is not null) as genres,
            (select array_agg(distinct t order by t)
               from task_center.dramas x cross join unnest(x.tags) t
              where x.status = 'published') as tags
       from task_center.dramas where status = 'published'`,
  );
  return {
    platforms: rows[0]?.platforms ?? [],
    languages: rows[0]?.languages ?? [],
    genres: rows[0]?.genres ?? [],
    tags: rows[0]?.tags ?? [],
  };
}

/** A published drama and its ready assets, or null. Drafts and archived ones are not public. */
export async function getPublishedDrama(
  db: TaskDb,
  id: string,
): Promise<{ readonly drama: DramaDetail; readonly assets: readonly DramaAsset[] } | null> {
  const { rows } = await db.query<DramaRow>(
    `select ${DETAIL_COLUMNS} from task_center.dramas d
      where d.id = $1 and d.status = 'published'`,
    [id],
  );
  if (rows[0] === undefined) return null;
  const assets = await db.query<AssetRow>(
    `select * from task_center.drama_assets
      where drama_id = $1 and status = 'ready'
      order by sort, created_at, id`,
    [id],
  );
  return { drama: toDetail(rows[0]), assets: assets.rows.map(toAsset) };
}

/** A ready asset whose drama is published: the only kind a promoter may fetch. */
export async function getPublicAsset(
  db: TaskDb,
  assetId: string,
): Promise<DramaAsset | null> {
  const { rows } = await db.query<AssetRow>(
    `select a.* from task_center.drama_assets a
       join task_center.dramas d on d.id = a.drama_id
      where a.id = $1 and a.status = 'ready' and d.status = 'published'`,
    [assetId],
  );
  return rows[0] === undefined ? null : toAsset(rows[0]);
}

/**
 * What a reader sees on /watch/<id>, the page a promoter's link opens. The
 * platform link itself is never read here, only whether there is one: the
 * page is HTML for anyone, and the link is only ever a 302 from /go.
 */
export interface LandingDrama {
  readonly id: string;
  readonly title: string;
  readonly titleCn: string | null;
  readonly platform: string;
  readonly language: string;
  readonly episodes: number | null;
  readonly genre: string | null;
  readonly tags: readonly string[];
  readonly synopsis: string | null;
  readonly coverKey: string | null;
  readonly hasPlatformLink: boolean;
  /** One ready video to play: a clip tagged trailer first, else the first in the drama's order. */
  readonly trailer: { readonly objectKey: string; readonly posterKey: string | null } | null;
}

/**
 * Any drama that has ever been listed: one taken down still has its page,
 * because the links promoters posted while it was up keep opening it. A draft
 * never published has no page (and no claims, so no links point at it).
 */
export async function getLandingDrama(db: TaskDb, id: string): Promise<LandingDrama | null> {
  const { rows } = await db.query<{
    id: string;
    title: string;
    title_cn: string | null;
    platform: string;
    language: string;
    episodes: number | null;
    genre: string | null;
    tags: string[] | null;
    synopsis: string | null;
    cover_key: string | null;
    has_platform_link: boolean;
    trailer_key: string | null;
    trailer_poster_key: string | null;
  }>(
    `select d.id, d.title, d.title_cn, d.platform, d.language, d.episodes, d.genre, d.tags,
            d.synopsis, d.cover_key, d.promo_target_url is not null as has_platform_link,
            t.object_key as trailer_key, t.poster_key as trailer_poster_key
       from task_center.dramas d
       left join lateral (
         select a.object_key, a.poster_key
           from task_center.drama_assets a
          where a.drama_id = d.id and a.status = 'ready' and a.kind = 'video'
          order by (a.clip_type is not distinct from 'trailer') desc, a.sort, a.created_at, a.id
          limit 1
       ) t on true
      where d.id = $1 and d.listed_at is not null`,
    [id],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    title: row.title,
    titleCn: row.title_cn,
    platform: row.platform,
    language: row.language,
    episodes: row.episodes,
    genre: row.genre,
    tags: row.tags ?? [],
    synopsis: row.synopsis,
    coverKey: row.cover_key,
    hasPlatformLink: row.has_platform_link,
    trailer: row.trailer_key === null ? null : { objectKey: row.trailer_key, posterKey: row.trailer_poster_key },
  };
}

// ----------------------------------------------------------------- admin reads

export async function listAllDramas(db: TaskDb): Promise<readonly DramaDetail[]> {
  const { rows } = await db.query<DramaRow>(
    `select ${DETAIL_COLUMNS} from task_center.dramas d
      order by d.updated_at desc, d.id`,
  );
  return rows.map(toDetail);
}

export async function getDramaForAdmin(
  db: TaskDb,
  id: string,
): Promise<{ readonly drama: DramaDetail; readonly assets: readonly DramaAsset[] } | null> {
  const { rows } = await db.query<DramaRow>(
    `select ${DETAIL_COLUMNS} from task_center.dramas d where d.id = $1`,
    [id],
  );
  if (rows[0] === undefined) return null;
  const assets = await db.query<AssetRow>(
    `select * from task_center.drama_assets where drama_id = $1 order by sort, created_at, id`,
    [id],
  );
  return { drama: toDetail(rows[0]), assets: assets.rows.map(toAsset) };
}

export async function getAsset(db: TaskDb, assetId: string): Promise<DramaAsset | null> {
  const { rows } = await db.query<AssetRow>(
    `select * from task_center.drama_assets where id = $1`,
    [assetId],
  );
  return rows[0] === undefined ? null : toAsset(rows[0]);
}

// ---------------------------------------------------------------- admin writes

function dramaValues(input: DramaInput): unknown[] {
  return [
    input.title,
    input.titleCn,
    input.platform,
    input.language,
    input.episodes,
    input.payStart,
    input.synopsis,
    input.promoTargetUrl,
    input.promoCodeParam,
    input.audience,
    input.genre,
  ];
}

/** New dramas start as drafts; publishing is its own step. */
export async function createDrama(
  db: TaskDb,
  input: DramaInput,
  adminEmail: string,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into task_center.dramas
       (title, title_cn, platform, language, episodes, pay_start, synopsis,
        promo_target_url, promo_code_param, audience, genre, tags, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     returning id`,
    [...dramaValues(input), input.tags ?? [], adminEmail],
  );
  return rows[0]!.id;
}

/** What 查剧 found about a drama (北斗 through 选剧台, then the theater's own page), already checked against 0001 and 0004's limits. */
export interface ImportedDrama {
  readonly title: string;
  readonly titleCn: string | null;
  readonly platform: string;
  readonly language: string;
  readonly episodes: number | null;
  readonly payStart: number | null;
  readonly synopsis: string | null;
  readonly tags: readonly string[];
  readonly audience: DramaAudience | null;
  readonly genre: string | null;
  readonly finished: boolean | null;
  readonly sourceDramaId: string;
}

export type ImportResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly code: "already_listed"; readonly id: string };

/**
 * A draft from the lookup. A platform drama is listed once: a second import,
 * even a concurrent one, gets the existing drama's id back instead.
 */
export async function importDrama(db: TaskDb, drama: ImportedDrama, adminEmail: string): Promise<ImportResult> {
  const { rows } = await db.query<{ id: string }>(
    `insert into task_center.dramas
       (title, title_cn, platform, language, episodes, pay_start, synopsis, tags, audience, genre,
        finished, source, source_drama_id, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'beidou', $12, $13)
     on conflict (platform, source_drama_id) where source_drama_id is not null do nothing
     returning id`,
    [
      drama.title,
      drama.titleCn,
      drama.platform,
      drama.language,
      drama.episodes,
      drama.payStart,
      drama.synopsis,
      drama.tags,
      drama.audience,
      drama.genre,
      drama.finished,
      drama.sourceDramaId,
      adminEmail,
    ],
  );
  if (rows[0] !== undefined) return { ok: true, id: rows[0].id };
  const existing = await listedBySource(db, drama.platform, [drama.sourceDramaId]);
  const id = existing.get(drama.sourceDramaId);
  if (id === undefined) throw new Error("import conflicted but no listed drama was found");
  return { ok: false, code: "already_listed", id };
}

/** Which of these platform drama ids are already listed here, and as which drama. */
export async function listedBySource(
  db: TaskDb,
  platform: string,
  sourceDramaIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (sourceDramaIds.length === 0) return new Map();
  const { rows } = await db.query<{ id: string; source_drama_id: string }>(
    `select id, source_drama_id from task_center.dramas
      where platform = $1 and source_drama_id = any($2::text[])`,
    [platform, sourceDramaIds],
  );
  return new Map(rows.map((row) => [row.source_drama_id, row.id]));
}

export type DramaWriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "not_found" };

export async function updateDrama(
  db: TaskDb,
  id: string,
  input: DramaInput,
): Promise<DramaWriteResult> {
  // Tags left out of the request keep what the drama has.
  const { rowCount } = await db.query(
    `update task_center.dramas
        set title = $1, title_cn = $2, platform = $3, language = $4, episodes = $5,
            pay_start = $6, synopsis = $7, promo_target_url = $8,
            promo_code_param = $9, audience = $10, genre = $11,
            tags = coalesce($13::text[], tags),
            updated_at = now()
      where id = $12`,
    [...dramaValues(input), id, input.tags ?? null],
  );
  return rowCount === 0 ? { ok: false, code: "not_found" } : { ok: true };
}

export type RefillResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "not_found" }
  | { readonly ok: false; readonly code: "already_listed"; readonly id: string };

/**
 * 从官网补全: what 查剧 finds now, written over a drama already here (one
 * typed by hand before 查剧 filled anything in, say). What the source knows
 * replaces what the drama had; what it leaves out stays, and an empty tag
 * list keeps the tags. Title, platform, language, status, cover and the
 * platform link are the operator's and never change here. The first paid
 * episode is kept only while it still fits the episode count (0001). The
 * drama takes the source's id when it has none; another drama already
 * holding that id is a second listing of the same drama, and refuses.
 */
export async function refillDrama(db: TaskDb, id: string, drama: ImportedDrama): Promise<RefillResult> {
  const listed = await listedBySource(db, drama.platform, [drama.sourceDramaId]);
  const other = listed.get(drama.sourceDramaId);
  if (other !== undefined && other !== id) return { ok: false, code: "already_listed", id: other };
  const { rowCount } = await db.query(
    `update task_center.dramas d
        set episodes = n.episodes,
            pay_start = case when n.episodes is null or n.pay_start <= n.episodes then n.pay_start end,
            synopsis = coalesce($4, d.synopsis),
            tags = case when cardinality($5::text[]) > 0 then $5::text[] else d.tags end,
            audience = coalesce($6, d.audience),
            genre = coalesce($7, d.genre),
            title_cn = coalesce($8, d.title_cn),
            finished = coalesce($9, d.finished),
            source = case when d.source_drama_id is null then 'beidou' else d.source end,
            source_drama_id = coalesce(d.source_drama_id, $10),
            updated_at = now()
       from (select coalesce($2::integer, episodes) as episodes,
                    coalesce($3::integer, pay_start) as pay_start
               from task_center.dramas where id = $1) n
      where d.id = $1`,
    [
      id,
      drama.episodes,
      drama.payStart,
      drama.synopsis,
      drama.tags,
      drama.audience,
      drama.genre,
      drama.titleCn,
      drama.finished,
      drama.sourceDramaId,
    ],
  );
  return rowCount === 0 ? { ok: false, code: "not_found" } : { ok: true };
}

export async function setDramaStatus(
  db: TaskDb,
  id: string,
  status: DramaStatus,
): Promise<DramaWriteResult> {
  const { rowCount } = await db.query(
    `update task_center.dramas
        set status = $2,
            listed_at = case when $2 = 'published' then coalesce(listed_at, now()) else listed_at end,
            updated_at = now()
      where id = $1`,
    [id, status],
  );
  return rowCount === 0 ? { ok: false, code: "not_found" } : { ok: true };
}

/**
 * Points the drama at a new cover. The old cover file stays in R2: a retried
 * completion can point the drama back at it, and no check made before a delete
 * can rule that out, so removing it could leave the drama on a missing image.
 */
export async function setDramaCover(db: TaskDb, dramaId: string, coverKey: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `update task_center.dramas set cover_key = $2, updated_at = now() where id = $1`,
    [dramaId, coverKey],
  );
  return rowCount === 1;
}

export async function createPendingAsset(
  db: TaskDb,
  asset: {
    readonly id: string;
    readonly dramaId: string;
    readonly title: string;
    readonly objectKey: string;
    readonly contentType: string;
    readonly byteSize: number;
    readonly clipType: ClipType | null;
    readonly createdBy: string;
  },
): Promise<boolean> {
  const { rowCount } = await db.query(
    `insert into task_center.drama_assets
       (id, drama_id, kind, title, object_key, content_type, byte_size, sort, clip_type, created_by)
     select $1, d.id, case when $4 like 'video/%' then 'video' else 'image' end,
            $3, $5, $4, $6,
            coalesce((select max(sort) + 1 from task_center.drama_assets where drama_id = d.id), 0),
            $8, $7
       from task_center.dramas d where d.id = $2`,
    [
      asset.id,
      asset.dramaId,
      asset.title,
      asset.contentType,
      asset.objectKey,
      asset.byteSize,
      asset.createdBy,
      asset.clipType,
    ],
  );
  return rowCount === 1;
}

/** A null poster keeps any still already recorded, so a retried completion never drops it. */
export async function markAssetReady(
  db: TaskDb,
  assetId: string,
  posterKey: string | null = null,
): Promise<{ readonly posterKey: string | null } | null> {
  const { rows } = await db.query<{ poster_key: string | null }>(
    `update task_center.drama_assets
        set status = 'ready', uploaded_at = coalesce(uploaded_at, now()),
            poster_key = coalesce($2, poster_key)
      where id = $1
      returning poster_key`,
    [assetId, posterKey],
  );
  return rows[0] === undefined ? null : { posterKey: rows[0].poster_key };
}

/** Retags and/or renames a clip; a field left out stays as it is. False when the clip does not exist. */
export async function updateAsset(
  db: TaskDb,
  assetId: string,
  change: { readonly clipType?: ClipType | null | undefined; readonly title?: string | undefined },
): Promise<boolean> {
  const { rowCount } = await db.query(
    `update task_center.drama_assets
        set clip_type = case when $2 then $3 else clip_type end,
            title = coalesce($4, title)
      where id = $1`,
    [assetId, change.clipType !== undefined, change.clipType ?? null, change.title ?? null],
  );
  return rowCount === 1;
}

/** Deletes the row and returns the R2 keys the caller should remove: the file, and its still if any. */
export async function deleteAsset(
  db: TaskDb,
  assetId: string,
): Promise<{ readonly objectKey: string; readonly posterKey: string | null } | null> {
  const { rows } = await db.query<{ object_key: string; poster_key: string | null }>(
    `delete from task_center.drama_assets where id = $1 returning object_key, poster_key`,
    [assetId],
  );
  return rows[0] === undefined ? null : { objectKey: rows[0].object_key, posterKey: rows[0].poster_key };
}
