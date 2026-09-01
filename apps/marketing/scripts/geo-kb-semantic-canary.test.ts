import { mkdtemp, readFile, readdir, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeywordLlmError, type KeywordLlmRequest, type KeywordLlmClient } from "../src/lib/tools/keyword-llm-client.ts";
import { parseGeoPreparedCandidate } from "../src/lib/geo-tools/kb-prepared-contract.ts";
import { resolveGeoKbCanaryConfig, runGeoKbSemanticCanary, GeoKbCanaryError } from "./geo-kb-semantic-canary-lib.ts";
import { parseGeoKbCanaryArgs } from "./geo-kb-semantic-canary.ts";

const ENV = 'GEO_BRIEF_API_KEY="FAKE_CANARY_SECRET"\nGEO_BRIEF_MODEL="offline-model"\nGEO_BRIEF_URL="https://provider.example/private/completions"\nGEO_BRIEF_TEMPERATURE=1\nUNRELATED_SECRET=DO_NOT_COPY_THIS\n';
const AZURE = 'AZURE_OPENAI_API_KEY=FAKE_AZURE_SECRET\nAZURE_OPENAI_ENDPOINT=https://azure.example/prefix/\nAZURE_OPENAI_DEPLOYMENT=gpt-5.6-luna\nOPENAI_API_VERSION=2025-04-01-preview\nOPENAI_TEMPERATURE=1\n';
const directories: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory() { const path = await mkdtemp(join(tmpdir(), "geo-kb-canary-offline-")); directories.push(path); return path; }
function input(request: KeywordLlmRequest): Record<string, unknown> { return JSON.parse(request.user.slice("<input_data>".length, -"</input_data>".length)) as Record<string, unknown>; }
function reply(request: KeywordLlmRequest): unknown {
  const data = input(request);
  if ("sources" in data) {
    const sources = data.sources as { id: string; text: string }[];
    const source = (field: string) => sources.find(item => item.id.endsWith(`:${field}`))!.id;
    return { roles: [{ id: "beginner", label: "占星入门学习者", questionLabel: "astrology beginners", segment: "希望理解星盘基础的自学者", painPoints: ["难以理解出生星盘"], alternatives: [], decisionCriteria: ["现代心理语言解读"], vocabulary: ["出生星盘"], evidenceRefs: [source("primaryIcp"), source("oneLinePositioning")] }], categoryTerms: [{ text: "birth chart calculator", evidenceRefs: [source("categories")] }] };
  }
  const entities = data.entities as { id: string; text: string; kind: string; roleId: string | null; evidenceRefs: string[] }[];
  const words: Record<string, string> = { "难以理解出生星盘": "understanding birth charts", "现代心理语言解读": "psychological language", "出生星盘": "birth charts" };
  const entity = (kind: string) => entities.find(item => item.kind === kind)!;
  const question = (id: string, kind: string, layer: string, sentence: (text: string) => string) => {
    const value = entity(kind), text = words[value.text] ?? value.text;
    return { id, text: sentence(text), layer, roleId: value.roleId, entityRefs: [value.id], evidenceRefs: value.evidenceRefs };
  };
  return { entities: entities.map(item => ({ id: item.id, text: words[item.text] ?? item.text })), questions: [
    question("problem", "role_pain", "problem", text => `How can astrology beginners improve ${text}?`),
    question("evaluation", "role_criterion", "evaluation", text => `How can beginners evaluate ${text} in an astrology resource?`),
    question("discovery", "category", "discovery", text => `Which ${text} is suitable for beginners?`),
    question("branded", "brand", "branded", text => `What is ${text}?`),
  ] };
}
function client() {
  return { complete: vi.fn(async (request: KeywordLlmRequest) => ({ content: JSON.stringify(reply(request)), usage: { inputTokens: 100, outputTokens: 200, requestCount: 1, retryCount: 0 }, modelId: "offline-response" })) };
}
const options = (stage: "roles" | "questions", outputDir: string) => ({ stage, outputDir, envFile: "/not-read/fixture.env" });
const deps = (value: KeywordLlmClient = client()) => ({ client: value, readEnvFile: vi.fn(async () => ENV), now: () => new Date("2026-08-31T12:00:00.000Z") });
async function prepareRetriedRoles(outputDir: string): Promise<void> {
  await runGeoKbSemanticCanary(options("roles", outputDir), deps({ complete: vi.fn(async () => { throw new KeywordLlmError("network_error", "offline"); }) }));
  await runGeoKbSemanticCanary({ ...options("roles", outputDir), retryFailedRoles: true }, deps());
}
const schemaInvalidClient = () => ({ complete: vi.fn(async () => ({ content: '{"entities":[],"questions":[]}', usage: { inputTokens: 50, outputTokens: 30, requestCount: 1, retryCount: 0 } })) });

