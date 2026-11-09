// @input  -- POST {platform, title, language?, platformDramaId} after 查剧, by an email on TASK_ADMIN_EMAILS
// @output -- the new draft drama's id with its details from 北斗, and whether its cover was copied into R2; 409 with the listed drama's id when it is already here
// @pos    -- step 2 of the one-step listing: the operator goes on to upload clips and set the promo link
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { randomUUID } from "node:crypto";

import { CONTENT_TYPE_EXTENSIONS, dramaImportSchema } from "../../../../../../lib/task-center/contracts.ts";
import {
  fetchCover,
  lookupDramas,
  readLookupConfig,
  toImportedDrama,
} from "../../../../../../lib/task-center/drama-lookup.ts";
import { importDrama, setDramaCover } from "../../../../../../lib/task-center/dramas-store.ts";
import { putR2Object, readR2Config } from "../../../../../../lib/task-center/r2.ts";
import {
  invalidInput,
  privateError,
  privateJson,
  readAdminMutation,
} from "../../../../../../lib/task-center/route-http.ts";

export const runtime = "nodejs";
export const maxDuration = 100;

/** Answer inside Cloudflare's 100 s, whatever the lookup took. */
const DEADLINE_MS = 95_000;
/** Less than this left after the insert: skip the cover rather than time out. */
const COVER_MIN_MS = 3_000;

export async function POST(request: Request): Promise<Response> {
  const started = Date.now();
  const mutation = await readAdminMutation(request, 2_048);
  if (!mutation.ok) return mutation.response;
  const parsed = dramaImportSchema.safeParse(mutation.value.body);
  if (!parsed.success) return invalidInput(parsed.error.issues);
  const config = readLookupConfig();
  if (config === null) return privateError("lookup_not_configured", 503);

  // The same query 查剧 just ran: 选剧台 answers it from its cache, and what
  // gets listed is what 北斗 said, never fields the browser sent back.
  const query = parsed.data;
  const result = await lookupDramas(config, query);
  if (!result.ok) {
    return privateJson(
      { error: { code: result.reason === "rejected" ? "lookup_rejected" : "lookup_unavailable", message: result.message } },
      result.reason === "rejected" ? 422 : 503,
    );
  }
  const found = result.dramas.find((drama) => drama.platformDramaId === query.platformDramaId);
  if (found === undefined) return privateError("lookup_not_found", 404);
  const drama = toImportedDrama(found, query);
  if (drama === null) return privateError("language_unknown", 422);

  let id: string;
  try {
    const imported = await importDrama(mutation.value.db, drama, mutation.value.email);
    if (!imported.ok) return privateJson({ error: { code: imported.code, id: imported.id } }, 409);
    id = imported.id;
  } catch (error) {
    console.error("[admin tasks] import failed", error);
    return privateError("tasks_unavailable", 503);
  }
  const left = DEADLINE_MS - (Date.now() - started);
  const cover = left < COVER_MIN_MS ? "failed" : await copyCover(mutation.value.db, id, found.coverUrl, left);
  return privateJson({ data: { id, cover } }, 201);
}

/**
 * The drama is listed either way; without a cover the operator uploads one.
 * Download and upload share the time left before the deadline.
 */
async function copyCover(
  db: Parameters<typeof setDramaCover>[0],
  dramaId: string,
  coverUrl: string | null,
  leftMs: number,
): Promise<"saved" | "missing" | "failed"> {
  const until = Date.now() + leftMs;
  if (coverUrl === null) return "missing";
  const r2 = readR2Config();
  if (r2 === null) return "failed";
  const image = await fetchCover(coverUrl, fetch, leftMs);
  if (image === null) return "failed";
  const key = `dramas/${dramaId}/covers/${randomUUID()}.${CONTENT_TYPE_EXTENSIONS[image.contentType]}`;
  try {
    const remaining = until - Date.now();
    if (remaining < 1_000) return "failed";
    await putR2Object(r2, key, image.bytes, image.contentType, fetch, remaining);
    return (await setDramaCover(db, dramaId, key)) ? "saved" : "failed";
  } catch (error) {
    console.error("[admin tasks] cover copy failed", error instanceof Error ? error.message : error);
    return "failed";
  }
}
