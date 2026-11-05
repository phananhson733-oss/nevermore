// @input  -- a TaskDb and admin or visitor requests already parsed by contracts.ts
// @output -- dramas and their clip assets: the public list and detail, and the admin reads and writes
// @pos    -- every SQL statement on task_center.dramas and task_center.drama_assets
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { DramaInput, DramaStatus } from "./contracts.ts";
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
  readonly listedAt: string | null;
  /** People who claimed at least one channel, counted from task_claims. */
  readonly promoterCount: number;
}

export interface DramaDetail extends DramaSummary {
  readonly synopsis: string | null;
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
}

export type DramaSort = "newest" | "promoters";

export interface DramaListQuery {
  readonly platform?: string | null;
  readonly language?: string | null;
  readonly search?: string | null;
  readonly sort: DramaSort;
  readonly page: number;
  readonly pageSize: number;
}

interface DramaRow {
  id: string;
  title: string;
  title_cn: string | null;
  platform: string;
  language: string;
  episodes: number | null;
  pay_start: number | null;
  cover_key: string | null;
  listed_at: Date | null;
  promoter_count: string | number;
  synopsis?: string | null;
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
}

const PROMOTER_COUNT = `(select count(distinct c.user_id) from task_center.task_claims c where c.drama_id = d.id)`;

const SUMMARY_COLUMNS = `d.id, d.title, d.title_cn, d.platform, d.language, d.episodes, d.pay_start,
  d.cover_key, d.listed_at, ${PROMOTER_COUNT} as promoter_count`;

const DETAIL_COLUMNS = `${SUMMARY_COLUMNS}, d.synopsis, d.status, d.promo_target_url,
  d.promo_code_param, d.created_at, d.updated_at`;

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
    listedAt: row.listed_at?.toISOString() ?? null,
    promoterCount: toSafeInteger(row.promoter_count) ?? 0,
  };
}

function toDetail(row: DramaRow): DramaDetail {
  return {
    ...toSummary(row),
    synopsis: row.synopsis ?? null,
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
  };
}

/** `%` and `_` in a search box are letters, not wildcards. */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// ---------------------------------------------------------------- public reads

export async function listPublishedDramas(
  db: TaskDb,
  query: DramaListQuery,
): Promise<{ readonly items: readonly DramaSummary[]; readonly total: number }> {
  const where = ["d.status = 'published'"];
  const values: unknown[] = [];
  if (query.platform) {
    values.push(query.platform);
    where.push(`d.platform = $${values.length}`);
  }
  if (query.language) {
    values.push(query.language);
    where.push(`d.language = $${values.length}`);
  }
  const search = query.search?.trim();
  if (search) {
    values.push(likePattern(search));
    where.push(
      `(d.title ilike $${values.length} or d.title_cn ilike $${values.length})`,
    );
  }
  const order =
    query.sort === "promoters"
      ? "promoter_count desc, d.listed_at desc, d.id"
      : "d.listed_at desc, d.id";
  const whereSql = where.join(" and ");

  const { rows: countRows } = await db.query<{ total: string }>(
    `select count(*) as total from task_center.dramas d where ${whereSql}`,
    values,
  );
  values.push(query.pageSize, (query.page - 1) * query.pageSize);
  const { rows } = await db.query<DramaRow>(
    `select ${SUMMARY_COLUMNS} from task_center.dramas d
      where ${whereSql}
      order by ${order}
      limit $${values.length - 1} offset $${values.length}`,
    values,
  );
  return {
    items: rows.map(toSummary),
    total: toSafeInteger(countRows[0]?.total) ?? 0,
  };
}

/** The platforms and languages that currently have something published. */
export async function listPublishedFacets(
  db: TaskDb,
): Promise<{ readonly platforms: readonly string[]; readonly languages: readonly string[] }> {
  const { rows } = await db.query<{ platforms: string[] | null; languages: string[] | null }>(
    `select array_agg(distinct platform order by platform) as platforms,
            array_agg(distinct language order by language) as languages
       from task_center.dramas where status = 'published'`,
  );
  return {
    platforms: rows[0]?.platforms ?? [],
    languages: rows[0]?.languages ?? [],
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
        promo_target_url, promo_code_param, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning id`,
    [...dramaValues(input), adminEmail],
  );
  return rows[0]!.id;
}

export type DramaWriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "not_found" | "published_needs_target" };

export async function updateDrama(
  db: TaskDb,
  id: string,
  input: DramaInput,
): Promise<DramaWriteResult> {
  const values = [...dramaValues(input), id];
  try {
    const { rowCount } = await db.query(
      `update task_center.dramas
          set title = $1, title_cn = $2, platform = $3, language = $4, episodes = $5,
              pay_start = $6, synopsis = $7, promo_target_url = $8,
              promo_code_param = $9, updated_at = now()
        where id = $10`,
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
    readonly createdBy: string;
  },
): Promise<boolean> {
  const { rowCount } = await db.query(
    `insert into task_center.drama_assets
       (id, drama_id, kind, title, object_key, content_type, byte_size, sort, created_by)
     select $1, d.id, case when $4 like 'video/%' then 'video' else 'image' end,
            $3, $5, $4, $6,
            coalesce((select max(sort) + 1 from task_center.drama_assets where drama_id = d.id), 0),
            $7
       from task_center.dramas d where d.id = $2`,
    [
      asset.id,
      asset.dramaId,
      asset.title,
      asset.contentType,
      asset.objectKey,
      asset.byteSize,
      asset.createdBy,
    ],
  );
  return rowCount === 1;
}

export async function markAssetReady(db: TaskDb, assetId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `update task_center.drama_assets
        set status = 'ready', uploaded_at = coalesce(uploaded_at, now())
      where id = $1`,
    [assetId],
  );
  return rowCount === 1;
}

/** Deletes the row and returns the R2 key the caller should remove. */
export async function deleteAsset(db: TaskDb, assetId: string): Promise<string | null> {
  const { rows } = await db.query<{ object_key: string }>(
    `delete from task_center.drama_assets where id = $1 returning object_key`,
    [assetId],
  );
  return rows[0]?.object_key ?? null;
}

function isConstraint(error: unknown, name: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { constraint?: unknown }).constraint === name
  );
}
