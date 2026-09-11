import { describe, expect, it } from "vitest";

import { geoV2Digest } from "./kb-v2-digest.ts";
import { parseGeoKbPayloadV3, type GeoKbPayloadV3 } from "./kb-v3-contract.ts";
import { applyGeoKbV3CompetitorGesture } from "./kb-v3-competitors.ts";
import { completePayloadV3 } from "./kb-v3.test-fixtures.ts";

const KNOWLEDGE_GENERATION_ID = "11111111-1111-8111-8111-111111111120";
const DECISION = {
  itemKey: "a".repeat(64), decision: "accepted" as const, override: null,
  baseContentHash: "b".repeat(64), baseDraftVersion: "4", decidedAt: "2026-09-10T00:00:00.000Z",
};

/**
 * The stored draft the gesture lands on: two domain-keyed rivals, one of them
 * unnamed the way `competitorsFromProfile` writes them, one brand-only entry
 * with no page to read, and a paid knowledge body with a decision on it.
 */
function stored(overrides: Partial<GeoKbPayloadV3> = {}): GeoKbPayloadV3 {
  const base = completePayloadV3();
  const generationInput = {
    ...base.generationInput,
    competitors: [
      { domain: "astro.example", brandName: "", confirmed: false },
      { domain: "rival.example", brandName: "Rival", confirmed: true, aliases: ["Rival Inc"] },
      { domain: "", brandName: "Named Only", confirmed: false },
      { domain: "quiet.example", brandName: "Quiet", confirmed: false, aliases: ["Quiet Co"] },
    ],
  };
  const facts = base.knowledge!.facts;
  const itemKey = facts.status === "unavailable" ? DECISION.itemKey : facts.value[0]!.itemKey;
  return parseGeoKbPayloadV3({
    ...base,
    generationInput,
    review: { decisions: [{ ...DECISION, itemKey }], suppressions: [] },
    runRef: { ...base.runRef, generationInputHash: geoV2Digest(generationInput), knowledgeGenerationId: KNOWLEDGE_GENERATION_ID },
    ...overrides,
  });
}

