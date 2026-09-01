import { describe, expect, it } from "vitest";
import { buildSerpObservations } from "./assemble.ts";
import { fingerprintCanonical } from "./canonical.ts";
import type { SerpObservation, SerpReadMeta } from "./contract.ts";
import * as brief from "./v2-brief.ts";
import * as researchContract from "./v2-contract.ts";
import { confirmedDraftV2Fixture, draftResultV2Fixture } from "./v2-draft-fixtures.ts";
import { buildDraftV2SectionScope } from "./v2-draft-scope.ts";
import { fingerprintDraftV2, parseDraftResultV2 } from "./v2-draft.ts";
import { parseBriefV2Context } from "./v2-generation.ts";
import type { ContentBriefV2 } from "./v2-generation-contract.ts";

interface Snapshot { readonly rows: readonly SerpObservation[]; readonly read: SerpReadMeta }
const snapshot = (): Snapshot => ({
  rows: buildSerpObservations([
    { rank: 1, url: "https://competitor.test/C1", domain: "competitor.test", title: "How to check reporting delays" },
    { rank: 2, url: "https://competitor.test/C2", domain: "competitor.test", title: "10 best reporting tools" },
    { rank: 3, url: null, domain: "unknown.test", title: null },
  ]),
  read: { status: "partial", requested: 10, returned: 3, unresolved: 1 },
});

async function seal(input: ContentBriefV2): Promise<ContentBriefV2> {
  return { ...input, run: { ...input.run, fingerprint: await brief.fingerprintBriefV2(input) } };
}

async function v3(read = snapshot(), paaOnly = false): Promise<ContentBriefV2> {
  const previous = await confirmedDraftV2Fixture({ paaOnly });
  const serpRead = read.read;
  return seal({
    ...previous.brief, schema: "gengrowth.content_brief/v3" as ContentBriefV2["schema"],
    context: { ...previous.brief.context, ...{ serp: read } },
    run: { ...previous.brief.run, reads: previous.brief.run.reads.map((item) => item.source !== "serp" ? item :
      serpRead.status === "unavailable" ? { source: "serp", status: "unavailable", attempted: serpRead.attempted, retained: null,
        reason: serpRead.reason === "timeout" || serpRead.reason === "provider_error" ? serpRead.reason : "insufficient_evidence" }
        : { source: "serp", status: serpRead.status, attempted: serpRead.requested, retained: serpRead.returned, reason: null }) },
  });
}

function changed(input: unknown, path: readonly (string | number)[], value: unknown): ContentBriefV2 {
  const result = structuredClone(input) as Record<string | number, unknown>;
  let cursor = result;
  for (const key of path.slice(0, -1)) cursor = cursor[key] as Record<string | number, unknown>;
  cursor[path.at(-1)!] = value;
  return result as unknown as ContentBriefV2;
}

