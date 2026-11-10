// @input  -- POST {platform, title, language?} from 查剧 on /admin/tasks, by an email on TASK_ADMIN_EMAILS
// @output -- the dramas the 选剧台 lookup found, each marked with the drama already listed for it; when none, the 剧库 rows of that title on the platforms 查剧 knows (inCatalog: to switch platform or type in by hand); configured:false when the lookup is not set up
// @pos    -- step 1 of the one-step listing; the operator then imports one (../import) or types the drama by hand
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { dramaLookupSchema, LOOKUP_PLATFORMS } from "../../../../../../lib/task-center/contracts.ts";
import { lookupDramas, readLookupConfig } from "../../../../../../lib/task-center/drama-lookup.ts";
import { listedBySource } from "../../../../../../lib/task-center/dramas-store.ts";
import {
  invalidInput,
  privateError,
  privateJson,
  readAdminMutation,
} from "../../../../../../lib/task-center/route-http.ts";

export const runtime = "nodejs";
// One 北斗 call can wait behind the shared account lock for a while.
export const maxDuration = 100;

export async function POST(request: Request): Promise<Response> {
  const mutation = await readAdminMutation(request, 2_048);
  if (!mutation.ok) return mutation.response;
  const parsed = dramaLookupSchema.safeParse(mutation.value.body);
  if (!parsed.success) return invalidInput(parsed.error.issues);
  const config = readLookupConfig();
  if (config === null) return privateJson({ data: { configured: false, dramas: [], inCatalog: [] } });

  const result = await lookupDramas(config, parsed.data);
  if (!result.ok) {
    return privateJson(
      { error: { code: result.reason === "rejected" ? "lookup_rejected" : "lookup_unavailable", message: result.message } },
      result.reason === "rejected" ? 422 : 503,
    );
  }
  let listed: ReadonlyMap<string, string>;
  try {
    listed = await listedBySource(
      mutation.value.db,
      parsed.data.platform,
      result.dramas.map((drama) => drama.platformDramaId),
    );
  } catch (error) {
    console.error("[admin tasks] listed lookup failed", error);
    return privateError("tasks_unavailable", 503);
  }
  // The cover URL is signed; it stays on the server and is fetched at import.
  const dramas = result.dramas.map((drama) => ({
    platformDramaId: drama.platformDramaId,
    title: drama.title,
    titleCn: drama.titleCn,
    exact: drama.exact,
    language: drama.language,
    episodes: drama.episodeCount,
    payStart: drama.payStart,
    finished: drama.finished,
    synopsis: drama.description,
    tags: drama.tags,
    hasCover: drama.coverUrl !== null,
    listedDramaId: listed.get(drama.platformDramaId) ?? null,
  }));
  // Only the platforms the panel can switch to; 选剧台's 剧库 also has DramaWave, StarShort and the like.
  const known: ReadonlySet<string> = new Set(LOOKUP_PLATFORMS);
  const inCatalog = result.inCatalog
    .filter((row) => known.has(row.platform))
    .map((row) => ({
      platform: row.platform,
      title: row.title,
      titleCn: row.titleCn,
      language: row.language,
      episodes: row.episodeCount,
      payStart: row.payStart,
    }));
  return privateJson({ data: { configured: true, dramas, inCatalog } });
}
