// Verification-only helper. Never imported by a product route or production worker.
import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { createKeywordLlmClient, type KeywordLlmClient, type KeywordLlmConfig } from "../src/lib/tools/keyword-llm-client.ts";
import { emptyMarketingWebsiteProfile, canonicalProfileJson, WEBSITE_PROFILE_FIELD_NAMES, type MarketingWebsiteProfileV1 } from "../src/lib/account-websites/contracts.ts";
import { createGeoProfileCopy } from "../src/lib/geo-tools/kb-profile-copy.ts";
import { emptyGeoKbPayload } from "../src/lib/geo-tools/kb-contract.ts";
import { parseGeoKbPayloadV2 } from "../src/lib/geo-tools/kb-v2-contract.ts";
import { buildGeoRoleSynthesisBasis, buildGeoQuestionSynthesisBasis } from "../src/lib/geo-tools/kb-synthesis-input.ts";
import { resolveGeoBriefLlmConfig } from "../src/lib/geo-tools/brief-llm.ts";
import { prepareGeoRoleSynthesis, prepareGeoQuestionSynthesis, synthesizeGeoKbRoles, synthesizeGeoKbQuestions, isUsableGeoSynthesisConfig, type GeoSynthesisResult } from "../src/lib/geo-tools/kb-synthesis.ts";
import { parseGeoRoleSynthesis, parseGeoRoleSynthesisInput, parseGeoQuestionSynthesisInput, type GeoRoleSynthesis, type GeoRoleSynthesisInput, type GeoQuestionSynthesisInput, type GeoSynthesisSource } from "../src/lib/geo-tools/kb-synthesis-contract.ts";
import { buildGeoPreparedKnowledgeBase } from "../src/lib/geo-tools/kb-preparation.ts";
import { parseGeoPreparedCandidate, type GeoPreparedCandidateV1 } from "../src/lib/geo-tools/kb-prepared-contract.ts";

export interface GeoKbCanaryOptions { readonly stage: "roles" | "questions"; readonly envFile: string; readonly outputDir: string; readonly rolesReviewed?: boolean; readonly retryFailedRoles?: boolean; readonly retryFailedQuestions?: boolean }
export interface GeoKbCanaryDependencies { readonly readEnvFile?: (path: string) => Promise<string>; readonly client?: KeywordLlmClient; readonly now?: () => Date }
export interface GeoKbCanarySummary {
  readonly stage: "roles" | "questions";
  readonly ok: boolean;
  readonly scope: "local_verification_only";
  readonly attemptedCalls: number;
  readonly delivery: string;
  readonly modelRequested: string | null;
  readonly usage: { readonly inputTokens: number | null; readonly outputTokens: number | null; readonly requestCount: number; readonly retryCount: number };
  readonly roles?: number;
  readonly categories?: number;
  readonly semanticQuestions?: number;
  readonly registryQuestions?: number;
  readonly candidateHash?: string;
  readonly reason?: string;
}
export class GeoKbCanaryError extends Error { constructor(readonly code: string) { super(code); this.name = "GeoKbCanaryError"; } }
const SCOPE = "local_verification_only" as const;
const SCHEMA = "geo-kb-semantic-canary.v1";
const IDS = { website: "10000000-0000-4000-8000-000000000001", profile: "10000000-0000-4000-8000-000000000002", kb: "10000000-0000-4000-8000-000000000003", roles: "10000000-0000-4000-8000-000000000004", candidate: "10000000-0000-4000-8000-000000000005" } as const;
type AttemptStage = GeoKbCanaryOptions["stage"] | "roles-retry" | "questions-retry";
const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (code: string): never => { throw new GeoKbCanaryError(code); };

