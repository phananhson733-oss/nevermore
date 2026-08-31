// @input -- private account website and exact frozen input responses
// @output -- client-safe validated context; current Profile never fills historical gaps
// @pos -- shared Visibility input contract, with no storage or provider imports
import { z } from "zod";
import { normalizeAccountWebsiteUrl, parseMarketingWebsiteProfile, parseWebsiteProfileReference, parseWebsiteSummary } from "../account-websites/contracts.ts";
import { parseGeoKbPayload, type GeoKbPayload } from "./kb-contract.ts";
import { profileCopyReference } from "./kb-profile-copy.ts";

export const VISIBILITY_CONTEXT_MAX_BYTES = 4_000_000;
export const VISIBILITY_CONTEXT_MAX_WEBSITES = 100;
export const VISIBILITY_CONTEXT_SCHEMA = "marketing-ai-visibility-context.v1" as const;
const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative();
const date = z.string().datetime();
const website = z.unknown().transform(value => parseWebsiteSummary(value));
const profile = z.unknown().transform(value => parseMarketingWebsiteProfile(value));
const reference = z.unknown().transform(value => parseWebsiteProfileReference(value));
const payload = z.unknown().transform((value, ctx): GeoKbPayload => {
  const parsed = parseGeoKbPayload(value);
  if (parsed.ok) return parsed.value;
  ctx.addIssue({ code: "custom", message: `Invalid frozen payload: ${parsed.reason}` });
  return z.NEVER;
});
const question = z.object({ id: z.string().min(1), text: z.string().min(1), layer: z.enum(["problem", "discovery", "comparison", "evaluation", "branded"]), mode: z.enum(["retrieval", "demand"]), calibrated: z.boolean(), roleId: z.string().nullable(), templateId: z.string().nullable(), requiredEntities: z.array(z.string()).readonly() }).strict();
const entry = z.object({
  website,
  currentProfile: z.object({ reference, profile, confirmedAt: date }).strict().nullable(),
  knowledgeBase: z.object({ kbId: uuid, draftVersion: count, hasDraft: z.boolean() }).strict().nullable(),
  frozen: z.object({ snapshotId: uuid, revision: z.number().int().positive(), frozenAt: date, contentHash: hash, questionSetHash: hash, registryVersion: z.string().min(1), questionCount: count, retrievalCount: count, payload, questions: z.array(question).max(500), profileReference: reference.nullable(), profileCompleteness: z.enum(["complete", "legacy_partial"]), skippedLayers: z.array(z.enum(["problem", "evaluation"])).max(2) }).strict().nullable(),
  preparation: z.object({ status: z.enum(["profile_required", "knowledge_base_required", "freeze_required", "profile_update_available", "ready"]), profileSync: z.enum(["current", "outdated", "legacy_partial", "missing"]), languageWarnings: z.array(z.enum(["unsupported_language", "category_terms_not_english", "role_terms_not_english"])) }).strict(),
}).strict();
const schema = z.object({ schemaVersion: z.literal(VISIBILITY_CONTEXT_SCHEMA), websites: z.array(entry).max(VISIBILITY_CONTEXT_MAX_WEBSITES) }).strict();
export type VisibilityContext = z.infer<typeof schema>;
export type VisibilityWebsiteContext = VisibilityContext["websites"][number];

export function parseVisibilityContext(value: unknown): VisibilityContext {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > VISIBILITY_CONTEXT_MAX_BYTES) throw new Error("Visibility context exceeds response limit");
  const parsed = schema.parse(value);
  const seen = new Set<string>();
  for (const row of parsed.websites) {
    if (seen.has(row.website.websiteId)) throw new Error("Duplicate website context");
    seen.add(row.website.websiteId);
    if (row.currentProfile && row.currentProfile.reference.websiteId !== row.website.websiteId) throw new Error("Profile website mismatch");
    if (row.currentProfile ? row.currentProfile.reference.snapshotId !== row.website.confirmedSnapshotId || row.currentProfile.reference.snapshotRevision !== row.website.confirmedSnapshotRevision || row.currentProfile.confirmedAt !== row.website.confirmedAt : row.website.confirmedSnapshotId !== null) throw new Error("Current Profile summary mismatch");
    const frozen = row.frozen;
    if (!frozen) continue;
    if (normalizeAccountWebsiteUrl(frozen.payload.targetUrl)?.canonicalSiteKey !== row.website.canonicalSiteKey) throw new Error("Frozen website mismatch");
    if (new Set(frozen.questions.map(q => q.id)).size !== frozen.questions.length || new Set(frozen.skippedLayers).size !== frozen.skippedLayers.length) throw new Error("Duplicate frozen identities");
    if (!row.knowledgeBase || frozen.questionCount !== frozen.questions.length || frozen.retrievalCount !== frozen.questions.filter(q => q.mode === "retrieval").length) throw new Error("Frozen context count mismatch");
    if (frozen.profileReference && frozen.profileReference.websiteId !== row.website.websiteId) throw new Error("Frozen Profile website mismatch");
    const copy = frozen.payload.profileCopy;
    if ((copy !== undefined) !== (frozen.profileCompleteness === "complete")) throw new Error("Profile completeness mismatch");
    if (copy && JSON.stringify(profileCopyReference(copy)) !== JSON.stringify(frozen.profileReference)) throw new Error("Frozen Profile reference mismatch");
  }
  return parsed;
}
