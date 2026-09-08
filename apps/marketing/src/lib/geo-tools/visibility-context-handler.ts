// @input -- authenticated read-only requests for all website contexts or one selected frozen version
// @output -- exact owned immutable inputs and separate current Profile proposals
// @pos -- private Visibility input preparation; never creates KBs or starts provider work
import { authenticateAccountRequest, privateError, privateJson } from "../account-websites/route-http.ts";
import { listAccountWebsites, readAccountWebsite } from "../account-websites/store.ts";
import { normalizeAccountWebsiteUrl, parseWebsiteProfileReference, parseWebsiteSummary } from "../account-websites/contracts.ts";
import { geoVersionedPayloadIdentity, isGeoKbPayloadV3Value, listVersionedGeoKnowledgeBases, readVersionedFrozenGeoKb } from "./kb-versioned-read.ts";
import { readVersionedGeoSnapshotContext } from "./asset-context-store.ts";
import { profileCopyReference } from "./kb-profile-copy.ts";
import { assertGeoProfileCopyIntegrity } from "./kb-profile-copy-server.ts";
import { geoQuestionLanguageIssues } from "./kb-question-language.ts";
import { GEO_SNAPSHOT_CONTEXT_SCHEMA_V3 } from "./snapshot-context-v3.ts";
import { geoQuestionLanguageIssue, geoQuestionProperNames } from "./question-quality.ts";
import { parseVisibilityContext, VISIBILITY_CONTEXT_SCHEMA, type VisibilityWebsiteContext, VISIBILITY_CONTEXT_MAX_WEBSITES } from "./visibility-context.ts";
import { z } from "zod";

export interface VisibilityContextDependencies {
  authenticate: typeof authenticateAccountRequest;
  listWebsites: typeof listAccountWebsites;
  readWebsite: typeof readAccountWebsite;
  listKnowledgeBases: typeof listVersionedGeoKnowledgeBases;
  readFrozen: typeof readVersionedFrozenGeoKb;
  readContext: typeof readVersionedGeoSnapshotContext;
}
const DEFAULT: VisibilityContextDependencies = { authenticate: authenticateAccountRequest, listWebsites: listAccountWebsites, readWebsite: readAccountWebsite, listKnowledgeBases: listVersionedGeoKnowledgeBases, readFrozen: readVersionedFrozenGeoKb, readContext: readVersionedGeoSnapshotContext };