describe("applyGeoKbV3CompetitorGesture", () => {
  it("confirms a rival under the name given, and re-locks the input the next update pays against", () => {
    const before = stored();
    const result = applyGeoKbV3CompetitorGesture(before, { kind: "confirm", domain: "astro.example", brandName: "Astro", aliases: ["Astro Charts"] });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.changed).toBe(true);
    expect(result.payload.generationInput.competitors[0]).toEqual({ domain: "astro.example", brandName: "Astro", confirmed: true, aliases: ["Astro Charts"] });
    expect(result.payload.runRef.generationInputHash).toBe(geoV2Digest(result.payload.generationInput));
    expect(result.payload.runRef.generationInputHash).not.toBe(before.runRef.generationInputHash);
  });

  /**
   * The database lets the hash move only when every generation id moves with
   * it, and the ids are the claim that a paid record backs this body. What the
   * owner decided stays: a decision hangs off an item's content, and no item's
   * content changes because a rival was named.
   */
  it("releases every generation id in the same write and keeps the knowledge and the review", () => {
    const before = stored();
    const result = applyGeoKbV3CompetitorGesture(before, { kind: "confirm", domain: "astro.example", brandName: "Astro", aliases: [] });
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(result.payload.runRef).toEqual({
      runId: null, generationInputHash: result.payload.runRef.generationInputHash,
      rolesGenerationId: null, knowledgeGenerationId: null, questionsGenerationId: null,
    });
    expect(result.released).toEqual(["knowledgeGenerationId"]);
    expect(result.payload.knowledge).toEqual(before.knowledge);
    expect(result.payload.review).toEqual(before.review);
  });

  it("reports nothing released when no id was set", () => {
    const before = stored({ runRef: { ...stored().runRef, knowledgeGenerationId: null } });
    const result = applyGeoKbV3CompetitorGesture(before, { kind: "confirm", domain: "astro.example", brandName: "Astro", aliases: [] });
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(result.released).toEqual([]);
  });

  it("leaves every other rival exactly as it was", () => {
    const before = stored();
    const result = applyGeoKbV3CompetitorGesture(before, { kind: "confirm", domain: "astro.example", brandName: "Astro", aliases: [] });
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(result.payload.generationInput.competitors.slice(1)).toEqual(before.generationInput.competitors.slice(1));
    expect(result.payload.generationInput.identity).toEqual(before.generationInput.identity);
    expect(result.payload.generationInput.roles).toEqual(before.generationInput.roles);
    expect(result.payload.generationInput.evidenceContentHash).toBe(before.generationInput.evidenceContentHash);
  });

  it("withdraws a confirmation but keeps the name, so confirming again is one gesture", () => {
    const result = applyGeoKbV3CompetitorGesture(stored(), { kind: "unconfirm", domain: "rival.example" });
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(result.payload.generationInput.competitors[1]).toEqual({ domain: "rival.example", brandName: "Rival", confirmed: false, aliases: ["Rival Inc"] });
    expect(result.changed).toBe(true);
  });

  /**
   * A repeated gesture must not mint a draft version: the hash would not move,
   * but the four ids would be released for nothing, forfeiting the paid record
   * the next publish could have reused.
   */
  it("changes nothing when the rival already holds that state", () => {
    const before = stored();
    const same = applyGeoKbV3CompetitorGesture(before, { kind: "confirm", domain: "rival.example", brandName: "Rival", aliases: ["Rival Inc"] });
    if (same.kind !== "ok") throw new Error(same.kind);
    expect(same.changed).toBe(false);
    expect(same.payload).toBe(before);
    expect(same.released).toEqual([]);
    const unconfirmed = applyGeoKbV3CompetitorGesture(before, { kind: "unconfirm", domain: "astro.example" });
    if (unconfirmed.kind !== "ok") throw new Error(unconfirmed.kind);
    expect(unconfirmed.changed).toBe(false);
    // Aliases on an unconfirmed row are a state too, and one a field-order
    // comparison would misread as a change.
    const aliased = applyGeoKbV3CompetitorGesture(before, { kind: "unconfirm", domain: "quiet.example" });
    if (aliased.kind !== "ok") throw new Error(aliased.kind);
    expect(aliased.changed).toBe(false);
  });

  it("refuses a domain the locked input does not name", () => {
    expect(applyGeoKbV3CompetitorGesture(stored(), { kind: "confirm", domain: "nobody.example", brandName: "Nobody", aliases: [] })).toEqual({ kind: "unknown_competitor" });
    expect(applyGeoKbV3CompetitorGesture(stored(), { kind: "unconfirm", domain: "nobody.example" })).toEqual({ kind: "unknown_competitor" });
  });

  /** A brand-only entry has no page anything could read, so it is not the gesture's to confirm. */
  it("refuses the brand-only entry even by its name", () => {
    expect(applyGeoKbV3CompetitorGesture(stored(), { kind: "confirm", domain: "", brandName: "Named Only", aliases: [] })).toEqual({ kind: "unknown_competitor" });
  });

  it("matches the domain exactly, never by case or by www", () => {
    expect(applyGeoKbV3CompetitorGesture(stored(), { kind: "confirm", domain: "Astro.example", brandName: "Astro", aliases: [] })).toEqual({ kind: "unknown_competitor" });
    expect(applyGeoKbV3CompetitorGesture(stored(), { kind: "confirm", domain: "www.astro.example", brandName: "Astro", aliases: [] })).toEqual({ kind: "unknown_competitor" });
  });

  it("refuses a confirmation with no name, which the contract cannot hold", () => {
    expect(applyGeoKbV3CompetitorGesture(stored(), { kind: "confirm", domain: "astro.example", brandName: "   ", aliases: [] })).toEqual({ kind: "invalid" });
  });

  it("trims the name, drops blank and duplicate aliases, and never keeps the name itself as an alias", () => {
    const result = applyGeoKbV3CompetitorGesture(stored(), {
      kind: "confirm", domain: "astro.example", brandName: "  Astro  ", aliases: [" Astro Charts ", "", "Astro Charts", "Astro", "astro"],
    });
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(result.payload.generationInput.competitors[0]).toEqual({ domain: "astro.example", brandName: "Astro", confirmed: true, aliases: ["Astro Charts"] });
  });

  it("writes no aliases key at all when none survive", () => {
    const result = applyGeoKbV3CompetitorGesture(stored(), { kind: "confirm", domain: "astro.example", brandName: "Astro", aliases: [] });
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(Object.hasOwn(result.payload.generationInput.competitors[0]!, "aliases")).toBe(false);
  });
});
