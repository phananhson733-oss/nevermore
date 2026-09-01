// @input -- exact Profile copy, owner-validated source records and reviewed GEO data
// @output -- bounded model input plus explicit selection counts, without source truncation
// @pos -- deterministic assembly only; no network, review approval or evidence fabrication
import { createHash } from "node:crypto";
import { WEBSITE_PROFILE_FIELD_NAMES } from "../account-websites/contracts.ts";
import { parseGeoKbPayloadV2, type AnyGeoKbPayload, type GeoKbPayloadV2 } from "./kb-v2-contract.ts";
import { canonicalGeoV2Text } from "./kb-v2-json.ts";
import {
  parseGeoQuestionSynthesisInput, parseGeoRoleSynthesisInput,
  type GeoQuestionSynthesisInput, type GeoRoleSynthesisInput, type GeoSynthesisEntity, type GeoSynthesisSource,
} from "./kb-synthesis-contract.ts";

export type GeoEvidenceCounts = Readonly<Record<GeoSynthesisSource["kind"], number>>;
export type GeoEntityCounts = Readonly<Record<GeoSynthesisEntity["kind"], number>>;
export interface GeoSynthesisEvidenceSelection {
  readonly availableEvidenceCounts: GeoEvidenceCounts;
  readonly selectedEvidenceCounts: GeoEvidenceCounts;
}
export interface GeoAdmittedQuestionFact {
  readonly key: string; readonly value: string; readonly sourceUrl: string; readonly observedAt: string;
  readonly source: "crawl" | "user_confirmed";
}
const INPUT_BUDGET = 163_840; // Leave room for instructions inside the transport's 192 KiB cap.
const countEvidence = (sources: readonly GeoSynthesisSource[]): GeoEvidenceCounts => {
  const counts = { profile: 0, gsc: 0, crawl: 0, manual: 0 };
  for (const source of sources) counts[source.kind] += 1;
  return counts;
};
const countEntities = (entities: readonly GeoSynthesisEntity[]): GeoEntityCounts => {
  const counts = { brand: 0, category: 0, competitor: 0, role_pain: 0, role_alternative: 0, role_criterion: 0, role_vocabulary: 0, fact: 0 };
  for (const entity of entities) counts[entity.kind] += 1;
  return counts;
};
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");

export function buildGeoRoleSynthesisBasis(payload: AnyGeoKbPayload, locale: "en" | "zh", sources: readonly GeoSynthesisSource[]): GeoSynthesisEvidenceSelection & { readonly input: GeoRoleSynthesisInput } {
  if (payload.profileCopy === undefined) throw new Error("A complete Profile copy is required");
  const copy = payload.profileCopy;
  const profileSources: GeoSynthesisSource[] = [];
  for (const field of WEBSITE_PROFILE_FIELD_NAMES) {
    const value = copy.profile[field];
    if (value === "" || (Array.isArray(value) && value.length === 0)) continue;
    const provenance = copy.profile.fieldProvenance.find(item => item.path === `/${field}`);
    profileSources.push({ id: `profile:${copy.snapshotId}:${field}`, kind: "profile", text:
      `Profile /${field}, not independently verified. Derivation: ${provenance?.derivation ?? "not recorded"}; source: ${provenance?.source ?? "not recorded"}. Value: ${JSON.stringify(value)}` });
  }
  const allSources = [...profileSources, ...sources];
  if (new Set(allSources.map(source => source.id)).size !== allSources.length) throw new Error("Duplicate source identity");
  const selected = [...profileSources];
  const input = (): GeoRoleSynthesisInput => ({ officialName: payload.officialName, displayLocale: locale, questionLanguage: payload.market.language, sources: [...selected] });
  if (bytes(input()) > INPUT_BUDGET) throw new Error("Profile exceeds semantic input budget");
  for (const source of sources) {
    if (selected.length >= 256) break;
    if (bytes({ ...input(), sources: [...selected, source] }) <= INPUT_BUDGET) selected.push(source);
  }
  const assembled = input();
  if (!parseGeoRoleSynthesisInput(assembled).ok) throw new Error("Invalid semantic source selection");
  return { input: assembled, availableEvidenceCounts: countEvidence(allSources), selectedEvidenceCounts: countEvidence(selected) };
}

