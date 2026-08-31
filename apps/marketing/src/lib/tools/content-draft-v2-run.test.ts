// @input -- authenticated Draft endpoints and deterministic, offline model completions
// @output -- v2 admission, frozen-input orchestration, rerun and honest usage evidence
// @pos -- Draft v2 integration tests; no network or real provider configuration
import { afterEach, describe, expect, it, vi } from "vitest";
import { COVERAGE_TIMEOUT_MS, DRAFT_REQUEST_MAX_BYTES, DRAFT_TOTAL_BUDGET_MS, ENVELOPE_MS, SECTION_ENDPOINT_BUDGET_MS, SECTION_REQUEST_MAX_BYTES, SECTION_TIMEOUT_MS } from "@sf/public-tools/content-brief/constants";
import { CONFIRMED_BRIEF_V2_MAX_BYTES, confirmBriefV2, fingerprintBriefV2 } from "@sf/public-tools/content-brief/v2-brief";
import { DRAFT_V2_REQUEST_MAX_BYTES, DRAFT_V2_SECTION_REQUEST_MAX_BYTES, type DraftResultV2, type DraftV2SectionGeneration } from "@sf/public-tools/content-brief/v2-draft-contract";
import { confirmedDraftV2Fixture, draftResultV2Fixture } from "@sf/public-tools/content-brief/v2-draft-fixtures";
import { fingerprintDraftV2, parseDraftResultV2 } from "@sf/public-tools/content-brief/v2-draft";
import { buildDraftV2SectionScope } from "@sf/public-tools/content-brief/v2-draft-scope";
import { validateDraftV2Section } from "@sf/public-tools/content-brief/v2-draft-section";
import type { ConfirmedBriefV2 } from "@sf/public-tools/content-brief/v2-generation-contract";
import { contentBriefFixture, withFingerprint } from "@sf/public-tools/content-brief/fixtures";
import { handleContentDraftRunRequest, handleContentDraftSectionRequest, type ContentDraftHandlerDependencies } from "./content-draft-handler.ts";
import { generateDraftV2Section, runDraftV2Coverage, type DraftV2SectionInput } from "./content-draft-v2-llm.ts";
import type { DraftCoverageInput } from "./content-draft-llm.ts";
import { createKeywordLlmClient, type KeywordLlmConfig, type KeywordLlmRequest } from "./keyword-llm-client.ts";
import { readPublicToolJson } from "./public-tool-request.ts";
import { buildResearchBundle, validateResearchOutput } from "@sf/public-tools/content-brief/v2-research";

const START = Date.parse("2026-08-31T03:00:00.000Z");
const SETTINGS = { tone: "technical", person: "third", product_mention: "throughout" } as const;
const CONFIG: KeywordLlmConfig = { apiKey: "offline-test", model: "offline-model", url: "https://offline.invalid", authScheme: "bearer", temperature: null };
let nextId = 0;
afterEach(() => vi.useRealTimers());

