// @input  -- POST {fileName, currency, csv} from /admin/tasks/earnings, by an admin
// @output -- the import applied whole, or the file's problems by line, or the codes nobody claimed
// @pos    -- the only way settlement data enters task_center.earnings
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { z } from "zod";

import { importEarnings } from "../../../../../lib/task-center/earnings-store.ts";
import {
  invalidInput,
  privateError,
  privateJson,
  readAdminMutation,
} from "../../../../../lib/task-center/route-http.ts";
import {
  MAX_SETTLEMENT_BYTES,
  isKnownCurrency,
  parseSettlementCsv,
} from "../../../../../lib/task-center/settlement-csv.ts";

export const runtime = "nodejs";

const importSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    currency: z.string().refine(isKnownCurrency, { message: "unknown_currency" }),
    csv: z.string().min(1).max(MAX_SETTLEMENT_BYTES),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  // JSON escaping can grow the text; leave room above the file limit.
  const mutation = await readAdminMutation(request, MAX_SETTLEMENT_BYTES * 2);
  if (!mutation.ok) return mutation.response;
  const parsed = importSchema.safeParse(mutation.value.body);
  if (!parsed.success) return invalidInput(parsed.error.issues);

  const rows = parseSettlementCsv(parsed.data.csv, parsed.data.currency);
  if (!rows.ok) {
    return privateJson({ error: { code: "invalid_file", problems: rows.problems } }, 422);
  }
  try {
    const result = await importEarnings(mutation.value.db, {
      importedBy: mutation.value.email,
      fileName: parsed.data.fileName,
      currency: parsed.data.currency,
      rows: rows.rows,
    });
    if (!result.ok) {
      return privateJson(
        { error: { code: "unknown_codes", unknownCodes: result.unknownCodes.slice(0, 50) } },
        422,
      );
    }
    return privateJson({ data: { importId: result.importId, rowCount: result.rowCount } }, 201);
  } catch (error) {
    console.error("[admin tasks] settlement import failed", error);
    return privateError("tasks_unavailable", 503);
  }
}