/** Explicit verification mapping only. The product runtime's fallback is not changed. */
export function resolveGeoKbCanaryConfig(envText: string): { readonly config: KeywordLlmConfig; readonly mapping: "geo_brief" | "explicit_azure_verification" } {
  try {
    if (Buffer.byteLength(envText) > 1_048_576) return fail("not_configured");
    const env = parseEnv(envText);
    const present = (key: string) => typeof env[key] === "string" && env[key]!.trim() !== "" ? env[key]!.trim() : null;
    const keys = ["GEO_BRIEF_API_KEY", "GEO_BRIEF_MODEL", "GEO_BRIEF_URL", "GEO_BRIEF_AUTH_SCHEME", "GEO_BRIEF_TEMPERATURE"];
    let mapped: Record<string, string | undefined>, mapping: "geo_brief" | "explicit_azure_verification";
    if (keys.some(key => Object.hasOwn(env, key))) {
      // Presence is intentional even when the value is blank. In particular,
      // the product resolver must reject an explicitly empty temperature.
      mapped = Object.fromEntries(keys.filter(key => Object.hasOwn(env, key)).map(key => [key, env[key]])); mapping = "geo_brief";
    } else {
      const apiKey = present("AZURE_OPENAI_API_KEY"), endpoint = present("AZURE_OPENAI_ENDPOINT"), model = present("AZURE_OPENAI_DEPLOYMENT"), version = present("OPENAI_API_VERSION"), temperature = present("OPENAI_TEMPERATURE");
      if (!apiKey || !endpoint || !model || !version || !temperature) return fail("not_configured");
      const url = new URL(endpoint), prefix = url.pathname.replace(/\/+$/, "");
      url.pathname = `${prefix}/openai/deployments/${encodeURIComponent(model)}/chat/completions`;
      url.searchParams.set("api-version", version);
      mapped = { GEO_BRIEF_API_KEY: apiKey, GEO_BRIEF_MODEL: model, GEO_BRIEF_URL: url.toString(), GEO_BRIEF_AUTH_SCHEME: "api-key", GEO_BRIEF_TEMPERATURE: temperature };
      mapping = "explicit_azure_verification";
    }
    const config = resolveGeoBriefLlmConfig(mapped);
    if (!isUsableGeoSynthesisConfig(config) || config.model.includes("://")) return fail("not_configured");
    return { config, mapping };
  } catch { return fail("not_configured"); }
}

/** Only the owner's supplied public product description is used. No GSC,
 * analytics, crawl receipts, demographics, numeric examples or verified facts. */
function seed() {
  const base: MarketingWebsiteProfileV1 = { ...emptyMarketingWebsiteProfile(), productName: "AstrologyWiki",
    oneLinePositioning: "A psychological astrology knowledge base with free birth-chart tools for astrology beginners and self-directed learners.",
    valueProposition: "Understand astrology through modern psychological language rather than fatalistic prediction.",
    coreFeatures: ["Psychological astrology knowledge base", "Free birth-chart tools", "Topics covering natal charts, synastry and Saturn return"],
    categories: ["birth chart calculator", "natal chart", "synastry", "saturn return"],
    primaryIcp: "Astrology beginners and self-directed learners", user: "Astrology beginners and self-directed learners", country: "US", locale: "en",
  };
  const profile: MarketingWebsiteProfileV1 = { ...base, fieldProvenance: WEBSITE_PROFILE_FIELD_NAMES.filter(field => {
    const value = base[field]; return typeof value === "string" ? value !== "" : value.length > 0;
  }).map(field => ({ path: `/${field}`, derivation: "declared", confidence: "unknown", source: "supplied_product_information", limitation: "Local canary seed supplied by the owner, not independently crawled or verified. US/en is a verification parameter, not observed market demand.", observedAt: null, evidenceUrls: [] })) };
  const profileHash = createHash("sha256").update(canonicalProfileJson(profile)).digest("hex");
  const copy = createGeoProfileCopy({ schemaVersion: "website-profile-reference.v1", websiteId: IDS.website, snapshotId: IDS.profile, snapshotRevision: 1, profileSchemaVersion: profile.schemaVersion, profileHash }, profile);
  return { ...emptyGeoKbPayload("https://astrologywiki.com"), officialName: "AstrologyWiki", aliases: ["AstrologyWiki", "Astrology Wiki", "astrologywiki.com"], categoryTerms: [...profile.categories], market: { country: "US", language: "en" }, profileCopy: copy, roles: [], facts: [] };
}