describe("verification-only GEO config mapping", () => {
  it("requires explicit stage/file/output arguments and never accepts arbitrary CLI options", () => {
    expect(parseGeoKbCanaryArgs(["--stage", "roles", "--env-file", "/fake.env", "--output-dir", "/fake-output"])).toEqual({ stage: "roles", envFile: "/fake.env", outputDir: "/fake-output", rolesReviewed: false, retryFailedRoles: false, retryFailedQuestions: false });
    expect(parseGeoKbCanaryArgs(["--stage", "roles", "--env-file", "/fake.env", "--output-dir", "/fake-output", "--retry-failed-roles"]).retryFailedRoles).toBe(true);
    expect(parseGeoKbCanaryArgs(["--stage", "questions", "--env-file", "/fake.env", "--output-dir", "/fake-output", "--roles-reviewed"]).rolesReviewed).toBe(true);
    expect(parseGeoKbCanaryArgs(["--stage", "questions", "--env-file", "/fake.env", "--output-dir", "/fake-output", "--roles-reviewed", "--retry-failed-questions"]).retryFailedQuestions).toBe(true);
    for (const args of [[], ["--stage", "other"], ["--stage", "roles", "--env-file", "/fake.env", "--output-dir", "/fake-output", "--retry"], ["--stage", "roles", "--env-file", "/fake.env", "--output-dir", "/fake-output", "--roles-reviewed"], ["--stage", "questions", "--env-file", "/fake.env", "--output-dir", "/fake-output", "--retry-failed-roles"], ["--stage", "questions", "--env-file", "/fake.env", "--output-dir", "/fake-output", "--retry-failed-questions"], ["--stage", "roles", "--env-file", "/fake.env", "--output-dir", "/fake-output", "--retry-failed-questions"]]) expect(() => parseGeoKbCanaryArgs(args)).toThrow(GeoKbCanaryError);
  });
  it("prefers a complete GEO set and never populates unrelated process variables", () => {
    const before = process.env["GEO_CANARY_TEST_SENTINEL"];
    const value = resolveGeoKbCanaryConfig(ENV + AZURE + "GEO_CANARY_TEST_SENTINEL=not-exported\n");
    expect(value.mapping).toBe("geo_brief"); expect(value.config.model).toBe("offline-model");
    expect(process.env["GEO_CANARY_TEST_SENTINEL"]).toBe(before);
  });
  it("explicitly maps complete existing Azure fields with worker-compatible path construction", () => {
    const value = resolveGeoKbCanaryConfig(AZURE);
    expect(value.mapping).toBe("explicit_azure_verification");
    expect(value.config).toMatchObject({ apiKey: "FAKE_AZURE_SECRET", model: "gpt-5.6-luna", authScheme: "api-key", temperature: 1,
      url: "https://azure.example/prefix/openai/deployments/gpt-5.6-luna/chat/completions?api-version=2025-04-01-preview" });
  });
  it.each(["OPENAI_API_KEY=other\nOPENAI_MODEL=other", "GEO_BRIEF_API_KEY=partial\n" + AZURE, AZURE.replace("OPENAI_TEMPERATURE=1", ""), AZURE.replace("OPENAI_API_VERSION=2025-04-01-preview", "")])("rejects unsupported/partial config without another fallback", env => {
    expect(() => resolveGeoKbCanaryConfig(env)).toThrow(GeoKbCanaryError);
  });
  it.each([ENV.replace("GEO_BRIEF_TEMPERATURE=1", 'GEO_BRIEF_TEMPERATURE=""'), ENV.replace("GEO_BRIEF_TEMPERATURE=1", 'GEO_BRIEF_TEMPERATURE="  "'), AZURE + "GEO_BRIEF_API_KEY=\nGEO_BRIEF_MODEL=\n"])("keeps explicitly empty dedicated GEO config invalid rather than falling back", env => {
    expect(() => resolveGeoKbCanaryConfig(env)).toThrow(GeoKbCanaryError);
  });
});

