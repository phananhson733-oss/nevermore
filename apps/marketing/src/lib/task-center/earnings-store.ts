// @input  -- a TaskDb, settlement rows parsed by settlement-csv.ts, a verified Supabase user id
// @output -- one import applied all-or-nothing, the import history, and a promoter's own earnings as exact sums marked partial where days are missing
// @pos    -- every SQL statement on task_center.earning_imports and task_center.earnings
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { withTransaction, type TaskDb } from "./db.ts";
import type { SettlementRow } from "./settlement-csv.ts";

export type ImportResult =
  | { readonly ok: true; readonly importId: string; readonly rowCount: number }
  | { readonly ok: false; readonly code: "unknown_codes"; readonly unknownCodes: readonly string[] };

/**
 * Applies a whole settlement file or none of it. A row whose code nobody
 * claimed would be money with no owner, so one such row refuses the file and
 * names every code that did not match.
 *
 * The same code and day imported again replaces the earlier figures.
 */
export async function importEarnings(
  db: TaskDb,
  input: {
    readonly importedBy: string;
    readonly fileName: string;
    readonly currency: string;
    readonly rows: readonly SettlementRow[];
  },
): Promise<ImportResult> {
  const codes = [...new Set(input.rows.map((row) => row.code))];
  return withTransaction(db, async (tx) => {
    const { rows: known } = await tx.query<{ code: string }>(
      `select code from task_center.task_claims where code = any($1::text[])`,
      [codes],
    );
    const knownCodes = new Set(known.map((row) => row.code));
    const unknownCodes = codes.filter((code) => !knownCodes.has(code));
    if (unknownCodes.length > 0) {
      return { ok: false, code: "unknown_codes", unknownCodes } as const;
    }

    const { rows: imported } = await tx.query<{ id: string }>(
      `insert into task_center.earning_imports (imported_by, file_name, currency, row_count)
       values ($1, $2, $3, $4) returning id`,
      [input.importedBy, input.fileName, input.currency, input.rows.length],
    );
    const importId = imported[0]!.id;

    await tx.query(
      `insert into task_center.earnings
         (claim_id, day, import_id, currency, orders, ad_amount_minor, income_minor)
       select c.id, r.day, $1, $2, r.orders, r.ad_amount_minor, r.income_minor
         from unnest($3::text[], $4::date[], $5::int[], $6::bigint[], $7::bigint[])
              as r(code, day, orders, ad_amount_minor, income_minor)
         join task_center.task_claims c on c.code = r.code
       on conflict (claim_id, day) do update
         set import_id = excluded.import_id,
             currency = excluded.currency,
             orders = excluded.orders,
             ad_amount_minor = excluded.ad_amount_minor,
             income_minor = excluded.income_minor`,
      [
        importId,
        input.currency,
        input.rows.map((row) => row.code),
        input.rows.map((row) => row.day),
        input.rows.map((row) => row.orders),
        input.rows.map((row) => row.adAmountMinor),
        input.rows.map((row) => row.incomeMinor),
      ],
    );
    return { ok: true, importId, rowCount: input.rows.length } as const;
  });
}

export interface EarningImport {
  readonly id: string;
  readonly importedBy: string;
  readonly fileName: string;
  readonly currency: string;
  readonly rowCount: number;
  readonly importedAt: string;
}

export async function listEarningImports(
  db: TaskDb,
  limit = 50,
): Promise<readonly EarningImport[]> {
  const { rows } = await db.query<{
    id: string;
    imported_by: string;
    file_name: string;
    currency: string;
    row_count: number;
    imported_at: Date;
  }>(
    `select * from task_center.earning_imports order by imported_at desc, id limit $1`,
    [limit],
  );
  return rows.map((row) => ({
    id: row.id,
    importedBy: row.imported_by,
    fileName: row.file_name,
    currency: row.currency,
    rowCount: row.row_count,
    importedAt: row.imported_at.toISOString(),
  }));
}

/**
 * One summed column. `total` is the exact sum as a decimal string, so no float
 * rounds a cent and no sum can outgrow a JavaScript number; it is null when no
 * row carried the figure ("—" on the page, never 0). `partial` means some rows
 * carried it and some did not, so the total covers only the days the platform
 * reported, and the page has to say so.
 */
export interface SummedFigure {
  readonly total: string | null;
  readonly partial: boolean;
}

export interface EarningsFigures {
  readonly orders: SummedFigure;
  readonly adAmountMinor: SummedFigure;
  readonly incomeMinor: SummedFigure;
}

export interface CurrencyTotal extends EarningsFigures {
  readonly currency: string;
  readonly firstDay: string;
  readonly lastDay: string;
}

export interface PlatformEarnings extends EarningsFigures {
  readonly platform: string;
  readonly currency: string;
}

export interface MyEarnings {
  readonly totals: readonly CurrencyTotal[];
  readonly byPlatform: readonly PlatformEarnings[];
}

interface FigureRow {
  orders: string | null;
  orders_partial: boolean;
  ad_amount_minor: string | null;
  ad_amount_partial: boolean;
  income_minor: string | null;
  income_partial: boolean;
}

function figure(total: string | null, someMissing: boolean): SummedFigure {
  return { total, partial: total !== null && someMissing };
}

function figures(row: FigureRow): EarningsFigures {
  return {
    orders: figure(row.orders, row.orders_partial),
    adAmountMinor: figure(row.ad_amount_minor, row.ad_amount_partial),
    incomeMinor: figure(row.income_minor, row.income_partial),
  };
}

// `sum()` skips nulls: over only nulls it is null, which is the answer wanted,
// but over a mix it quietly totals the known days. Each sum therefore comes
// with whether any row in its group lacked the figure.
const SUMS = `sum(e.orders)::text as orders,
            count(*) > count(e.orders) as orders_partial,
            sum(e.ad_amount_minor)::text as ad_amount_minor,
            count(*) > count(e.ad_amount_minor) as ad_amount_partial,
            sum(e.income_minor)::text as income_minor,
            count(*) > count(e.income_minor) as income_partial`;

/** A promoter's own rows only. Amounts in different currencies are never added together. */
export async function getMyEarnings(db: TaskDb, userId: string): Promise<MyEarnings> {
  const totals = await db.query<FigureRow & { currency: string; first_day: string; last_day: string }>(
    `select e.currency,
            ${SUMS},
            to_char(min(e.day), 'YYYY-MM-DD') as first_day,
            to_char(max(e.day), 'YYYY-MM-DD') as last_day
       from task_center.earnings e
       join task_center.task_claims c on c.id = e.claim_id
      where c.user_id = $1
      group by e.currency
      order by e.currency`,
    [userId],
  );
  const byPlatform = await db.query<FigureRow & { platform: string; currency: string }>(
    `select d.platform, e.currency,
            ${SUMS}
       from task_center.earnings e
       join task_center.task_claims c on c.id = e.claim_id
       join task_center.dramas d on d.id = c.drama_id
      where c.user_id = $1
      group by d.platform, e.currency
      order by d.platform, e.currency`,
    [userId],
  );
  return {
    totals: totals.rows.map((row) => ({
      currency: row.currency,
      firstDay: row.first_day,
      lastDay: row.last_day,
      ...figures(row),
    })),
    byPlatform: byPlatform.rows.map((row) => ({
      platform: row.platform,
      currency: row.currency,
      ...figures(row),
    })),
  };
}