async function ensureDirectory(outputDir: string): Promise<string> {
  const path = resolve(outputDir);
  if (path === resolve("/")) return fail("invalid_output_directory");
  try { await mkdir(path, { recursive: true, mode: 0o700 }); return path; } catch { return fail("output_unavailable"); }
}
async function assertUnused(directory: string, stage: AttemptStage): Promise<void> {
  const files = await readdir(directory);
  if (files.includes(`.${stage}.attempt`)) return fail("stage_already_attempted");
  if (files.filter(name => name.endsWith(".attempt")).length >= 4) return fail("attempt_budget_exhausted");
}
async function reserve(directory: string, stage: AttemptStage, seedHash: string, at: string): Promise<void> {
  const lockPath = join(directory, ".budget.lock");
  let lock;
  try { lock = await open(lockPath, "wx", 0o600); } catch { return fail("attempt_budget_busy"); }
  try {
    await assertUnused(directory, stage);
    const marker = await open(join(directory, `.${stage}.attempt`), "wx", 0o600).catch(() => fail("stage_already_attempted"));
    const policy = stage === "roles-retry" || stage === "questions-retry"
      ? "Consumed before the one explicitly operator-authorized retry; never remove or retry again."
      : "Consumed before dispatch; never remove or retry an uncertain/invalid attempt.";
    try { await marker.writeFile(JSON.stringify({ schemaVersion: "geo-kb-canary-attempt.v1", scope: SCOPE, stage, seedHash, reservedAt: at, policy })); await marker.sync(); }
    finally { await marker.close(); }
  } finally { await lock.close(); await unlink(lockPath); }
}
async function writeSafe(directory: string, filename: string, value: unknown, config: KeywordLlmConfig): Promise<void> {
  const text = JSON.stringify(value, null, 2) + "\n";
  for (const secret of [config.apiKey, config.url]) if (text.includes(secret) || text.includes(JSON.stringify(secret).slice(1, -1))) return fail("unsafe_output");
  const file = await open(join(directory, filename), "wx", 0o600).catch(() => fail("output_conflict"));
  try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
}
function object(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
const keysAre = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).sort().join("\n") === [...keys].sort().join("\n");
async function retryEligibility(directory: string, expected: GeoRoleSynthesisInput, expectedSeed: unknown, seedHash: string): Promise<string> {
  try {
    const [markerRaw, inputRaw, resultRaw] = await Promise.all([
      readFile(join(directory, ".roles.attempt"), "utf8"), readFile(join(directory, "roles-input.json"), "utf8"), readFile(join(directory, "roles-result.json"), "utf8"),
    ]);
    const marker = object(JSON.parse(markerRaw)), inputRecord = object(JSON.parse(inputRaw)), record = object(JSON.parse(resultRaw));
    const result = object(record?.result), summary = object(record?.summary);
    if (!marker || !inputRecord || !record || !result || !summary
      || !keysAre(marker, ["schemaVersion", "scope", "stage", "seedHash", "reservedAt", "policy"])
      || marker.schemaVersion !== "geo-kb-canary-attempt.v1" || marker.scope !== SCOPE || marker.stage !== "roles" || marker.seedHash !== seedHash
      || typeof marker.reservedAt !== "string" || !Number.isFinite(Date.parse(marker.reservedAt)) || typeof marker.policy !== "string"
      || !keysAre(inputRecord, ["schemaVersion", "scope", "stage", "mapping", "seed", "seedHash", "input", "promptVersion", "promptHash", "reviewStatement"])
      || inputRecord.schemaVersion !== SCHEMA || inputRecord.scope !== SCOPE || inputRecord.stage !== "roles" || inputRecord.seedHash !== seedHash
      || digest(inputRecord.seed) !== seedHash || digest(expectedSeed) !== seedHash || digest(inputRecord.input) !== digest(expected)
      || typeof inputRecord.promptVersion !== "string" || !/^[a-f0-9]{64}$/u.test(String(inputRecord.promptHash))
      || record.schemaVersion !== SCHEMA || record.scope !== SCOPE || record.stage !== "roles" || record.seedHash !== seedHash
      || record.ok !== false || result.ok !== false || result.attemptedCalls !== 1 || result.delivery !== "outcome_unknown" || result.reason !== "network_error"
      || summary.ok !== false || summary.attemptedCalls !== 1 || summary.delivery !== "outcome_unknown" || summary.reason !== "network_error"
      || marker.reservedAt !== record.createdAt || digest(record.input) !== digest(expected) || digest(record.input) !== digest(inputRecord.input)) return fail("roles_retry_not_eligible");
    const { artifactHash, ...body } = record;
    if (typeof artifactHash !== "string" || artifactHash !== digest(body)) return fail("roles_retry_not_eligible");
    const parsed = parseGeoRoleSynthesisInput(record.input);
    if (!parsed.ok) return fail("roles_retry_not_eligible");
    return artifactHash;
  } catch (error) { if (error instanceof GeoKbCanaryError) throw error; return fail("roles_retry_not_eligible"); }
}
async function readSuccessfulRoles(directory: string, expected: GeoRoleSynthesisInput, seedHash: string): Promise<GeoRoleSynthesis> {
  let raw: unknown;
  try {
    const files = await readdir(directory), retried = files.includes(".roles-retry.attempt");
    if (!files.includes(".roles.attempt")) return fail("roles_not_successful");
    const retryOfArtifactHash = retried ? await retryEligibility(directory, expected, seed(), seedHash) : null;
    raw = JSON.parse(await readFile(join(directory, retried ? "roles-retry-result.json" : "roles-result.json"), "utf8"));
    if (retried && object(raw)?.retryOfArtifactHash !== retryOfArtifactHash) return fail("roles_evidence_invalid");
  } catch (error) { if (error instanceof GeoKbCanaryError) throw error; return fail("roles_not_successful"); }
  const record = object(raw), result = object(record?.result);
  if (!record || record.ok !== true || !result || result.ok !== true) return fail("roles_not_successful");
  const { artifactHash, ...body } = record;
  if (record.schemaVersion !== SCHEMA || record.scope !== SCOPE || record.stage !== "roles" || record.seedHash !== seedHash || artifactHash !== digest(body) || digest(record.input) !== digest(expected)) return fail("roles_evidence_invalid");
  const input = parseGeoRoleSynthesisInput(record.input);
  if (!input.ok || result.delivery !== "response_received" || result.attemptedCalls !== 1) return fail("roles_evidence_invalid");
  const parsed = parseGeoRoleSynthesis(result.value, input.value);
  return parsed.ok ? parsed.value : fail("roles_evidence_invalid");
}
async function questionRetryEligibility(directory: string, expected: GeoQuestionSynthesisInput, expectedPayload: unknown, seedHash: string): Promise<string> {
  try {
    const files = await readdir(directory);
    if (!files.includes(".roles-retry.attempt") || files.includes("candidate.json")) return fail("questions_retry_not_eligible");
    const [markerRaw, inputRaw, resultRaw] = await Promise.all([
      readFile(join(directory, ".questions.attempt"), "utf8"), readFile(join(directory, "questions-input.json"), "utf8"), readFile(join(directory, "questions-result.json"), "utf8"),
    ]);
    const marker = object(JSON.parse(markerRaw)), inputRecord = object(JSON.parse(inputRaw)), record = object(JSON.parse(resultRaw));
    const result = object(record?.result), summary = object(record?.summary);
    if (!marker || !inputRecord || !record || !result || !summary
      || !keysAre(marker, ["schemaVersion", "scope", "stage", "seedHash", "reservedAt", "policy"])
      || marker.schemaVersion !== "geo-kb-canary-attempt.v1" || marker.scope !== SCOPE || marker.stage !== "questions" || marker.seedHash !== seedHash
      || typeof marker.reservedAt !== "string" || !Number.isFinite(Date.parse(marker.reservedAt)) || typeof marker.policy !== "string"
      || !keysAre(inputRecord, ["schemaVersion", "scope", "stage", "mapping", "seedHash", "payload", "input", "promptVersion", "promptHash", "reviewStatement"])
      || inputRecord.schemaVersion !== SCHEMA || inputRecord.scope !== SCOPE || inputRecord.stage !== "questions" || inputRecord.seedHash !== seedHash
      || digest(inputRecord.payload) !== digest(expectedPayload) || digest(inputRecord.input) !== digest(expected)
      || typeof inputRecord.promptVersion !== "string" || !/^[a-f0-9]{64}$/u.test(String(inputRecord.promptHash))
      || record.schemaVersion !== SCHEMA || record.scope !== SCOPE || record.stage !== "questions" || record.seedHash !== seedHash
      || record.ok !== false || result.ok !== false || result.attemptedCalls !== 1 || result.delivery !== "response_received" || result.reason !== "schema_invalid"
      || summary.ok !== false || summary.attemptedCalls !== 1 || summary.delivery !== "response_received" || summary.reason !== "schema_invalid"
      || marker.reservedAt !== record.createdAt || digest(record.input) !== digest(expected) || digest(record.input) !== digest(inputRecord.input)) return fail("questions_retry_not_eligible");
    const { artifactHash, ...body } = record;
    if (typeof artifactHash !== "string" || artifactHash !== digest(body)) return fail("questions_retry_not_eligible");
    const parsed = parseGeoQuestionSynthesisInput(record.input);
    if (!parsed.ok) return fail("questions_retry_not_eligible");
    return artifactHash;
  } catch (error) { if (error instanceof GeoKbCanaryError) throw error; return fail("questions_retry_not_eligible"); }
}
function counts(catalogue: readonly GeoSynthesisSource[]) {
  const count = { profile: 0, gsc: 0, crawl: 0, manual: 0 };
  for (const source of catalogue) count[source.kind] += 1;
  return count;
}

