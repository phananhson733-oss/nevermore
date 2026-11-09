// @input  -- a TaskDb and admin or visitor requests already parsed by contracts.ts
// @output -- dramas and their clip assets: the public clip grid (with this week's hot dramas), the drama list and detail, and the admin reads and writes, including a drama imported from the 选剧台 lookup
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
  /** As 北斗 gave them, or as typed; shown, never filtered on. */
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
}

export interface PlazaQuery {
  readonly platform?: string | null;
  readonly language?: string | null;
  readonly audience?: DramaAudience | null;
  readonly genre?: string | null;
  readonly clipType?: ClipType | null;
  readonly search?: string | null;
  readonly sort: DramaSort;
  readonly page: number;
  readonly pageSize: number;
}

/** Ready clips of published dramas, newest upload first: the grid on /tasks. */
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
  const search = query.search?.trim();
  if (search) {
    values.push(likePattern(search));
    const n = values.length;
    where.push(`(a.title ilike $${n} or d.title ilike $${n} or d.title_cn ilike $${n})`);
  }
  const order =
    query.sort === "promoters"
      ? "promoter_count desc, a.uploaded_at desc, a.id"
      : "a.uploaded_at desc, a.id";
  const from = `task_center.drama_assets a join task_center.dramas d on d.id = a.drama_id`;
  const whereSql = where.join(" and ");

  const { rows: countRows } = await db.query<{ total: string }>(
    `select count(*) as total from ${from} where ${whereSql}`,
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
    }
  >(
    `with hot as (${HOT_DRAMAS})
     select a.id as asset_id, a.kind, a.title as asset_title, a.object_key, a.byte_size,
            a.clip_type, a.poster_key, a.uploaded_at,
            ${SUMMARY_COLUMNS},
            exists (select 1 from hot where hot.drama_id = d.id) as hot
       from ${from}
      where ${whereSql}
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
    })),
    total: toSafeInteger(countRows[0]?.total) ?? 0,
  };
}

/** The platforms, languages and genres that currently have something published. */
export async function listPublishedFacets(
  db: TaskDb,
): Promise<{
  readonly platforms: readonly string[];
  readonly languages: readonly string[];
  readonly genres: readonly string[];
}> {
  const { rows } = await db.query<{
    platforms: string[] | null;
    languages: string[] | null;
    genres: string[] | null;
  }>(
    `select array_agg(distinct platform order by platform) as platforms,
            array_agg(distinct language order by language) as languages,
            array_agg(distinct genre order by genre) filter (where genre is not null) as genres
       from task_center.dramas where status = 'published'`,
  );
  return {
    platforms: rows[0]?.platforms ?? [],
    languages: rows[0]?.languages ?? [],
    genres: rows[0]?.genres ?? [],
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
      order by sort, created_at`,
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
    `select * from task_center.drama_assets where drama_id = $1 order by sort, created_at`,
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

/** What the 选剧台 lookup told us about a drama, already checked against 0001 and 0004's limits. */
export interface ImportedDrama {
  readonly title: string;
  readonly titleCn: string | null;
  readonly platform: string;
  readonly language: string;
  readonly episodes: number | null;
  readonly payStart: number | null;
  readonly synopsis: string | null;
  readonly tags: readonly string[];
  readonly finished: boolean;
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
       (title, title_cn, platform, language, episodes, pay_start, synopsis, tags, finished,
        source, source_drama_id, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'beidou', $10, $11)
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
  | { readonly ok: false; readonly code: "not_found" | "published_needs_target" };

export async function updateDrama(
  db: TaskDb,
  id: string,
  input: DramaInput,
): Promise<DramaWriteResult> {
  const values = [...dramaValues(input), id, input.tags ?? null];
  try {
    const { rowCount } = await db.query(
      `update task_center.dramas
          set title = $1, title_cn = $2, platform = $3, language = $4, episodes = $5,
              pay_start = $6, synopsis = $7, promo_target_url = $8,
              promo_code_param = $9, audience = $10, genre = $11,
              tags = coalesce($13::text[], tags), updated_at = now()
        where id = $12`,
      values,
    );
    return rowCount === 0 ? { ok: false, code: "not_found" } : { ok: true };
  } catch (error) {
    if (isConstraint(error, "dramas_published_has_target")) {
      return { ok: false, code: "published_needs_target" };
    }
    throw error;
  }
}

export async function setDramaStatus(
  db: TaskDb,
  id: string,
  status: DramaStatus,
): Promise<DramaWriteResult> {
  try {
    const { rowCount } = await db.query(
      `update task_center.dramas
          set status = $2,
              listed_at = case when $2 = 'published' then coalesce(listed_at, now()) else listed_at end,
              updated_at = now()
        where id = $1`,
      [id, status],
    );
    return rowCount === 0 ? { ok: false, code: "not_found" } : { ok: true };
  } catch (error) {
    if (isConstraint(error, "dramas_published_has_target")) {
      return { ok: false, code: "published_needs_target" };
    }
    throw error;
  }
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

function isConstraint(error: unknown, name: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { constraint?: unknown }).constraint === name
  );
}
