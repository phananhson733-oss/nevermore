// @input -- private account website and exact frozen input responses
// @output -- client-safe validated context; current Profile never fills historical gaps
// @pos -- shared Visibility input contract, with no storage or provider imports
import { z } from "zod";
import { normalizeAccountWebsiteUrl, parseMarketingWebsiteProfile, parseWebsiteProfileReference, parseWebsiteSummary } from "../account-websites/contracts.ts";
import { parseAnyGeoKbPayload, type AnyGeoKbPayload } from "./kb-v2-contract.ts";
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
const payload = z.unknown().transform((value, ctx): AnyGeoKbPayload => {
  try { return parseAnyGeoKbPayload(value); }
  catch { ctx.addIssue({ code: "custom", message: "Invalid frozen payload" }); return z.NEVER; }
});
const question = z.object({ id: z.string().min(1), text: z.string().min(1), layer: z.enum(["problem", "discovery", "comparison", "evaluation", "branded"]), mode: z.enum(["retrieval", "demand"]), calibrated: z.boolean(), roleId: z.string().nullable(), templateId: z.string().nullable(), requiredEntities: z.array(z.string()).readonly() }).strict();
const revision = z.number().int().positive();
const identity = { snapshotId: uuid, revision, frozenAt: date, contentHash: hash };
/** A frozen version this panel holds whole: the v1/v2 measurement input. */
const readableFrozen = z.object({ kind: z.literal("readable"), ...identity, questionSetHash: hash, registryVersion: z.string().min(1), questionCount: count, retrievalCount: count, payload, questions: z.array(question).max(500), profileReference: reference.nullable(), profileCompleteness: z.enum(["complete", "legacy_partial"]), skippedLayers: z.array(z.enum(["problem", "evaluation"])).max(2) }).strict();
/**
 * A frozen version that exists and that this panel cannot read.
 *
 * The third state, and a real one. A v3 version published with no question set
 * has nothing this contract's `payload`, `questions` and `questionSetHash`
 * could hold, and a v3 payload has no shape this contract can carry at all --
 * but the version is there, and reporting `frozen: null` would tell the visitor
 * the website has no frozen version, while refusing the response would take the
 * account's other websites down with it. So the row says what is true: this
 * version exists, here is its identity, and this page cannot read it.
 *
 * It carries only the identity the store hands back. Nothing is projected: a
 * question count of 0, an empty question list or a hash of nothing would each
 * be a measured quantity this version does not have.
 */
const unreadableFrozen = z.object({ kind: z.literal("unreadable"), ...identity, questionSetHash: hash.nullable(), reason: z.enum(["no_question_set", "unsupported_payload_version"]) }).strict();
const entry = z.object({
  website,
  currentProfile: z.object({ reference, profile, confirmedAt: date }).strict().nullable(),
  knowledgeBase: z.object({ kbId: uuid, draftVersion: count, hasDraft: z.boolean() }).strict().nullable(),
  frozen: z.discriminatedUnion("kind", [readableFrozen, unreadableFrozen]).nullable(),
  preparation: z.object({ status: z.enum(["profile_required", "knowledge_base_required", "freeze_required", "profile_update_available", "frozen_unreadable", "ready"]), profileSync: z.enum(["current", "outdated", "legacy_partial", "missing", "unknown"]), languageWarnings: z.array(z.enum(["unsupported_language", "category_terms_not_english", "role_terms_not_english"])) }).strict(),
}).strict();
const schema = z.object({ schemaVersion: z.literal(VISIBILITY_CONTEXT_SCHEMA), websites: z.array(entry).max(VISIBILITY_CONTEXT_MAX_WEBSITES) }).strict();
export type VisibilityContext = z.infer<typeof schema>;
export type VisibilityWebsiteContext = VisibilityContext["websites"][number];
export type VisibilityFrozenContext = NonNullable<VisibilityWebsiteContext["frozen"]>;
/** The readable half, for the consumers that render a whole frozen version. */
export type VisibilityReadableFrozenContext = Extract<VisibilityFrozenContext, { readonly kind: "readable" }>;
export type VisibilityUnreadableFrozenContext = Extract<VisibilityFrozenContext, { readonly kind: "unreadable" }>;

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
    // The third state has to stay a state. Both directions are checked, because
    // either one alone lets it collapse back: without the first, a row could
    // announce an unreadable version it does not have; without the second, a row
    // holding one could still describe itself as ready, or as having no version.
    const unreadable = frozen !== null && frozen.kind === "unreadable";
    if ((row.preparation.status === "frozen_unreadable") !== unreadable) throw new Error("Frozen readability status mismatch");
    if ((row.preparation.profileSync === "unknown") !== unreadable) throw new Error("Frozen readability sync mismatch");
    // Nothing looked at those questions, so no finding about them may travel.
    // An empty warning list beside an unreadable version reads as "checked and
    // clean" everywhere it is rendered, which is a measurement nobody made.
    if (unreadable && row.preparation.languageWarnings.length > 0) throw new Error("Unread frozen questions carry no language findings");
    if (!frozen) continue;
    if (!row.knowledgeBase) throw new Error("Frozen version without its knowledge base");
    if (frozen.kind === "unreadable") {
      // The one claim checkable from here: the set and its hash are stored
      // together, so a version that kept a hash has a set and may not say it
      // has none -- and one that says nothing about a set must not keep a hash.
      if ((frozen.reason === "no_question_set") !== (frozen.questionSetHash === null)) throw new Error("Frozen unreadable reason mismatch");
      continue;
    }
    if (normalizeAccountWebsiteUrl(frozen.payload.targetUrl)?.canonicalSiteKey !== row.website.canonicalSiteKey) throw new Error("Frozen website mismatch");
    if (new Set(frozen.questions.map(q => q.id)).size !== frozen.questions.length || new Set(frozen.skippedLayers).size !== frozen.skippedLayers.length) throw new Error("Duplicate frozen identities");
    if (frozen.questionCount !== frozen.questions.length || frozen.retrievalCount !== frozen.questions.filter(q => q.mode === "retrieval").length) throw new Error("Frozen context count mismatch");
    if (frozen.profileReference && frozen.profileReference.websiteId !== row.website.websiteId) throw new Error("Frozen Profile website mismatch");
    const copy = frozen.payload.profileCopy;
    if ((copy !== undefined) !== (frozen.profileCompleteness === "complete")) throw new Error("Profile completeness mismatch");
    if (copy && JSON.stringify(profileCopyReference(copy)) !== JSON.stringify(frozen.profileReference)) throw new Error("Frozen Profile reference mismatch");
  }
  return parsed;
}