export async function runGeoKbSemanticCanary(options: GeoKbCanaryOptions, dependencies: GeoKbCanaryDependencies = {}): Promise<GeoKbCanarySummary> {
  if (!["roles", "questions"].includes(options.stage) || !options.envFile || !options.outputDir
    || options.retryFailedRoles === true && (options.stage !== "roles" || options.rolesReviewed === true || options.retryFailedQuestions === true)
    || options.retryFailedQuestions === true && (options.stage !== "questions" || options.rolesReviewed !== true)) return fail("invalid_arguments");
  const directory = await ensureDirectory(options.outputDir);
  const attemptStage: AttemptStage = options.retryFailedRoles ? "roles-retry" : options.retryFailedQuestions ? "questions-retry" : options.stage;
  const artifactPrefix = attemptStage;
  await assertUnused(directory, attemptStage);
  if (options.stage === "questions" && !options.rolesReviewed) return fail("roles_review_required");
  const initial = seed(), seedHash = digest(initial), roleBasis = buildGeoRoleSynthesisBasis(initial, "zh", []);
  let retryOfArtifactHash = options.retryFailedRoles ? await retryEligibility(directory, roleBasis.input, initial, seedHash) : null;
  const adoptedRoles = options.stage === "questions" ? await readSuccessfulRoles(directory, roleBasis.input, seedHash) : null;
  let envText: string;
  try { envText = await (dependencies.readEnvFile ?? (path => readFile(path, "utf8")))(options.envFile); }
  catch { return fail("env_unavailable"); }
  const { config, mapping } = resolveGeoKbCanaryConfig(envText);
  const transport = dependencies.client ?? createKeywordLlmClient({ config });
  const capture: { error?: unknown } = {};
  const client = { client: { complete: async (request: Parameters<KeywordLlmClient["complete"]>[0]) => {
    const response = await transport.complete(request);
    // Retain only safe completion content, not HTTP headers or credentials.
    // A rejected schema can then be diagnosed offline without another call.
    try { await writeSafe(directory, `${artifactPrefix}-response.json`, { scope: SCOPE, stage: options.stage, content: response.content, usage: response.usage }, config); }
    catch (error) { capture.error = error; }
    return response;
  } } };
  const at = (dependencies.now ?? (() => new Date()))().toISOString();
  const reviewStatement = "Local verification fixture only. --roles-reviewed records the canary operator's review, not a production user's confirmation. No database save or production freeze is performed.";
  let result: GeoSynthesisResult<unknown>, input: unknown, candidate: GeoPreparedCandidateV1 | null = null, assemblyError: string | null = null;
  if (options.stage === "roles") {
    const prepared = prepareGeoRoleSynthesis(roleBasis.input, config);
    if (!prepared.ok) return fail(prepared.reason);
    input = prepared.value.input;
    await reserve(directory, attemptStage, seedHash, at);
    await writeSafe(directory, `${artifactPrefix}-input.json`, { schemaVersion: SCHEMA, scope: SCOPE, stage: "roles", mapping, seed: initial, seedHash, input, promptVersion: prepared.value.promptVersion, promptHash: digest(prepared.value.prompt), reviewStatement,
      ...(retryOfArtifactHash === null ? {} : { retryOfArtifactHash }) }, config);
    result = await synthesizeGeoKbRoles(prepared.value.input, { config, ...client, timeoutMs: prepared.value.timeoutMs });
    if (Object.hasOwn(capture, "error")) throw capture.error;
  } else {
    if (adoptedRoles === null) return fail("roles_not_successful");
    const payload = parseGeoKbPayloadV2({ ...initial, schemaVersion: "marketing-geo-kb.v2", categoryTerms: adoptedRoles.categoryTerms.map(item => item.text),
      roles: adoptedRoles.roles.map(({ evidenceRefs, ...wording }) => ({ ...wording, review: "accepted", source: { kind: "model", generationId: IDS.roles, itemId: wording.id, evidenceRefs } })), facts: [],
    });
    const basis = buildGeoQuestionSynthesisBasis(payload, []);
    const evidenceCatalog = [...basis.input.evidenceSources, ...roleBasis.input.sources];
    const semanticInput = { ...basis.input, evidenceSources: evidenceCatalog };
    const prepared = prepareGeoQuestionSynthesis(semanticInput, config);
    if (!prepared.ok) return fail(prepared.reason);
    input = prepared.value.input;
    if (options.retryFailedQuestions) retryOfArtifactHash = await questionRetryEligibility(directory, prepared.value.input, payload, seedHash);
    await reserve(directory, attemptStage, seedHash, at);
    await writeSafe(directory, `${artifactPrefix}-input.json`, { schemaVersion: SCHEMA, scope: SCOPE, stage: "questions", mapping, seedHash, payload, input, promptVersion: prepared.value.promptVersion, promptHash: digest(prepared.value.prompt), reviewStatement,
      ...(retryOfArtifactHash === null ? {} : { retryOfArtifactHash }) }, config);
    const completion = await synthesizeGeoKbQuestions(prepared.value.input, { config, ...client, timeoutMs: prepared.value.timeoutMs });
    if (Object.hasOwn(capture, "error")) throw capture.error;
    result = completion;
    if (completion.ok) {
      try {
        candidate = parseGeoPreparedCandidate(buildGeoPreparedKnowledgeBase({ candidateId: IDS.candidate, kbId: IDS.kb, baseDraftVersion: 1, payload,
          semanticInput: prepared.value.input, semanticOutput: completion.value, sourceReceiptRefs: [], evidenceCatalog,
          sourceSummary: { gsc: null, selectedEvidenceCounts: counts(evidenceCatalog), availableEvidenceCounts: counts(evidenceCatalog) },
          modelRoleEdits: Object.fromEntries(payload.roles.map(role => [role.id, false])), verifiedFactSupport: [],
        }));
      } catch { assemblyError = "candidate_invalid"; }
    }
    if (candidate !== null) await writeSafe(directory, "candidate.json", candidate, config);
  }
  const ok = result.ok && assemblyError === null;
  const summary: GeoKbCanarySummary = { stage: options.stage, ok, scope: SCOPE, attemptedCalls: result.attemptedCalls, delivery: result.delivery, modelRequested: result.provider?.modelRequested ?? null, usage: result.usage,
    ...(options.stage === "roles" && result.ok ? { roles: (result.value as GeoRoleSynthesis).roles.length, categories: (result.value as GeoRoleSynthesis).categoryTerms.length } : {}),
    ...(candidate === null ? {} : { semanticQuestions: candidate.questionSet.questions.filter(question => question.provenance.kind === "semantic").length, registryQuestions: candidate.questionSet.questions.filter(question => question.provenance.kind === "registry").length, candidateHash: candidate.candidateHash }),
    ...(!result.ok ? { reason: result.reason } : assemblyError === null ? {} : { reason: assemblyError }),
  };
  const body = { schemaVersion: SCHEMA, scope: SCOPE, stage: options.stage, seedHash, input, result, ok, summary, createdAt: at, reviewStatement,
    ...(retryOfArtifactHash === null ? {} : { retryOfArtifactHash }) };
  await writeSafe(directory, `${artifactPrefix}-result.json`, { ...body, artifactHash: digest(body) }, config);
  return summary;
}
