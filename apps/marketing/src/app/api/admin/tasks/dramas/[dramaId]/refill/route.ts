// @input  -- POST {} from /admin/tasks/<id> (从官网补全资料), by an email on TASK_ADMIN_EMAILS
// @output -- the drama's 集数, 收费, 简介, 标签, 频道, 题材, 中文名 and 完结 refreshed from 查剧 (北斗 through 选剧台, then the theater's own page), its cover copied when it has none; which source answered and what happened to the cover. 404 when the drama or its lookup match is gone, 409 when the title matches several dramas or another drama is the same one, 422 for a platform 查剧 does not know
// @pos    -- for dramas listed before 查剧 filled anything in, or whose details changed on the platform; the drama's own title, language and platform pick the match, never fields the browser sends
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { isUuid, LOOKUP_LANGUAGES, LOOKUP_PLATFORMS } from "../../../../../../../lib/task-center/contracts.ts";
import { copyCover } from "../../../../../../../lib/task-center/drama-cover.ts";
import {
  lookupDramas,
  pickMatch,
  readLookupConfig,
  toImportedDrama,
} from "../../../../../../../lib/task-center/drama-lookup.ts";
import { getDramaForAdmin, refillDrama } from "../../../../../../../lib/task-center/dramas-store.ts";
import { privateError, privateJson, readAdminMutation } from "../../../../../../../lib/task-center/route-http.ts";
import { fetchTheaterDetails } from "../../../../../../../lib/task-center/theater-details.ts";

export const runtime = "nodejs";
export const maxDuration = 100;

/** Answer inside Cloudflare's 100 s, whatever the lookup took. */
const DEADLINE_MS = 95_000;
/** Less than this left after the update: skip the cover rather than time out. */
const COVER_MIN_MS = 3_000;
/** Less than this left for the theater's page, cover time kept aside: refill from 北斗 alone. */
const DETAILS_MIN_MS = 3_000;

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ dramaId: string }> },
): Promise<Response> {
  const started = Date.now();
  const { dramaId } = await context.params;
  const mutation = await readAdminMutation(request, 256);
  if (!mutation.ok) return mutation.response;
  if (!isUuid(dramaId)) return privateError("not_found", 404);
  const config = readLookupConfig();
  if (config === null) return privateError("lookup_not_configured", 503);
  const { db } = mutation.value;

  let current: Awaited<ReturnType<typeof getDramaForAdmin>>;
  try {
    current = await getDramaForAdmin(db, dramaId);
  } catch (error) {
    console.error("[admin tasks] refill read failed", error);
    return privateError("tasks_unavailable", 503);
  }
  if (current === null) return privateError("not_found", 404);
  const { drama } = current;
  const platform = LOOKUP_PLATFORMS.find((known) => known === drama.platform);
  if (platform === undefined) return privateError("lookup_platform_unknown", 422);
  const language = LOOKUP_LANGUAGES.find((known) => known === drama.language) ?? null;

  const result = await lookupDramas(config, { platform, title: drama.title, language });
  if (!result.ok) {
    return privateJson(
      { error: { code: result.reason === "rejected" ? "lookup_rejected" : "lookup_unavailable", message: result.message } },
      result.reason === "rejected" ? 422 : 503,
    );
  }
  const found = pickMatch(result.dramas, drama);
  if (found === "none") return privateError("lookup_not_found", 404);
  if (found === "several") return privateError("lookup_ambiguous", 409);
  const detailsMs = DEADLINE_MS - (Date.now() - started) - COVER_MIN_MS;
  const theater =
    detailsMs < DETAILS_MIN_MS ? null : await fetchTheaterDetails(platform, found.platformDramaId, fetch, detailsMs);
  // The drama's own language goes in as the operator's, so it never changes.
  const refill = toImportedDrama(found, { platform, language: drama.language }, theater);
  if (refill === null) return privateError("language_unknown", 422);

  try {
    const written = await refillDrama(db, dramaId, refill);
    if (!written.ok) {
      return written.code === "already_listed"
        ? privateJson({ error: { code: written.code, id: written.id } }, 409)
        : privateError(written.code, 404);
    }
  } catch (error) {
    console.error("[admin tasks] refill failed", error);
    return privateError("tasks_unavailable", 503);
  }
  const left = DEADLINE_MS - (Date.now() - started);
  const coverUrl = theater?.coverUrl ?? found.coverUrl;
  const cover =
    drama.coverKey !== null ? "kept" : left < COVER_MIN_MS ? "failed" : await copyCover(db, dramaId, coverUrl, left);
  return privateJson({ data: { details: theater === null ? "beidou" : "official", cover } });
}
