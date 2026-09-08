// @input -- authenticated same-origin GEO v3 assemble request
// @output -- the private validated handler response; no model call and no crawl budget
// @pos -- Node entrypoint for the step that turns a paid run's output into draft knowledge

/**
 * The wiring lives here rather than in `kb-v3-runtime.ts`, and that is a seam,
 * not a preference: this route was added while that file was being edited
 * elsewhere, so its `GeoKbV3Runtime` has no `assemble` member to hang these
 * dependencies on. Moving them there is a one-function change and should
 * happen; nothing below is route-specific except the bucket sizes.
 */
import { getServerAuthenticatedUser } from "../../../../../../lib/auth/server-auth-user.ts";
import { consumePublicToolQuota } from "../../../../../../lib/tools/shared-rate-limit.ts";
import { DEFAULT_GEO_KB_GENERATION_STORE } from "../../../../../../lib/geo-tools/kb-generation-store.ts";
import { readVersionedGeoKnowledgeBase } from "../../../../../../lib/geo-tools/kb-versioned-read.ts";
import { saveGeoKbDraftV3 } from "../../../../../../lib/geo-tools/kb-v3-store.ts";
import {
  handleGeoKbV3Assemble,
  type GeoKbV3AssembleDependencies,
} from "../../../../../../lib/geo-tools/kb-v3-assemble-handler.ts";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Every bucket must allow before any work happens; the first refusal decides. */
async function bucket(buckets: readonly (readonly [string, number])[]): Promise<"allowed" | "limited" | "unavailable"> {
  for (const [name, limit] of buckets) {
    const result = await consumePublicToolQuota(name, limit, 3600).catch(() => ({ kind: "unavailable" as const }));
    if (result.kind !== "allowed") return result.kind === "limited" ? "limited" : "unavailable";
  }
  return "allowed";
}

const DEPENDENCIES: GeoKbV3AssembleDependencies = {
  authenticate: getServerAuthenticatedUser,
  readDetails: (input) => readVersionedGeoKnowledgeBase(input),
  saveDraft: (input) => saveGeoKbDraftV3(input),
  readLatestGeneration: (input) => DEFAULT_GEO_KB_GENERATION_STORE.readLatest(input),
  /**
   * One kind failing to read must not mask another kind that is known to be
   * running, so an outage is reported only after every kind has been asked.
   * Mirrors `createGeoKbV3Runtime`'s own predicate; it is not exported.
   */
  generationRunning: async (userId, kbId) => {
    let unavailable = false;
    for (const kind of ["roles", "questions", "knowledge_pack"] as const) {
      const read = await DEFAULT_GEO_KB_GENERATION_STORE.readLatest({ userId, kbId, kind });
      if (read.kind !== "ok") { unavailable = true; continue; }
      if (read.generation !== null && read.generation.state === "dispatched") return true;
    }
    return unavailable ? "unavailable" : false;
  },
  // Assembling buys nothing, but it writes a draft version. A person assembles
  // once per update; a stuck client does not.
  consumeQuota: (userId, kbId) => bucket([[`geo-kb-v3:assemble:owner:${userId}`, 60], [`geo-kb-v3:assemble:kb:${kbId}`, 30]]),
};

export function POST(request: Request): Promise<Response> {
  return handleGeoKbV3Assemble(request, DEPENDENCIES);
}