describe("standalone CLI without any real configuration or execution", () => {
  it("imports under node --import tsx without env/model side effects", async () => {
    const script = new URL("./geo-kb-semantic-canary.ts", import.meta.url).href;
    const cwd = fileURLToPath(new URL("../../../", import.meta.url));
    const code = `globalThis.fetch = () => { throw new Error('unexpected network'); }; await import(${JSON.stringify(script)}); process.stdout.write('CANARY_IMPORT_ONLY_OK');`;
    const result = await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", code], { cwd, timeout: 30_000 });
    expect(result.stdout).toBe("CANARY_IMPORT_ONLY_OK"); expect(result.stderr).toBe("");
  });
  it("runs the exact CLI with a synthetic unconfigured env and spends no attempt", async () => {
    const root = await directory(), envFile = join(root, "fake.env"), outputDir = join(root, "output");
    await writeFile(envFile, "UNRELATED_CANARY_TEST_VALUE=offline\n", { flag: "wx", mode: 0o600 });
    const command = promisify(execFile)(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./geo-kb-semantic-canary.ts", import.meta.url)), "--stage", "roles", "--env-file", envFile, "--output-dir", outputDir], { cwd: fileURLToPath(new URL("../../../", import.meta.url)), timeout: 30_000 });
    await expect(command).rejects.toMatchObject({ code: 1, stdout: "", stderr: '{"ok":false,"scope":"local_verification_only","code":"not_configured"}\n' });
    expect((await readdir(outputDir)).filter(name => name.endsWith(".attempt"))).toHaveLength(0);
  });
});

describe("two-stage exclusive local canary", () => {
  it("keeps the exact safe model response for offline diagnosis without buying a repair call", async () => {
    const outputDir = await directory();
    const client = { complete: vi.fn(async () => ({ content: '{"unexpected":"untrusted output"}', usage: { inputTokens: 12, outputTokens: 14, requestCount: 1, retryCount: 0 } })) };
    const result = await runGeoKbSemanticCanary(options("roles", outputDir), deps(client));
    expect(result.ok).toBe(false);
    expect(JSON.parse(await readFile(join(outputDir, "roles-response.json"), "utf8"))).toMatchObject({ content: '{"unexpected":"untrusted output"}', usage: { inputTokens: 12, outputTokens: 14 } });
    expect(client.complete).toHaveBeenCalledTimes(1);
    await expect(runGeoKbSemanticCanary(options("roles", outputDir), deps(client))).rejects.toMatchObject({ code: "stage_already_attempted" });
  });
  it("runs exactly two reviewed model calls through real parsers and assembles a full local candidate", async () => {
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No unexpected network permitted in offline test"); }));
    const outputDir = await directory(), dependencies = deps();
    const roles = await runGeoKbSemanticCanary(options("roles", outputDir), dependencies);
    expect(roles).toMatchObject({ ok: true, stage: "roles", scope: "local_verification_only", roles: 1, categories: 1, attemptedCalls: 1 });
    await expect(runGeoKbSemanticCanary(options("questions", outputDir), dependencies)).rejects.toMatchObject({ code: "roles_review_required" });
    expect(dependencies.client.complete).toHaveBeenCalledTimes(1);
    const questions = await runGeoKbSemanticCanary({ ...options("questions", outputDir), rolesReviewed: true }, dependencies);
    expect(questions).toMatchObject({ ok: true, stage: "questions", scope: "local_verification_only", semanticQuestions: 4 });
    expect(dependencies.client.complete).toHaveBeenCalledTimes(2);
    const candidate = parseGeoPreparedCandidate(JSON.parse(await readFile(join(outputDir, "candidate.json"), "utf8")));
    expect(candidate.payload.officialName).toBe("AstrologyWiki"); expect(candidate.payload.facts).toEqual([]); expect(candidate.context.sourceSummary.gsc).toBeNull();
    expect(candidate.questionSet.questions.filter(q => q.provenance.kind === "semantic").every(q => !q.calibrated && q.mode === "demand")).toBe(true);
    const files = await readdir(outputDir);
    expect(files.filter(name => name.endsWith(".attempt"))).toHaveLength(2);
    for (const name of files) {
      const text = await readFile(join(outputDir, name), "utf8");
      expect(text).not.toContain("FAKE_CANARY_SECRET"); expect(text).not.toContain("DO_NOT_COPY_THIS"); expect(text).not.toContain("provider.example");
    }
    expect((await stat(join(outputDir, ".roles.attempt"))).mode & 0o777).toBe(0o600);
    const safeInput = JSON.parse(await readFile(join(outputDir, "roles-input.json"), "utf8"));
    expect(safeInput.input.sources.every((source: { kind: string }) => source.kind === "profile")).toBe(true);
    expect(await readdir(outputDir)).not.toContain(".budget.lock");
    for (const stage of ["roles", "questions"] as const) await expect(runGeoKbSemanticCanary({ ...options(stage, outputDir), rolesReviewed: true }, dependencies)).rejects.toMatchObject({ code: "stage_already_attempted" });
    expect(dependencies.client.complete).toHaveBeenCalledTimes(2);
  });
  it("permanently consumes an uncertain role attempt and never unlocks the questions stage", async () => {
    const outputDir = await directory(), dependencies = deps({ complete: vi.fn(async () => { throw new KeywordLlmError("timeout", "DO_NOT_PRINT_PROVIDER_DIAGNOSTIC"); }) });
    const result = await runGeoKbSemanticCanary(options("roles", outputDir), dependencies);
    expect(result).toMatchObject({ ok: false, delivery: "outcome_unknown", attemptedCalls: 1 });
    await expect(runGeoKbSemanticCanary(options("roles", outputDir), dependencies)).rejects.toMatchObject({ code: "stage_already_attempted" });
    await expect(runGeoKbSemanticCanary({ ...options("questions", outputDir), rolesReviewed: true }, dependencies)).rejects.toMatchObject({ code: "roles_not_successful" });
    expect(dependencies.client.complete).toHaveBeenCalledTimes(1);
    expect(await readFile(join(outputDir, "roles-result.json"), "utf8")).not.toContain("DO_NOT_PRINT_PROVIDER_DIAGNOSTIC");
  });
  it("uses one explicit successful role retry, then the reviewed question call, within the three-call budget", async () => {
    const outputDir = await directory();
    const failed = deps({ complete: vi.fn(async () => { throw new KeywordLlmError("network_error", "DO_NOT_PRINT_PROVIDER_DIAGNOSTIC"); }) });
    expect(await runGeoKbSemanticCanary(options("roles", outputDir), failed)).toMatchObject({ ok: false, reason: "network_error", delivery: "outcome_unknown", attemptedCalls: 1 });
    const firstResult = await readFile(join(outputDir, "roles-result.json"), "utf8");
    const successful = deps();
    expect(await runGeoKbSemanticCanary({ ...options("roles", outputDir), retryFailedRoles: true }, successful)).toMatchObject({ ok: true, stage: "roles", roles: 1, categories: 1 });
    expect(await readFile(join(outputDir, "roles-result.json"), "utf8")).toBe(firstResult);
    const questions = await runGeoKbSemanticCanary({ ...options("questions", outputDir), rolesReviewed: true }, successful);
    expect(questions).toMatchObject({ ok: true, semanticQuestions: 4 });
    expect(successful.client.complete).toHaveBeenCalledTimes(2);
    const files = await readdir(outputDir);
    expect(files.filter(name => name.endsWith(".attempt")).sort()).toEqual([".questions.attempt", ".roles-retry.attempt", ".roles.attempt"]);
    for (const name of ["roles-retry-input.json", "roles-retry-response.json", "roles-retry-result.json"]) expect(files).toContain(name);
  });
  it("rejects a duplicate explicit retry without issuing another call", async () => {
    const outputDir = await directory();
    await runGeoKbSemanticCanary(options("roles", outputDir), deps({ complete: vi.fn(async () => { throw new KeywordLlmError("network_error", "offline"); }) }));
    const successful = deps();
    await runGeoKbSemanticCanary({ ...options("roles", outputDir), retryFailedRoles: true }, successful);
    await expect(runGeoKbSemanticCanary({ ...options("roles", outputDir), retryFailedRoles: true }, successful)).rejects.toMatchObject({ code: "stage_already_attempted" });
    expect(successful.client.complete).toHaveBeenCalledTimes(1);
  });
  it("uses one explicit successful questions retry and creates the candidate only after that fourth call", async () => {
    const outputDir = await directory(); await prepareRetriedRoles(outputDir);
    const failed = deps(schemaInvalidClient());
    expect(await runGeoKbSemanticCanary({ ...options("questions", outputDir), rolesReviewed: true }, failed)).toMatchObject({ ok: false, reason: "schema_invalid", delivery: "response_received", attemptedCalls: 1 });
    expect(await readdir(outputDir)).not.toContain("candidate.json");
    const retry = deps();
    expect(await runGeoKbSemanticCanary({ ...options("questions", outputDir), rolesReviewed: true, retryFailedQuestions: true }, retry)).toMatchObject({ ok: true, semanticQuestions: 4 });
    expect(retry.client.complete).toHaveBeenCalledTimes(1);
    expect(parseGeoPreparedCandidate(JSON.parse(await readFile(join(outputDir, "candidate.json"), "utf8"))).payload.officialName).toBe("AstrologyWiki");
    const files = await readdir(outputDir);
    expect(files.filter(name => name.endsWith(".attempt")).sort()).toEqual([".questions-retry.attempt", ".questions.attempt", ".roles-retry.attempt", ".roles.attempt"]);
    for (const name of ["questions-retry-input.json", "questions-retry-response.json", "questions-retry-result.json"]) expect(files).toContain(name);
  });
  it("rejects a duplicate questions retry without issuing another call", async () => {
    const outputDir = await directory(); await prepareRetriedRoles(outputDir);
    await runGeoKbSemanticCanary({ ...options("questions", outputDir), rolesReviewed: true }, deps(schemaInvalidClient()));
    const retry = deps();
    await runGeoKbSemanticCanary({ ...options("questions", outputDir), rolesReviewed: true, retryFailedQuestions: true }, retry);
    await expect(runGeoKbSemanticCanary({ ...options("questions", outputDir), rolesReviewed: true, retryFailedQuestions: true }, retry)).rejects.toMatchObject({ code: "stage_already_attempted" });
    expect(retry.client.complete).toHaveBeenCalledTimes(1);
  });
  it.each(["missing", "forged", "successful", "wrong_failure"] as const)("rejects %s first-question proof before reserving an explicit questions retry", async kind => {
    const outputDir = await directory(); await prepareRetriedRoles(outputDir);
    if (kind !== "missing") {
      await runGeoKbSemanticCanary({ ...options("questions", outputDir), rolesReviewed: true }, deps(kind === "successful" ? client() : kind === "wrong_failure" ? { complete: vi.fn(async () => ({ content: "invalid JSON", usage: { inputTokens: 1, outputTokens: 2, requestCount: 1, retryCount: 0 } })) } : schemaInvalidClient()));
      if (kind === "forged") {
        const path = join(outputDir, "questions-result.json"), value = JSON.parse(await readFile(path, "utf8"));
        value.result.reason = "schema_invalid-forged"; await writeFile(path, JSON.stringify(value));
      }
    }
    const retry = deps();
    await expect(runGeoKbSemanticCanary({ ...options("questions", outputDir), rolesReviewed: true, retryFailedQuestions: true }, retry)).rejects.toMatchObject({ code: "questions_retry_not_eligible" });
    expect(retry.client.complete).not.toHaveBeenCalled();
    expect((await readdir(outputDir)).filter(name => name === ".questions-retry.attempt")).toHaveLength(0);
  });
  it.each(["missing", "forged", "successful"] as const)("rejects %s first-attempt proof before reserving an explicit retry", async kind => {
    const outputDir = await directory();
    if (kind !== "missing") {
      const transport = kind === "successful" ? client() : { complete: vi.fn(async () => { throw new KeywordLlmError("network_error", "offline"); }) };
      await runGeoKbSemanticCanary(options("roles", outputDir), deps(transport));
      if (kind === "forged") {
        const path = join(outputDir, "roles-result.json"), value = JSON.parse(await readFile(path, "utf8"));
        value.result.reason = "network_error-forged"; await writeFile(path, JSON.stringify(value));
      }
    }
    const retry = deps();
    await expect(runGeoKbSemanticCanary({ ...options("roles", outputDir), retryFailedRoles: true }, retry)).rejects.toMatchObject({ code: "roles_retry_not_eligible" });
    expect(retry.client.complete).not.toHaveBeenCalled();
    expect((await readdir(outputDir)).filter(name => name === ".roles-retry.attempt")).toHaveLength(0);
  });
  it("does not repair or retry an invalid JSON reply", async () => {
    const outputDir = await directory(), dependencies = deps({ complete: vi.fn(async () => ({ content: "invalid JSON", usage: { inputTokens: 1, outputTokens: 2, requestCount: 1, retryCount: 0 } })) });
    expect(await runGeoKbSemanticCanary(options("roles", outputDir), dependencies)).toMatchObject({ ok: false, reason: "invalid_response" });
    await expect(runGeoKbSemanticCanary(options("roles", outputDir), dependencies)).rejects.toMatchObject({ code: "stage_already_attempted" });
    expect(dependencies.client.complete).toHaveBeenCalledTimes(1);
  });
  it("serializes concurrent claims so a duplicate stage cannot issue two calls", async () => {
    const outputDir = await directory(), dependencies = deps();
    const results = await Promise.allSettled([runGeoKbSemanticCanary(options("roles", outputDir), dependencies), runGeoKbSemanticCanary(options("roles", outputDir), dependencies)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(dependencies.client.complete).toHaveBeenCalledTimes(1);
  });
  it("refuses a directory whose total attempt budget is already spent", async () => {
    const outputDir = await directory(), dependencies = deps();
    await writeFile(join(outputDir, ".prior-a.attempt"), "{}", { flag: "wx" }); await writeFile(join(outputDir, ".prior-b.attempt"), "{}", { flag: "wx" }); await writeFile(join(outputDir, ".prior-c.attempt"), "{}", { flag: "wx" }); await writeFile(join(outputDir, ".prior-d.attempt"), "{}", { flag: "wx" });
    await expect(runGeoKbSemanticCanary(options("roles", outputDir), dependencies)).rejects.toMatchObject({ code: "attempt_budget_exhausted" });
    expect(dependencies.client.complete).not.toHaveBeenCalled();
  });
  it("refuses missing or altered successful role evidence before the second call", async () => {
    const outputDir = await directory(), dependencies = deps();
    await expect(runGeoKbSemanticCanary({ ...options("questions", outputDir), rolesReviewed: true }, dependencies)).rejects.toMatchObject({ code: "roles_not_successful" });
    await runGeoKbSemanticCanary(options("roles", outputDir), dependencies);
    const path = join(outputDir, "roles-result.json"), original = JSON.parse(await readFile(path, "utf8"));
    original.result.value.roles[0].label = "Tampered"; await writeFile(path, JSON.stringify(original));
    await expect(runGeoKbSemanticCanary({ ...options("questions", outputDir), rolesReviewed: true }, dependencies)).rejects.toMatchObject({ code: "roles_evidence_invalid" });
    expect(dependencies.client.complete).toHaveBeenCalledTimes(1);
  });
  it("does not reserve or dispatch when config is missing", async () => {
    const outputDir = await directory(), dependencies = { ...deps(), readEnvFile: vi.fn(async () => "UNRELATED=value") };
    await expect(runGeoKbSemanticCanary(options("roles", outputDir), dependencies)).rejects.toMatchObject({ code: "not_configured" });
    expect(dependencies.client.complete).not.toHaveBeenCalled(); expect((await readdir(outputDir)).filter(name => name.endsWith(".attempt"))).toHaveLength(0);
  });
  it("refuses to write a provider echo of a credential even inside an otherwise valid model result", async () => {
    const outputDir = await directory(), complete = vi.fn(async (request: KeywordLlmRequest) => {
      const value = reply(request) as { roles: { label: string }[] }; value.roles[0]!.label = "FAKE_CANARY_SECRET";
      return { content: JSON.stringify(value), usage: { inputTokens: 1, outputTokens: 2, requestCount: 1, retryCount: 0 } };
    });
    await expect(runGeoKbSemanticCanary(options("roles", outputDir), deps({ complete }))).rejects.toMatchObject({ code: "unsafe_output" });
    for (const name of await readdir(outputDir)) expect(await readFile(join(outputDir, name), "utf8")).not.toContain("FAKE_CANARY_SECRET");
    expect(complete).toHaveBeenCalledTimes(1);
    await expect(runGeoKbSemanticCanary(options("roles", outputDir), deps({ complete }))).rejects.toMatchObject({ code: "stage_already_attempted" });
  });
});