function request(body: unknown): Request {
  return new Request("https://gengrowth.ai/api/tools/content-draft/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function sectionCompletion(input: DraftV2SectionInput) {
  const section = input.confirmed.outline.find((item) => item.id === input.sectionId)!;
  const text = input.confirmed.brief.context.input.language === "zh" ? "请检查完整报告区间。" : "Review the reporting period before comparing results.";
  return JSON.stringify({ paragraphs: (section.h3.length === 0 ? [null] : section.h3).map((heading) => ({ heading, sentences: [{ text, claim: "no_claim", evidence_refs: [] }] })) });
}

async function sevenSections() {
  const original = (await confirmedDraftV2Fixture()).brief;
  const paa = Array.from({ length: 7 }, (_, index) => ({ id: `A${index + 1}`, question: `What should I check in reporting step ${index + 1}?`, seed_question: null }));
  const research = buildResearchBundle(original.context.research.pages, paa);
  if (!research.ok) throw new Error(research.path);
  const anchors = research.value.units.filter((unit) => unit.kind === "paa").map((unit) => unit.id);
  const generated = validateResearchOutput({
    questions: anchors.map((anchor, index) => ({ anchor, q: paa[index]!.question, sources: ["U1", anchor] })),
    outline: anchors.map((anchor, index) => ({ h2: `Reporting step ${index + 1}`, h3: [`Step ${index + 1} details`], answers: [anchor] })),
  }, research.value);
  if (!generated.ok) throw new Error(generated.path);
  const unsigned = { ...original, context: { ...original.context, research: research.value }, generated: { ...original.generated!, research: generated.value }, run: { ...original.run, reads: original.run.reads.map((read) => read.source === "paa" ? { ...read, attempted: 7, retained: 7 } : read) } };
  const brief = { ...unsigned, run: { ...unsigned.run, fingerprint: await fingerprintBriefV2(unsigned) } };
  const confirmed = await confirmBriefV2(brief, { outline: brief.generated!.research.outline, revision: 1, confirmed_at: "2026-08-31T02:00:00.000Z", resolution: "accept_recommendation" });
  if (!confirmed.ok) throw new Error(confirmed.path);
  return confirmed.value;
}

function modelDependencies(overrides: Partial<ContentDraftHandlerDependencies> = {}) {
  const sectionRequests: KeywordLlmRequest[] = [];
  const coverageRequests: KeywordLlmRequest[] = [];
  const generateSectionV2 = vi.fn(async (input: DraftV2SectionInput) => generateDraftV2Section(input, {
    config: CONFIG, now: () => START, client: { complete: async (call) => {
      sectionRequests.push(call);
      return { content: sectionCompletion(input), modelId: "offline-section", usage: { requestCount: 1, retryCount: 0, inputTokens: 100, outputTokens: 25 } };
    } },
  }));
  const runCoverageV2 = vi.fn(async (input: DraftCoverageInput) => runDraftV2Coverage(input, {
    config: CONFIG, now: () => START, client: { complete: async (call) => {
      coverageRequests.push(call);
      return { content: JSON.stringify({ items: input.questions.map((question) => ({ question_id: question.id, status: "covered", covered_in: input.sections[0]!.id, gap: null })) }), modelId: "offline-coverage", usage: { requestCount: 1, retryCount: 0, inputTokens: 70, outputTokens: 15 } };
    } },
  }));
  const deps: ContentDraftHandlerDependencies = {
    getServerAuthenticatedUser: async () => ({ status: "authenticated", userId: "user-v2", email: null, avatarUrl: null }),
    readJson: readPublicToolJson, extractClientIp: () => "203.0.113.8", acquireSlot: () => ({ acquired: true, release: () => undefined }),
    consumeQuota: async () => ({ kind: "allowed", hits: 1 }),
    generateSection: async () => { throw new Error("v1 must not be called"); }, runCoverage: async () => { throw new Error("v1 must not be called"); },
    generateSectionV2, runCoverageV2, now: () => START, runId: () => `draft-v2-${++nextId}`, emit: () => undefined, ...overrides,
  };
  return { deps, generateSectionV2, runCoverageV2, sectionRequests, coverageRequests };
}

function runBody(brief: ConfirmedBriefV2, extra: Record<string, unknown> = {}) {
  return { brief, settings: SETTINGS, section_ids: brief.outline.map((section) => section.id), ...extra };
}

async function readResult(response: Response, confirmed: ConfirmedBriefV2, previous?: DraftResultV2) {
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store, private");
  const result = await response.json() as DraftResultV2;
  expect(await parseDraftResultV2(result, confirmed, previous)).toMatchObject({ ok: true });
  return result;
}

describe("Draft v2 authenticated endpoint orchestration", () => {
  it.each([{ action: "create" as const }, { action: "update" as const }, { paaOnly: true }, { language: "zh" }])("runs real offline model parsers for %j without a v1 conversion", async (options) => {
    const confirmed = await confirmedDraftV2Fixture(options);
    const fixture = modelDependencies();
    const result = await readResult(await handleContentDraftRunRequest(request(runBody(confirmed)), fixture.deps), confirmed);
    expect(result.schema).toBe("gengrowth.content_draft/v2");
    expect(result.confirmed_ref.fingerprint).toBe(confirmed.fingerprint);
    expect(result.settings).toEqual(SETTINGS);
    expect(result.sections.map((section) => section.id)).toEqual(confirmed.outline.map((section) => section.id));
    expect(result.sections[0]).toMatchObject({ status: "ok", h3: confirmed.outline[0]!.h3, body: { paragraphs: [{ heading: confirmed.outline[0]!.h3[0] }] } });
    expect(result.run.reads.llm_sections).toMatchObject({ calls: 2, input_tokens: 200, output_tokens: 50 });
    expect(result.run.reads.llm_coverage).toMatchObject({ calls: 1, input_tokens: 70, output_tokens: 15 });
    expect(fixture.runCoverageV2.mock.calls[0]![0].questions.map((question) => question.id)).toEqual(confirmed.brief.generated!.research.questions.map((question) => question.id));
    expect(fixture.runCoverageV2.mock.calls[0]![0].sections[0]!.text).toContain(confirmed.outline[0]!.h3[0]);
    expect(result.totals.unit).toBe(options.language === "zh" ? "non_whitespace_characters" : "words");
    const firstPrompt = JSON.parse(fixture.sectionRequests[0]!.user);
    if (options.action === "update") {
      expect(firstPrompt.page_plan.action).toBe("update");
      expect(JSON.stringify(firstPrompt)).toContain("The current reporting introduction.");
    }
    if (options.paaOnly) expect(firstPrompt.page_units).toEqual([]);
  });

  it("keeps confirmed outline order and judges all questions even when their owner was skipped", async () => {
    const confirmed = await confirmedDraftV2Fixture({ reverse: true });
    const fixture = modelDependencies();
    const selected = confirmed.outline[1]!.id;
    const result = await readResult(await handleContentDraftRunRequest(request(runBody(confirmed, { section_ids: [selected] })), fixture.deps), confirmed);
    expect(result.sections.map((section) => section.status)).toEqual(["skipped", "ok"]);
    expect(fixture.generateSectionV2.mock.calls.map(([input]) => input.sectionId)).toEqual([selected]);
    expect(fixture.runCoverageV2.mock.calls[0]![0].questions).toHaveLength(2);
    expect(result.coverage).toMatchObject({ status: "available", method: "model", covered: 2 });
  });

  it("reruns exactly one section using previous settings and current-call usage", async () => {
    const confirmed = await confirmedDraftV2Fixture();
    const previous = await draftResultV2Fixture(confirmed);
    const fixture = modelDependencies();
    const section_id = previous.sections[1]!.id;
    const result = await readResult(await handleContentDraftSectionRequest(request({ brief: confirmed, previous, section_id }), fixture.deps), confirmed, previous);
    expect(result.settings).toEqual(previous.settings);
    expect(result.sections[0]).toEqual(previous.sections[0]);
    expect(result.run.rerun).toEqual({ previous_run_id: previous.run.run_id, previous_fingerprint: previous.run.fingerprint, section_id });
    expect(result.run.budget_ms).toBe(SECTION_ENDPOINT_BUDGET_MS);
    expect(result.run.reads.llm_sections).toMatchObject({ calls: 1, input_tokens: 100, output_tokens: 25 });
    expect(fixture.generateSectionV2).toHaveBeenCalledTimes(1);
    expect(fixture.generateSectionV2.mock.calls[0]![0].settings).toEqual(previous.settings);
    expect(fixture.runCoverageV2.mock.calls[0]![0].sections).toHaveLength(2);
    expect(previous.sections[1]!.status === "ok" && previous.sections[1]!.llm.input_tokens).toBe(50);
  });

  it("accepts a valid whole previous result above 64KiB and preserves untouched content exactly", async () => {
    const confirmed = await confirmedDraftV2Fixture();
    const base = await draftResultV2Fixture(confirmed);
    const sections = base.sections.map((section) => {
      const scope = buildDraftV2SectionScope(confirmed, section.id, base.settings);
      if (!scope.ok) throw new Error(scope.path);
      const ref = [...scope.value.page_units.keys()][0]!;
      const body = validateDraftV2Section({ paragraphs: [{ heading: section.h3[0]!, sentences: Array.from({ length: 27 }, () => ({ text: "Reporting ".repeat(59) + "detail.", claim: "bound", evidence_refs: [ref] })) }] }, scope.value, confirmed.brief.context.input.language);
      if (!body.ok || section.status !== "ok") throw new Error("Invalid large fixture");
      return { ...section, body: body.value };
    });
    const previous = await draftResultV2Fixture(confirmed, { sections });
    expect(new TextEncoder().encode(JSON.stringify(previous)).byteLength).toBeGreaterThan(64 * 1024);
    const fixture = modelDependencies();
    const result = await readResult(await handleContentDraftSectionRequest(request({ brief: confirmed, previous, section_id: "O1" }), fixture.deps), confirmed, previous);
    expect(JSON.stringify(result.sections[1])).toBe(JSON.stringify(previous.sections[1]));
    expect(result.run.reads.llm_sections).toMatchObject({ calls: 1, input_tokens: 100, output_tokens: 25 });
  });

  it("retains successful sections and judges all questions after an actual peer provider failure", async () => {
    const confirmed = await confirmedDraftV2Fixture();
    const offline = modelDependencies();
    const failedClient = createKeywordLlmClient({ config: CONFIG, fetchImpl: async () => new Response(null, { status: 503 }) });
    const fixture = modelDependencies({ generateSectionV2: (input) => input.sectionId === "O1" ? generateDraftV2Section(input, { config: CONFIG, client: failedClient, now: () => START }) : offline.generateSectionV2(input) });
    const result = await readResult(await handleContentDraftRunRequest(request(runBody(confirmed)), fixture.deps), confirmed);
    expect(result.sections.map((section) => section.status)).toEqual(["failed", "ok"]);
    expect(result.run.mode).toBe("degraded");
    expect(result.run.reads.llm_sections).toMatchObject({ calls: 2, input_tokens: null, output_tokens: null });
    expect(fixture.runCoverageV2.mock.calls[0]![0].questions).toHaveLength(2);
    expect(fixture.runCoverageV2.mock.calls[0]![0].sections.map((section) => section.id)).toEqual(["O2"]);
  });

  it("derives exact empty-draft coverage without a judge call when every section fails", async () => {
    const confirmed = await confirmedDraftV2Fixture();
    const fixture = modelDependencies({ generateSectionV2: (input) => generateDraftV2Section(input, { config: null, now: () => START }) });
    const result = await readResult(await handleContentDraftRunRequest(request(runBody(confirmed)), fixture.deps), confirmed);
    expect(result.run.mode).toBe("unavailable");
    expect(result.coverage).toMatchObject({ status: "available", method: "empty_draft", total: 2, covered: 0, none: 2 });
    expect(result.run.reads.llm_sections).toMatchObject({ status: "unavailable", calls: 0, input_tokens: null, output_tokens: null });
    expect(result.run.reads.llm_coverage).toEqual({ status: "unavailable", reason: "insufficient_evidence", attempted: 0, calls: 0, model_id: null, input_tokens: null, output_tokens: null });
    expect(fixture.runCoverageV2).not.toHaveBeenCalled();
  });

  it("retains successful prose and honest usage when the coverage model fails validation", async () => {
    const confirmed = await confirmedDraftV2Fixture();
    const fixture = modelDependencies({ runCoverageV2: async () => ({ items: [], reads: { status: "complete", calls: 1, model_id: "judge", temperature_requested: 0, temperature_effective: null, input_tokens: 80, output_tokens: 20 } }) });
    const result = await readResult(await handleContentDraftRunRequest(request(runBody(confirmed)), fixture.deps), confirmed);
    expect(result.run.mode).toBe("degraded");
    expect(result.sections.every((section) => section.status === "ok")).toBe(true);
    expect(result.coverage).toEqual({ status: "unavailable", reason: "validation_failed", attempted: 1 });
    expect(result.run.reads.llm_coverage).toMatchObject({ calls: 1, input_tokens: 80, output_tokens: 20 });
  });
});

describe("Draft v2 refusal before generation", () => {
  it.each(["auth", "slot", "quota"])("keeps the shared %s gate before v2 parsing/model calls", async (gate) => {
    const fixture = modelDependencies({
      ...(gate === "auth" ? { getServerAuthenticatedUser: async () => ({ status: "unauthenticated" as const }) } : {}),
      ...(gate === "slot" ? { acquireSlot: () => ({ acquired: false as const }) } : {}),
      ...(gate === "quota" ? { consumeQuota: async () => ({ kind: "limited" as const, retryAfterSeconds: 31 }) } : {}),
    });
    const response = await handleContentDraftRunRequest(request({ brief: { schema: "gengrowth.confirmed_brief/v2" } }), fixture.deps);
    expect(response.status).toBe(gate === "auth" ? 401 : gate === "slot" ? 409 : 429);
    expect(fixture.generateSectionV2).not.toHaveBeenCalled();
  });

  it.each(["extra", "settings_extra", "empty", "duplicate", "unknown", "unconfirmed", "geo", "changed_confirmation"])("rejects %s before any provider call", async (kind) => {
    const confirmed = await confirmedDraftV2Fixture();
    const body = runBody(confirmed);
    const malformed = kind === "extra" ? { ...body, provider: "other" } : kind === "settings_extra" ? { ...body, settings: { ...SETTINGS, prompt: "ignored?" } } :
      kind === "empty" ? { ...body, section_ids: [] } : kind === "duplicate" ? { ...body, section_ids: ["O1", "O1"] } :
        kind === "unknown" ? { ...body, section_ids: ["O999"] } : kind === "unconfirmed" ? { ...body, brief: confirmed.brief } :
          kind === "geo" ? { ...body, brief: { schema: "gengrowth.geo_report/v1" } } : { ...body, brief: { ...confirmed, revision: confirmed.revision + 1 } };
    const fixture = modelDependencies();
    const response = await handleContentDraftRunRequest(request(malformed), fixture.deps);
    expect(response.status).toBe(["extra", "settings_extra", "empty", "duplicate"].includes(kind) ? 400 : 422);
    expect(fixture.generateSectionV2).not.toHaveBeenCalled();
    expect(fixture.runCoverageV2).not.toHaveBeenCalled();
  });

  it.each(["settings", "unknown", "previous_hash", "rehashed_bad_previous", "changed_confirmed"])("rejects rerun %s without a model call", async (kind) => {
    const confirmed = await confirmedDraftV2Fixture();
    const initial = await draftResultV2Fixture(confirmed);
    const changedPrevious = kind === "previous_hash" ? { ...initial, run: { ...initial.run, fingerprint: "0".repeat(64) } } : kind === "rehashed_bad_previous" ? { ...initial, totals: { ...initial.totals, value: 999 } } : initial;
    const previous = kind === "rehashed_bad_previous" ? { ...changedPrevious, run: { ...changedPrevious.run, fingerprint: await fingerprintDraftV2(changedPrevious) } } : changedPrevious;
    const changed = await confirmBriefV2(confirmed.brief, { outline: [...confirmed.outline].reverse(), revision: 3, confirmed_at: confirmed.confirmed_at, resolution: confirmed.resolution });
    if (!changed.ok) throw new Error(changed.path);
    const fixture = modelDependencies();
    const response = await handleContentDraftSectionRequest(request({ brief: kind === "changed_confirmed" ? changed.value : confirmed, previous, section_id: kind === "unknown" ? "O999" : "O1", ...(kind === "settings" ? { settings: SETTINGS } : {}) }), fixture.deps);
    expect(response.status).toBe(kind === "settings" ? 400 : 422);
    expect(fixture.generateSectionV2).not.toHaveBeenCalled();
    expect(fixture.runCoverageV2).not.toHaveBeenCalled();
  });

  it.each(["language", "market"])("rejects a freshly rehashed unknown %s before constructing model prompts", async (field) => {
    const original = await confirmedDraftV2Fixture();
    const modified = { ...original.brief, context: { ...original.brief.context, input: { ...original.brief.context.input, [field]: "unknown-value" } } };
    const brief = { ...modified, run: { ...modified.run, fingerprint: await fingerprintBriefV2(modified) } };
    const confirmation = await confirmBriefV2(brief, { outline: original.outline, revision: original.revision, confirmed_at: original.confirmed_at, resolution: original.resolution });
    if (!confirmation.ok) throw new Error(confirmation.path);
    const confirmed = confirmation.value;
    const fixture = modelDependencies();
    const response = await handleContentDraftRunRequest(request(runBody(confirmed)), fixture.deps);
    expect(response.status).toBe(422);
    expect(fixture.generateSectionV2).not.toHaveBeenCalled();
  });

  it("keeps v1 body byte caps while admitting the separately bounded v2 envelope", async () => {
    const v1 = await withFingerprint(contentBriefFixture());
    const fixture = modelDependencies();
    for (const [handler, max] of [[handleContentDraftRunRequest, DRAFT_REQUEST_MAX_BYTES], [handleContentDraftSectionRequest, SECTION_REQUEST_MAX_BYTES]] as const) {
      const response = await handler(request({ brief: v1, padding: "x".repeat(max) }), fixture.deps);
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ error: { code: "payload_too_large" } });
    }
    const readJson = vi.fn(readPublicToolJson);
    const confirmed = await confirmedDraftV2Fixture();
    await handleContentDraftRunRequest(request(runBody(confirmed)), modelDependencies({ readJson }).deps);
    expect(readJson.mock.calls[0]![1]).toBe(Math.max(DRAFT_REQUEST_MAX_BYTES, DRAFT_V2_REQUEST_MAX_BYTES));
    const oversized = await handleContentDraftRunRequest(request({ ...runBody(confirmed), brief: { ...confirmed, oversized: "x".repeat(CONFIRMED_BRIEF_V2_MAX_BYTES) } }), fixture.deps);
    expect(oversized.status).toBe(413);
    const previous = await draftResultV2Fixture(confirmed);
    await handleContentDraftSectionRequest(request({ brief: confirmed, previous, section_id: "O1" }), modelDependencies({ readJson }).deps);
    expect(readJson.mock.calls.at(-1)![1]).toBe(Math.max(SECTION_REQUEST_MAX_BYTES, DRAFT_V2_SECTION_REQUEST_MAX_BYTES));
  });

  it("retains the v1 wire-byte cap even when JSON whitespace disappears during parsing", async () => {
    const brief = await withFingerprint(contentBriefFixture());
    const json = JSON.stringify({ brief, section_id: "O1", previous: {} });
    const padded = json + " ".repeat(SECTION_REQUEST_MAX_BYTES - new TextEncoder().encode(json).byteLength + 1);
    const response = await handleContentDraftSectionRequest(new Request("https://gengrowth.ai/api/tools/content-draft/section", { method: "POST", headers: { "content-type": "application/json" }, body: padded }), modelDependencies().deps);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: { code: "payload_too_large" } });
  });

  it("returns a payload-free 503 if a model seam produces an invalid result receipt", async () => {
    const confirmed = await confirmedDraftV2Fixture();
    const emit = vi.fn();
    const fixture = modelDependencies({ emit, generateSectionV2: async () => ({ status: "failed", fail_reason: "provider_error", llm: { attempts: 0, model_id: null, temperature_requested: 0.4, temperature_effective: null, input_tokens: null, output_tokens: null } }) });
    const response = await handleContentDraftRunRequest(request(runBody(confirmed)), fixture.deps);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "draft_unavailable" } });
    expect(JSON.stringify(emit.mock.calls)).not.toContain(confirmed.brief.context.input.primary);
  });
});