describe("explicit Brief v3 SERP snapshot and historical v2 compatibility", () => {
  it("exports new schema constants without replacing v2 literals", () => {
    expect(researchContract).toMatchObject({ CONTENT_BRIEF_V2_SCHEMA: "gengrowth.content_brief/v2", CONTENT_BRIEF_V3_SCHEMA: "gengrowth.content_brief/v3" });
    expect(brief).toMatchObject({ CONFIRMED_BRIEF_V2_SCHEMA: "gengrowth.confirmed_brief/v2", CONFIRMED_BRIEF_V3_SCHEMA: "gengrowth.confirmed_brief/v3" });
  });

  it("preserves exact pre-change v2 Brief, confirmation and Draft fingerprints and byte lengths", async () => {
    const confirmed = await confirmedDraftV2Fixture();
    const draft = await draftResultV2Fixture(confirmed);
    expect({ brief: confirmed.brief.run.fingerprint, confirmed: confirmed.fingerprint, draft: draft.run.fingerprint }).toEqual({
      brief: "c799cd52358ec8b01a14ff9829951f77a8c93b37264628b76f12d9af221d07e4",
      confirmed: "b34e25bdb4f0103a0478d5a76c30af31dbda4ba136422e720901d7abb8708488",
      draft: "a0c34a9a2e17d9827467a1bca678a392cdd7380800b6a2c662285e63e6056bf5",
    });
    expect([JSON.stringify(confirmed.brief).length, JSON.stringify(confirmed).length, JSON.stringify(draft).length]).toEqual([4062, 4457, 2386]);
    expect(await brief.parseContentBriefV2(confirmed.brief)).toEqual({ ok: true, value: confirmed.brief });
    expect(await brief.parseConfirmedBriefV2(confirmed)).toEqual({ ok: true, value: confirmed });
    expect(await parseDraftResultV2(draft, confirmed)).toEqual({ ok: true, value: draft });
    expect(confirmed.brief.context).not.toHaveProperty("serp");
  });

  it("round-trips a v3 sampled SERP with exact titles, classifier rules and read metadata", async () => {
    const input = await v3();
    const result = await brief.parseContentBriefV2(input);
    expect(result).toEqual({ ok: true, value: input });
    expect(parseBriefV2Context(input.context)).toEqual({ ok: true, value: input.context });
    if (!result.ok) throw new Error(result.path);
    expect(result.value.context).not.toBe(input.context);
    expect(result.value.context).toHaveProperty("serp", snapshot());
  });

  it("requires SERP in v3 and forbids adding it to historical v2 even after resealing", async () => {
    const legacy = (await confirmedDraftV2Fixture()).brief;
    expect(await brief.parseContentBriefV2(await seal({ ...legacy, schema: "gengrowth.content_brief/v3" as ContentBriefV2["schema"] }))).toMatchObject({ ok: false });
    expect(await brief.parseContentBriefV2(await seal({ ...await v3(), schema: "gengrowth.content_brief/v2" }))).toMatchObject({ ok: false });
    expect(await brief.parseContentBriefV2(await seal(changed(legacy, ["context", "serp"], undefined)))).toMatchObject({ ok: false });
    expect(await brief.parseContentBriefV2(await seal({ ...await v3(), schema: "gengrowth.content_brief/v4" as ContentBriefV2["schema"] }))).toMatchObject({ ok: false, code: "brief_schema_mismatch" });
  });

  it.each([
    [["context", "serp", "rows", 0, "id"], "S9"],
    [["context", "serp", "rows", 1, "rank"], 1],
    [["context", "serp", "rows", 0, "format", "value"], "comparison"],
    [["context", "serp", "rows", 0, "format", "rules_hit"], []],
    [["context", "serp", "rows", 0, "format", "method"], "observed"],
    [["context", "serp", "rows", 0, "title"], "10 best tools"],
    [["context", "serp", "rows", 0, "url"], "javascript:alert(1)"],
    [["context", "serp", "rows", 0, "url"], "https://user:password@competitor.test/C1"],
    [["context", "serp", "read", "returned"], 2],
    [["context", "serp", "read", "returned"], 0],
    [["context", "serp", "read", "requested"], 2],
    [["context", "serp", "read", "status"], "complete"],
    [["context", "serp", "read", "unresolved"], -1],
    [["context", "serp", "read", "unresolved"], 1e20],
    [["context", "serp", "read", "extra"], true],
    [["context", "serp", "extra"], true],
    [["context", "research", "pages", 0, "url"], "https://unrelated.test/page"],
  ] as const)("rejects source graph tampering at %j after a valid new fingerprint", async (path, value) => {
    const input = changed(await v3(), path, value);
    expect(await brief.parseContentBriefV2(await seal(input))).toMatchObject({ ok: false });
  });

  it("accepts complete reads only when all requested rows are returned without unresolved rows", async () => {
    const input = snapshot();
    expect(await brief.parseContentBriefV2(await v3({ ...input, read: { status: "complete", requested: 3, returned: 3, unresolved: 0 } }))).toMatchObject({ ok: true });
    expect(await brief.parseContentBriefV2(await v3({ ...input, read: { status: "partial", requested: 3, returned: 3, unresolved: 1 } }))).toMatchObject({ ok: true });
    expect(await brief.parseContentBriefV2(await v3({ ...input, read: { status: "partial", requested: 3, returned: 3, unresolved: 0 } }))).toMatchObject({ ok: false });
  });

  it("preserves an unavailable SERP as unavailable without fabricating rows or counts", async () => {
    const input = await v3({ rows: [], read: { status: "unavailable", reason: "timeout", attempted: null } }, true);
    expect(await brief.parseContentBriefV2(input)).toMatchObject({ ok: true });
    expect(await brief.parseContentBriefV2(await seal(changed(input, ["context", "serp", "rows"], snapshot().rows)))).toMatchObject({ ok: false });
    expect(await brief.parseContentBriefV2(await v3({ rows: [], read: { status: "unavailable", reason: "timeout", attempted: 10 } }))).toMatchObject({ ok: false });
  });

  it.each(["", "not a URL", "javascript:alert(1)", "https://user:password@source.test/page"])("retains an unusable vendor URL as source-only data: %s", async (url) => {
    const original = snapshot();
    const rows = buildSerpObservations(original.rows.map((row, index) => index === 2 ? { ...row, url, title: "How to verify reporting" } : row));
    const input = await v3({ ...original, rows });
    expect(await brief.parseContentBriefV2(input)).toMatchObject({ ok: true });
    expect(input.context).toHaveProperty("serp.rows.2.url", url);
  });

  it.each([["url", "x".repeat(2049)], ["title", "x".repeat(2001)], ["domain", "x".repeat(2001)]] as const)("bounds raw SERP %s without weakening historical URL validation", async (field, value) => {
    expect(await brief.parseContentBriefV2(await seal(changed(await v3(), ["context", "serp", "rows", 2, field], value)))).toMatchObject({ ok: false });
  });

  it("binds the displayed run SERP read to the frozen read metadata", async () => {
    const input = await v3();
    for (const [key, value] of [["retained", 2], ["attempted", 9], ["status", "complete"]] as const) {
      expect(await brief.parseContentBriefV2(await seal(changed(input, ["run", "reads", 0, key], value)))).toMatchObject({ ok: false });
    }
  });

  it("includes SERP source bytes in the fingerprint without normalizing or silently reclassifying them", async () => {
    const input = await v3();
    const revised = changed(input, ["context", "serp", "rows", 0, "title"], "How to verify a reporting delay");
    expect(await brief.parseContentBriefV2(revised)).toMatchObject({ ok: false, code: "brief_fingerprint_mismatch" });
    expect(await brief.parseContentBriefV2(await seal(revised))).toMatchObject({ ok: true });
  });

  it("confirms v3 with a matching v3 wrapper and lets Draft v2 retain that exact schema", async () => {
    const input = await v3();
    const confirmed = await brief.confirmBriefV2(input, { outline: input.generated!.research.outline, revision: 3, confirmed_at: input.run.collected_at, resolution: "accept_recommendation" });
    expect(confirmed).toMatchObject({ ok: true, value: { schema: "gengrowth.confirmed_brief/v3" } });
    if (!confirmed.ok) throw new Error(confirmed.path);
    expect(await brief.parseConfirmedBriefV2(confirmed.value)).toEqual(confirmed);
    expect(buildDraftV2SectionScope(confirmed.value, "O1", { tone: "explanatory", person: "second", product_mention: "none" })).toMatchObject({ ok: true });
    const draft = await draftResultV2Fixture(confirmed.value);
    expect(draft.confirmed_ref.schema).toBe("gengrowth.confirmed_brief/v3");
    expect(await parseDraftResultV2(draft, confirmed.value)).toEqual({ ok: true, value: draft });
    const forged = { ...draft, confirmed_ref: { ...draft.confirmed_ref, schema: "gengrowth.confirmed_brief/v2" as const } };
    expect(await parseDraftResultV2({ ...forged, run: { ...forged.run, fingerprint: await fingerprintDraftV2(forged) } }, confirmed.value)).toMatchObject({ ok: false });
  });

  it("rejects cross-version confirmation wrappers even with a matching checksum", async () => {
    const legacy = await confirmedDraftV2Fixture();
    const modern = await v3();
    for (const unsigned of [
      { ...legacy, schema: "gengrowth.confirmed_brief/v3" as typeof legacy.schema },
      { ...legacy, brief: modern },
    ]) {
      const { fingerprint: _fingerprint, ...content } = unsigned;
      const forged = { ...content, fingerprint: await fingerprintCanonical(content) };
      expect(await brief.parseConfirmedBriefV2(forged)).toMatchObject({ ok: false });
      expect(buildDraftV2SectionScope(forged, "O1", { tone: "explanatory", person: "second", product_mention: "none" })).toMatchObject({ ok: false });
    }
  });

  it("keeps the existing Brief and confirmation byte ceilings for the new schema", async () => {
    expect(brief.BRIEF_V2_MAX_BYTES).toBe(224 * 1024);
    expect(brief.CONFIRMED_BRIEF_V2_MAX_BYTES).toBe(256 * 1024);
    expect(await brief.parseContentBriefV2({ schema: "gengrowth.content_brief/v3", data: "x".repeat(224 * 1024) })).toMatchObject({ ok: false, path: "brief.bytes" });
    expect(await brief.parseConfirmedBriefV2({ schema: "gengrowth.confirmed_brief/v3", data: "x".repeat(256 * 1024) })).toMatchObject({ ok: false, path: "confirmation.bytes" });
  });
});
