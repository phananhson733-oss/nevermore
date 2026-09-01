// @input -- authenticated read-only requests for all website contexts or one selected frozen version
// @output -- exact owned immutable inputs and separate current Profile proposals
// @pos -- private Visibility input preparation; never creates KBs or starts provider work
import { authenticateAccountRequest, privateError, privateJson } from "../account-websites/route-http.ts";
import { listAccountWebsites, readAccountWebsite } from "../account-websites/store.ts";
import { normalizeAccountWebsiteUrl, parseWebsiteProfileReference, parseWebsiteSummary } from "../account-websites/contracts.ts";
import { listGeoKnowledgeBases, readFrozenGeoKb } from "./kb-store.ts";
import { readGeoSnapshotContext } from "./asset-context-store.ts";
import { profileCopyReference } from "./kb-profile-copy.ts";
import { assertGeoProfileCopyIntegrity } from "./kb-profile-copy-server.ts";
import { geoQuestionLanguageIssues } from "./kb-question-language.ts";
import { geoQuestionLanguageIssue, geoQuestionProperNames } from "./question-quality.ts";
import { parseVisibilityContext, VISIBILITY_CONTEXT_SCHEMA, type VisibilityWebsiteContext, VISIBILITY_CONTEXT_MAX_WEBSITES } from "./visibility-context.ts";
import { z } from "zod";

export interface VisibilityContextDependencies {
  authenticate: typeof authenticateAccountRequest;
  listWebsites: typeof listAccountWebsites;
  readWebsite: typeof readAccountWebsite;
  listKnowledgeBases: typeof listGeoKnowledgeBases;
  readFrozen: typeof readFrozenGeoKb;
  readContext: typeof readGeoSnapshotContext;
}
const DEFAULT: VisibilityContextDependencies = { authenticate: authenticateAccountRequest, listWebsites: listAccountWebsites, readWebsite: readAccountWebsite, listKnowledgeBases: listGeoKnowledgeBases, readFrozen: readFrozenGeoKb, readContext: readGeoSnapshotContext };

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
        if (read.value.snapshotId !== exactId || read.value.kbId !== kb.kbId || normalizeAccountWebsiteUrl(read.value.payload.targetUrl)?.canonicalSiteKey !== website.canonicalSiteKey) return privateError("store_unavailable", 503);
        const context = await dependencies.readContext({ userId: auth.userId, kbId: kb.kbId, snapshotId: read.value.snapshotId });
        if (context.kind !== "ok") return privateError("store_unavailable", 503);
        const copy = read.value.payload.profileCopy;
        if (copy) assertGeoProfileCopyIntegrity(copy);
        const profileReference = copy ? profileCopyReference(copy) : context.value?.profile?.reference ?? null;
        frozen = {
          snapshotId: read.value.snapshotId, revision: read.value.revision, frozenAt: read.value.frozenAt, contentHash: read.value.contentHash, questionSetHash: read.value.questionSetHash,
          registryVersion: read.value.questionSet.registryVersion, questionCount: read.value.questionSet.questions.length, retrievalCount: read.value.questionSet.questions.filter(q => q.mode === "retrieval").length,
          payload: read.value.payload, questions: [...read.value.questionSet.questions], profileReference, profileCompleteness: copy ? "complete" : "legacy_partial", skippedLayers: [...context.value?.skippedLayers ?? []],
        };
      }
      const sync: VisibilityWebsiteContext["preparation"]["profileSync"] = !frozen ? "missing" : frozen.profileCompleteness === "legacy_partial" ? "legacy_partial" : !currentProfile || JSON.stringify(currentProfile.reference) !== JSON.stringify(frozen.profileReference) ? "outdated" : "current";
      const status: VisibilityWebsiteContext["preparation"]["status"] = !currentProfile ? "profile_required" : !kb ? "knowledge_base_required" : !frozen ? "freeze_required" : sync !== "current" ? "profile_update_available" : "ready";
      const languageWarnings: VisibilityWebsiteContext["preparation"]["languageWarnings"][number][] = !frozen ? [] : geoQuestionLanguageIssues(frozen.payload, {
        roleLayersSkipped: frozen.skippedLayers.length === 2,
        activeRoleIds: frozen.questions.flatMap(question => question.roleId === null ? [] : [question.roleId]),
      }).filter((warning) => warning !== "category_terms_not_english");
      if (frozen && geoQuestionLanguageIssue(
        frozen.payload.categoryTerms[0] ?? "",
        frozen.payload.market.language,
        geoQuestionProperNames(frozen.payload),
      )) languageWarnings.push("category_terms_not_english");
      rows.push({ website, currentProfile, knowledgeBase: kb ? { kbId: kb.kbId, draftVersion: kb.draft?.draftVersion ?? 0, hasDraft: kb.draft !== null } : null, frozen, preparation: { status, profileSync: sync, languageWarnings } });
    }
    return privateJson(parseVisibilityContext({ schemaVersion: VISIBILITY_CONTEXT_SCHEMA, websites: rows }));
  } catch { return privateError("store_unavailable", 503); }
}