describe("Draft v2 bounded execution and receipt deadlines", () => {
  it("runs at most three sections concurrently and schedules in confirmed outline order", async () => {
    const confirmed = await sevenSections();
    const releases: (() => void)[] = [];
    const offline = modelDependencies();
    let active = 0;
    let peak = 0;
    const generateSectionV2 = vi.fn(async (input: DraftV2SectionInput) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      const result = await offline.generateSectionV2(input);
      active -= 1;
      return result;
    });
    const fixture = modelDependencies({ generateSectionV2 });
    const pending = handleContentDraftRunRequest(request(runBody(confirmed, { section_ids: [...confirmed.outline].reverse().map((section) => section.id) })), fixture.deps);
    await vi.waitFor(() => expect(generateSectionV2).toHaveBeenCalledTimes(3));
    expect(peak).toBe(3);
    releases[2]!();
    await vi.waitFor(() => expect(generateSectionV2).toHaveBeenCalledTimes(4));
    releases[0]!(); releases[1]!(); releases[3]!();
    await vi.waitFor(() => expect(generateSectionV2).toHaveBeenCalledTimes(7));
    releases[4]!(); releases[5]!(); releases[6]!();
    const result = await readResult(await pending, confirmed);
    expect(peak).toBe(3);
    expect(active).toBe(0);
    expect(generateSectionV2.mock.calls.map(([input]) => input.sectionId)).toEqual(confirmed.outline.map((section) => section.id));
    expect(result.run.reads.sections).toEqual({ requested: 7, ok: 7, failed: 0, skipped: 0 });
    expect(result.run.reads.llm_sections).toMatchObject({ calls: 7, input_tokens: 700, output_tokens: 175 });
  });

  it("stops queued sections after an unexpected rejection and drains the other started calls", async () => {
    const confirmed = await sevenSections();
    const releases: ((value: DraftV2SectionGeneration) => void)[] = [];
    const rejects: ((error: Error) => void)[] = [];
    const generateSectionV2 = vi.fn(() => new Promise<DraftV2SectionGeneration>((resolve, reject) => { releases.push(resolve); rejects.push(reject); }));
    const release = vi.fn();
    const fixture = modelDependencies({ generateSectionV2, acquireSlot: () => ({ acquired: true, release }) });
    const pending = handleContentDraftRunRequest(request(runBody(confirmed)), fixture.deps);
    await vi.waitFor(() => expect(generateSectionV2).toHaveBeenCalledTimes(3));
    rejects[0]!(new Error("sensitive fixture error must not escape"));
    await Promise.resolve();
    expect(release).not.toHaveBeenCalled();
    const failed: DraftV2SectionGeneration = { status: "failed", fail_reason: "timeout", llm: { attempts: 1, model_id: null, temperature_requested: 0.4, temperature_effective: null, input_tokens: null, output_tokens: null } };
    releases[1]!(failed); releases[2]!(failed);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "draft_unavailable" } });
    expect(generateSectionV2).toHaveBeenCalledTimes(3);
    expect(fixture.runCoverageV2).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("reserves the coverage and envelope budget before admitting section work", async () => {
    const confirmed = await confirmedDraftV2Fixture();
    let reads = 0;
    const fixture = modelDependencies({ now: () => reads++ === 0 ? START : START + DRAFT_TOTAL_BUDGET_MS - COVERAGE_TIMEOUT_MS - ENVELOPE_MS + 1 });
    const result = await readResult(await handleContentDraftRunRequest(request(runBody(confirmed)), fixture.deps), confirmed);
    expect(result.sections.every((section) => section.status === "failed" && section.fail_reason === "timeout" && section.llm.attempts === 0)).toBe(true);
    expect(result.run.reads.llm_sections).toMatchObject({ calls: 0, input_tokens: null, output_tokens: null });
    expect(result.coverage).toMatchObject({ method: "empty_draft" });
    expect(fixture.generateSectionV2).not.toHaveBeenCalled();
    expect(fixture.runCoverageV2).not.toHaveBeenCalled();
  });

  it("uses a real client timeout receipt after a validation retry near the watchdog limit", async () => {
    const confirmed = await confirmedDraftV2Fixture();
    vi.useFakeTimers();
    vi.setSystemTime(START);
    let sent = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      sent += 1;
      return new Promise<Response>((resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new Error("offline abort")), { once: true });
        if (sent === 1) setTimeout(() => resolve(Response.json({ model: "offline-real-client", choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 110, completion_tokens: 5 } })), SECTION_TIMEOUT_MS - 1);
      });
    });
    const client = createKeywordLlmClient({ config: CONFIG, fetchImpl });
    const generateSectionV2 = vi.fn((input: DraftV2SectionInput) => generateDraftV2Section(input, { config: CONFIG, client, now: Date.now }));
    const release = vi.fn();
    const fixture = modelDependencies({ generateSectionV2, now: Date.now, acquireSlot: () => ({ acquired: true, release }) });
    const pending = handleContentDraftRunRequest(request(runBody(confirmed, { section_ids: ["O1"] })), fixture.deps);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(SECTION_TIMEOUT_MS - 1);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(SECTION_TIMEOUT_MS);
    const result = await readResult(await pending, confirmed);
    expect(result.sections[0]).toMatchObject({ status: "failed", fail_reason: "timeout", llm: { attempts: 2, input_tokens: null, output_tokens: null } });
    expect(result.run.reads.llm_sections).toMatchObject({ calls: 2, input_tokens: null, output_tokens: null });
    expect(fixture.runCoverageV2).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("fails closed and drains bounded workers if started calls never supply receipts", async () => {
    const confirmed = await confirmedDraftV2Fixture();
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const generateSectionV2 = vi.fn(() => new Promise<DraftV2SectionGeneration>(() => undefined));
    const release = vi.fn();
    const fixture = modelDependencies({ generateSectionV2, now: Date.now, acquireSlot: () => ({ acquired: true, release }) });
    const pending = handleContentDraftRunRequest(request(runBody(confirmed)), fixture.deps);
    await vi.waitFor(() => expect(generateSectionV2).toHaveBeenCalledTimes(2));
    expect(release).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SECTION_TIMEOUT_MS * 2 + 100);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "draft_unavailable" } });
    expect(release).toHaveBeenCalledTimes(1);
    expect(fixture.runCoverageV2).not.toHaveBeenCalled();
  });

  it("bounds a hung coverage seam without inventing a completed judge receipt", async () => {
    const confirmed = await confirmedDraftV2Fixture();
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const runCoverageV2 = vi.fn(() => new Promise<never>(() => undefined));
    const fixture = modelDependencies({ runCoverageV2, now: Date.now });
    const pending = handleContentDraftRunRequest(request(runBody(confirmed)), fixture.deps);
    await vi.waitFor(() => expect(runCoverageV2).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(COVERAGE_TIMEOUT_MS + 100);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "draft_unavailable" } });
  });
});
