// @input  -- POST {platform, title, language?, platformDramaId} after 查剧, by an email on TASK_ADMIN_EMAILS
// @output -- the new draft drama's id, whether its details came from the theater's own page or only from 北斗, and whether its cover was copied into R2; 409 with the listed drama's id when it is already here
// @pos    -- step 2 of the one-step listing: the operator goes on to upload clips and set the promo link
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { dramaImportSchema } from "../../../../../../lib/task-center/contracts.ts";
import { copyCover } from "../../../../../../lib/task-center/drama-cover.ts";
import { lookupDramas, readLookupConfig, toImportedDrama } from "../../../../../../lib/task-center/drama-lookup.ts";
import { importDrama } from "../../../../../../lib/task-center/dramas-store.ts";
import { fetchTheaterDetails } from "../../../../../../lib/task-center/theater-details.ts";
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
/** Less than this left for the theater's page, cover time kept aside: list with 北斗's details alone. */
const DETAILS_MIN_MS = 3_000;

export async function POST(request: Request): Promise<Response> {
  const started = Date.now();
  const mutation = await readAdminMutation(request, 2_048);
  if (!mutation.ok) return mutation.response;
  const parsed = dramaImportSchema.safeParse(mutation.value.body);
  if (!parsed.success) return invalidInput(parsed.error.issues);
  const config = readLookupConfig();
  if (config === null) return privateError("lookup_not_configured", 503);

  // The same query 查剧 just ran: 选剧台 answers it from its cache, and what
  // gets listed is what 北斗 and the theater's own page said, never fields
  // the browser sent back.
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
  const detailsMs = DEADLINE_MS - (Date.now() - started) - COVER_MIN_MS;
  const theater =
    detailsMs < DETAILS_MIN_MS ? null : await fetchTheaterDetails(query.platform, found.platformDramaId, fetch, detailsMs);
  const drama = toImportedDrama(found, query, theater);
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
  const coverUrl = theater?.coverUrl ?? found.coverUrl;
  const cover = left < COVER_MIN_MS ? "failed" : await copyCover(mutation.value.db, id, coverUrl, left);
  return privateJson({ data: { id, cover, details: theater === null ? "beidou" : "official" } }, 201);
}
