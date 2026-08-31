import { describe, expect, it } from "vitest";
import { confirmedDraftV2Fixture } from "@sf/public-tools/content-brief/v2-draft-fixtures";
import { CONTENT_BRIEF_HANDOFF_KEY, CONTENT_BRIEF_HANDOFF_TTL_MS } from "@sf/public-tools/content-brief/contract";
import { parseContentBriefHandoff } from "@sf/public-tools/content-brief/parse-brief";
import { takeContentBriefHandoff } from "./content-brief-handoff.ts";
import { confirmedDraftV3Fixture } from "../../components/tools/content-brief-v3-fixture.ts";
import * as handoff from "./content-brief-v2-handoff.ts";

const NOW = Date.parse("2026-08-31T10:00:00Z");
function storage(initial: string | null = null) {
  const values = new Map<string, string>(initial === null ? [] : [[CONTENT_BRIEF_HANDOFF_KEY, initial]]);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
describe("one private versioned Brief handoff slot", () => {
  it("carries a confirmed v3 payload in transport version 2 and consumes its exact SERP snapshot once", async () => {
    const confirmed = await confirmedDraftV3Fixture();
    expect(confirmed.schema).toBe("gengrowth.confirmed_brief/v3");
    const target = storage(); const written = handoff.writeConfirmedBriefHandoff(target, NOW, confirmed);
    if (!written.ok) throw new Error(written.reason);
    expect(JSON.parse(written.raw)).toEqual({ version: 2, created_at: NOW, expires_at: NOW + CONTENT_BRIEF_HANDOFF_TTL_MS, brief: confirmed });
    const raw = takeContentBriefHandoff(target); expect(raw).toBe(written.raw); expect(takeContentBriefHandoff(target)).toBeNull();
    const parsed = await handoff.parseConfirmedBriefHandoff(JSON.parse(raw!), NOW);
    expect(parsed).toEqual({ ok: true, value: confirmed });
    if (!parsed.ok) throw new Error(parsed.path);
    expect(parsed.value.brief.context.serp).toEqual(confirmed.brief.context.serp);
    expect((await parseContentBriefHandoff(JSON.parse(raw!))).ok).toBe(false);
  });
  it("rejects altered v3 hashes, cross-schema confirmations and unsupported transport versions", async () => {
    const confirmed = await confirmedDraftV3Fixture(); const legacy = await confirmedDraftV2Fixture();
    const base = { version: 2, created_at: NOW, expires_at: NOW + CONTENT_BRIEF_HANDOFF_TTL_MS, brief: confirmed };
    for (const value of [
      { ...base, version: 1 }, { ...base, version: 3 },
      { ...base, brief: { ...confirmed, fingerprint: "f".repeat(64) } },
      { ...base, brief: { ...confirmed, brief: { ...confirmed.brief, run: { ...confirmed.brief.run, fingerprint: "f".repeat(64) } } } },
      { ...base, brief: { ...confirmed, schema: "gengrowth.confirmed_brief/v2" } },
      { ...base, brief: { ...confirmed, brief: legacy.brief } },
      { ...base, brief: confirmed.brief },
    ]) expect((await handoff.parseConfirmedBriefHandoff(value, NOW)).ok).toBe(false);
  });
  it("writes a confirmed v2 envelope, never relabels it as v1, and consumes once", async () => {
    expect(handoff.writeConfirmedBriefHandoff).toBeTypeOf("function");
    const confirmed = await confirmedDraftV2Fixture();
    const target = storage("legacy pending value");
    const result = handoff.writeConfirmedBriefHandoff(target, NOW, confirmed);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    const value = JSON.parse(result.raw);
    expect(value).toEqual({ version: 2, created_at: NOW, expires_at: NOW + CONTENT_BRIEF_HANDOFF_TTL_MS, brief: confirmed });
    expect(await handoff.parseConfirmedBriefHandoff(value, NOW)).toEqual({ ok: true, value: confirmed });
    expect((await parseContentBriefHandoff(value)).ok).toBe(false);
    expect(takeContentBriefHandoff(target)).toBe(result.raw);
    expect(takeContentBriefHandoff(target)).toBeNull();
  });
  it("rejects expired, future, extended and malformed envelopes independently of the payload hash", async () => {
    const confirmed = await confirmedDraftV2Fixture();
    const base = { version: 2, created_at: NOW, expires_at: NOW + CONTENT_BRIEF_HANDOFF_TTL_MS, brief: confirmed };
    for (const value of [
      { ...base, version: 1 }, { ...base, extra: true }, { ...base, created_at: NOW + 1 },
      { ...base, expires_at: NOW }, { ...base, expires_at: NOW + CONTENT_BRIEF_HANDOFF_TTL_MS + 1 },
      { ...base, brief: { ...confirmed, revision: confirmed.revision + 1 } },
    ]) expect((await handoff.parseConfirmedBriefHandoff(value, NOW)).ok).toBe(false);
  });
  it("clears stale pending data on failed writes but preserves an exact current envelope", async () => {
    const confirmed = await confirmedDraftV2Fixture();
    const target = storage("old");
    const blocked = { ...target, setItem: () => { throw new Error("quota"); } };
    expect(handoff.writeConfirmedBriefHandoff(blocked, NOW, confirmed)).toMatchObject({ ok: false, reason: "storage" });
    expect(target.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBeNull();
    target.setItem(CONTENT_BRIEF_HANDOFF_KEY, "keep");
    expect(handoff.writeConfirmedBriefHandoff(blocked, NOW, confirmed, { preserve: "keep" })).toMatchObject({ ok: false });
    expect(target.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBe("keep");
  });
  it("refuses oversized payloads before touching setItem and keeps navigation blocked", async () => {
    const confirmed = await confirmedDraftV2Fixture();
    const huge = { ...confirmed, fingerprint: "x".repeat(256 * 1024) };
    const target = storage("stale");
    let writes = 0;
    const result = handoff.writeConfirmedBriefHandoff({ ...target, setItem: () => { writes += 1; } }, NOW, huge);
    expect(result).toMatchObject({ ok: false, reason: "too_large" });
    expect(writes).toBe(0);
    expect(target.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBeNull();
  });
});