export async function handleVisibilityContext(request: Request, dependencies: VisibilityContextDependencies = DEFAULT): Promise<Response> {
  const auth = await dependencies.authenticate();
  if (!auth.ok) return auth.response;
  const query = new URL(request.url).searchParams;
  const websiteId = query.get("websiteId"), snapshotId = query.get("snapshotId");
  if (query.getAll("websiteId").length > 1 || query.getAll("snapshotId").length > 1 || [...query.keys()].some(key => key !== "websiteId" && key !== "snapshotId") || Boolean(websiteId) !== Boolean(snapshotId) || (websiteId && (!z.string().uuid().safeParse(websiteId).success || !z.string().uuid().safeParse(snapshotId).success))) return privateError("invalid_request", 400);
  try {
    const [websites, knowledgeBases] = await Promise.all([dependencies.listWebsites(auth.userId), dependencies.listKnowledgeBases({ userId: auth.userId })]);
    if (websites.kind !== "ok" || knowledgeBases.kind !== "ok") return privateError("store_unavailable", 503);
    if (websites.value.length > VISIBILITY_CONTEXT_MAX_WEBSITES) return privateError("context_limit", 503);
    if (websiteId && !websites.value.some(site => site.websiteId === websiteId)) return privateError("not_found", 404);
    const rows: VisibilityWebsiteContext[] = [];
    for (const listed of websites.value) {
      const details = await dependencies.readWebsite(auth.userId, listed.websiteId);
      if (details.kind !== "ok" || details.value.websiteId !== listed.websiteId || details.value.canonicalSiteKey !== listed.canonicalSiteKey) return privateError("store_unavailable", 503);
      const { submittedUrl: _, draft: _draft, currentConfirmedSnapshot, ...summary } = details.value;
      const website = parseWebsiteSummary(summary);
      const currentProfile = currentConfirmedSnapshot === null ? null : {
        reference: parseWebsiteProfileReference(Object.fromEntries(Object.entries(currentConfirmedSnapshot).filter(([key]) => key !== "profile" && key !== "confirmedAt"))),
        profile: currentConfirmedSnapshot.profile, confirmedAt: currentConfirmedSnapshot.confirmedAt,
      };
      const kb = knowledgeBases.value.find(candidate => candidate.canonicalSiteKey === website.canonicalSiteKey);
      const selected = websiteId === website.websiteId && snapshotId !== null;
      if (selected && !kb) return privateError("not_found", 404);
      let frozen: VisibilityWebsiteContext["frozen"] = null;
      if (kb && (selected || kb.frozen !== null)) {
        const exactId = selected ? snapshotId! : kb.frozen!.snapshotId;
        const read = await dependencies.readFrozen({ userId: auth.userId, kbId: kb.kbId, snapshotId: exactId });
        if (read.kind !== "ok") return privateError(selected && read.kind === "missing" ? "not_found" : "store_unavailable", selected && read.kind === "missing" ? 404 : 503);
        if (read.value.snapshotId !== exactId || read.value.kbId !== kb.kbId || normalizeAccountWebsiteUrl(geoVersionedPayloadIdentity(read.value.payload).targetUrl)?.canonicalSiteKey !== website.canonicalSiteKey) return privateError("store_unavailable", 503);
        // This response's readable `frozen` block is the v1/v2 measurement-input
        // contract: it carries the whole payload and requires a question set,
        // its hash and its count. A v3 version may have none of those, and a v3
        // payload has no shape this contract can carry at all.
        //
        // This used to refuse the request. It was a refusal for one row returned
        // from inside the loop over every website in the account, so one
        // published v3 version took the whole panel down -- every other website
        // included. The honesty was right and the blast radius was not: the row
        // now says the version exists and cannot be read here, and the loop
        // carries on. `identity` is what the store handed back, unprojected.
        const identity = { snapshotId: read.value.snapshotId, revision: read.value.revision, frozenAt: read.value.frozenAt, contentHash: read.value.contentHash };
        const payload = read.value.payload, questionSet = read.value.questionSet, questionSetHash = read.value.questionSetHash;
        if (questionSet === null || questionSetHash === null) {
          // Published with no questions to ask. Permanent for a v3 version in
          // this deployment, which is why it is a state and not an error.
          frozen = { kind: "unreadable", ...identity, questionSetHash: null, reason: "no_question_set" };
        } else if (isGeoKbPayloadV3Value(payload)) {
          // A version that does carry questions, in a payload shape this panel
          // cannot display. Runnable through the run endpoint, which reads the
          // payload through the versioned identity projection; not displayable
          // here until this panel learns v3 (slice S1b).
          frozen = { kind: "unreadable", ...identity, questionSetHash, reason: "unsupported_payload_version" };
        } else {
          const context = await dependencies.readContext({ userId: auth.userId, kbId: kb.kbId, snapshotId: read.value.snapshotId });
          if (context.kind !== "ok") return privateError("store_unavailable", 503);
          // A v3 context beside a v1/v2 payload is a mispaired version: it has no
          // profile projection for this panel to read. Kept as a whole-response
          // refusal rather than a row state: that pairing is corruption, not a
          // version this reader merely does not speak, and failing loudly on
          // corruption is worth the blast radius that a permanent, expected and
          // perfectly valid v3 version is not.
          if (context.value?.schemaVersion === GEO_SNAPSHOT_CONTEXT_SCHEMA_V3) return privateError("store_unavailable", 503);
          const copy = payload.profileCopy;
          if (copy) assertGeoProfileCopyIntegrity(copy);
          const profileReference = copy ? profileCopyReference(copy) : context.value?.profile?.reference ?? null;
          frozen = {
            kind: "readable", ...identity, questionSetHash,
            registryVersion: questionSet.registryVersion, questionCount: questionSet.questions.length, retrievalCount: questionSet.questions.filter(q => q.mode === "retrieval").length,
            payload, questions: questionSet.questions.map(question => ({ id: question.id, text: question.text, layer: question.layer,
              mode: question.mode, calibrated: question.calibrated, roleId: question.roleId ?? null, templateId: question.templateId ?? null,
              requiredEntities: [...question.requiredEntities ?? []] })), profileReference, profileCompleteness: copy ? "complete" : "legacy_partial", skippedLayers: [...context.value?.skippedLayers ?? []],
          };
        }
      }
      const readable = frozen !== null && frozen.kind === "readable" ? frozen : null;
      const unreadable = frozen !== null && frozen.kind === "unreadable";
      // Nothing was compared, so nothing is claimed: the Profile inside a
      // version this reader cannot open is neither current nor outdated, and
      // "missing" would say a complete Profile source was never frozen.
      const sync: VisibilityWebsiteContext["preparation"]["profileSync"] = unreadable ? "unknown" : !readable ? "missing" : readable.profileCompleteness === "legacy_partial" ? "legacy_partial" : !currentProfile || JSON.stringify(currentProfile.reference) !== JSON.stringify(readable.profileReference) ? "outdated" : "current";
      // Read before the Profile and knowledge-base steps, not after: confirming
      // a Profile does not make this version measurable, so naming an earlier
      // step as the next one would send the visitor somewhere that cannot help.
      const status: VisibilityWebsiteContext["preparation"]["status"] = unreadable ? "frozen_unreadable" : !currentProfile ? "profile_required" : !kb ? "knowledge_base_required" : !readable ? "freeze_required" : sync !== "current" ? "profile_update_available" : "ready";
      const languageWarnings: VisibilityWebsiteContext["preparation"]["languageWarnings"][number][] = !readable ? [] : geoQuestionLanguageIssues(readable.payload, {
        roleLayersSkipped: readable.skippedLayers.length === 2,
        activeRoleIds: readable.questions.flatMap(question => question.roleId === null ? [] : [question.roleId]),
      }).filter((warning) => warning !== "category_terms_not_english");
      if (readable && geoQuestionLanguageIssue(
        readable.payload.categoryTerms[0] ?? "",
        readable.payload.market.language,
        geoQuestionProperNames(readable.payload),
      )) languageWarnings.push("category_terms_not_english");
      rows.push({ website, currentProfile, knowledgeBase: kb ? { kbId: kb.kbId, draftVersion: kb.draft?.draftVersion ?? 0, hasDraft: kb.draft !== null } : null, frozen, preparation: { status, profileSync: sync, languageWarnings } });
    }
    return privateJson(parseVisibilityContext({ schemaVersion: VISIBILITY_CONTEXT_SCHEMA, websites: rows }));
  } catch { return privateError("store_unavailable", 503); }
}