/** Facts must already have passed server-side support/review admission. There is
 * deliberately no fallback from filled payload facts or Profile feature prose. */
export function buildGeoQuestionSynthesisBasis(payload: GeoKbPayloadV2, facts: readonly GeoAdmittedQuestionFact[]): GeoSynthesisEvidenceSelection & {
  readonly input: GeoQuestionSynthesisInput;
  readonly availableEntityCounts: GeoEntityCounts;
  readonly selectedEntityCounts: GeoEntityCounts;
} {
  payload = parseGeoKbPayloadV2(payload);
  const hash = createHash("sha256").update(canonicalGeoV2Text(payload)).digest("hex");
  const sources: GeoSynthesisSource[] = [];
  const all: GeoSynthesisEntity[] = [], selected: GeoSynthesisEntity[] = [];
  const source = (suffix: string, kind: GeoSynthesisSource["kind"], text: string) => {
    const id = `saved:${hash}:${suffix}`;
    sources.push({ id, kind, text });
    return [id];
  };
  const add = (id: string, text: string, kind: GeoSynthesisEntity["kind"], roleId: string | null, evidenceRefs: readonly string[], include = true) => {
    const item = { id, text, kind, roleId, evidenceRefs };
    all.push(item);
    if (include) selected.push(item);
  };
  const brand = source("brand", "manual", `User-reviewed brand identity: ${JSON.stringify({ officialName: payload.officialName, aliases: payload.aliases })}`);
  add("brand", payload.officialName, "brand", null, brand);
  const terms = source("categories", "manual", `User-reviewed query categories: ${JSON.stringify(payload.categoryTerms)}`);
  payload.categoryTerms.forEach((term, index) => add(`category:${index}`, term, "category", null, terms));
  const roles = payload.roles.filter(role => role.review === "accepted").map((role, roleIndex) => {
    const refs = source(`role:${roleIndex}`, "manual", `User-reviewed role wording, not a raw search query. Original lineage: ${JSON.stringify(role.source)}. Content: ${JSON.stringify(role)}`);
    const fields = [
      ["painPoints", "role_pain", 4], ["decisionCriteria", "role_criterion", 4],
      ["alternatives", "role_alternative", 2], ["vocabulary", "role_vocabulary", 2],
    ] as const;
    for (const [field, kind, limit] of fields) role[field].forEach((text, index) => add(`role:${roleIndex}:${kind}:${index}`, text, kind, role.id, refs, index < limit));
    const { source: _source, review: _review, ...wording } = role;
    return { ...wording, evidenceRefs: refs };
  });
  payload.competitors.filter(item => item.confirmed).forEach((competitor, index) => {
    const refs = source(`competitor:${index}`, "manual", `User-confirmed competitor mapping: ${JSON.stringify(competitor)}`);
    add(`competitor:${index}`, competitor.brandName, "competitor", null, refs);
  });
  facts.forEach((fact, index) => {
    const refs = source(`fact:${index}`, fact.source === "crawl" ? "crawl" : "manual", `Admitted ${fact.source} fact: ${JSON.stringify(fact)}`);
    add(`fact:${index}`, fact.value, "fact", null, refs);
  });
  const input: GeoQuestionSynthesisInput = { officialName: payload.officialName, aliases: payload.aliases, language: payload.market.language, roles, entities: selected, evidenceSources: sources };
  if (bytes(input) > INPUT_BUDGET || !parseGeoQuestionSynthesisInput(input).ok) throw new Error("Invalid or oversized semantic question input");
  return { input, availableEvidenceCounts: countEvidence(sources), selectedEvidenceCounts: countEvidence(sources), availableEntityCounts: countEntities(all), selectedEntityCounts: countEntities(selected) };
}
