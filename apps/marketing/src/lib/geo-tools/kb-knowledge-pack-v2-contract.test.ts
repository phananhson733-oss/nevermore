import { describe, expect, it } from "vitest";

import { geoKnowledgePackV2Fixture } from "../../components/tools/geo-knowledge-pack-v2.test-fixtures.ts";
import { buildGeoKnowledgePackV2 } from "./kb-knowledge-pack-v2-contract.ts";

const AT = "2026-09-04T07:11:15.461Z";

/**
 * Rebuild the published pack with one fact's fields replaced. The fixture is
 * the real builder's output, so anything this rejects is rejected for a reason
 * the contract states, not for a shape the fixture happened to be missing.
 */
function packWithCoverageFact(over: Record<string, unknown>): () => unknown {
  const { contentHash: _contentHash, ...body } = structuredClone(geoKnowledgePackV2Fixture()) as Record<string, any>;
  const facts = body.facts.value as Record<string, unknown>[];
  const index = facts.findIndex((fact) => fact.id === "fact:coverage");
  expect(index).toBeGreaterThanOrEqual(0);
  facts[index] = { ...facts[index], ...over };
  return () => buildGeoKnowledgePackV2(body);
}

/** An unavailable fact: no value, and a reason that says why there is none. */
const unavailable = { value: null, reason: "notPublished" } as const;

describe("provenance on a fact that has no value", () => {
  it("still builds the fixture it started from", () => {
    expect(() => geoKnowledgePackV2Fixture()).not.toThrow();
  });

  /**
   * The exemption this branch exists for. An unavailable fact has nothing to
   * cite, so "an observed item requires a source" cannot apply to it -- and a
   * pack that refused this would have no way to publish "we looked and the
   * page does not say".
   */
  it("lets an observed fact be unavailable with no source at all", () => {
    expect(packWithCoverageFact({
      ...unavailable,
      origin: "observed_third_party",
      sourceRefs: [],
      priorSourceRefs: [],
      ownerDeclaredAt: null,
      evidenceChecks: "cited_and_literals_match",
    })).not.toThrow();
  });

  /** The owner-correction shape, which must keep publishing unchanged. */
  it("lets an owner declaration be unavailable, citing what it replaced", () => {
    expect(packWithCoverageFact({
      ...unavailable,
      origin: "declared_owner",
      sourceRefs: [],
      priorSourceRefs: ["source:home"],
      ownerDeclaredAt: AT,
      evidenceChecks: "owner_declared",
    })).not.toThrow();
  });

  /**
   * The hole. Exempting an unavailable fact from the *source* rule is not the
   * same as exempting it from every provenance rule: this fact was observed by
   * a third party and claims the owner declared it, which is the one badge a
   * reader treats as the brand's own word. It also carries a declaration time
   * it never earned and superseded sources only a declaration may have.
   */
  it("refuses an observed fact that claims to be owner-declared", () => {
    expect(packWithCoverageFact({
      ...unavailable,
      origin: "observed_third_party",
      sourceRefs: [],
      priorSourceRefs: ["source:home"],
      ownerDeclaredAt: AT,
      evidenceChecks: "owner_declared",
    })).toThrow();
  });

  it("refuses an owner declaration that claims its numbers were checked against a citation", () => {
    expect(packWithCoverageFact({
      ...unavailable,
      origin: "declared_owner",
      sourceRefs: [],
      priorSourceRefs: [],
      ownerDeclaredAt: AT,
      evidenceChecks: "cited_and_literals_match",
    })).toThrow();
  });

  it("refuses superseded sources on a fact no owner declared", () => {
    expect(packWithCoverageFact({
      ...unavailable,
      origin: "synthesized",
      sourceRefs: [],
      priorSourceRefs: ["source:home"],
      ownerDeclaredAt: null,
      evidenceChecks: "cited_and_literals_match",
    })).toThrow();
  });

  it("refuses a declaration time on a fact no owner declared", () => {
    expect(packWithCoverageFact({
      ...unavailable,
      origin: "synthesized",
      sourceRefs: [],
      priorSourceRefs: [],
      ownerDeclaredAt: AT,
      evidenceChecks: "cited_and_literals_match",
    })).toThrow();
  });

  /** Unchanged: the branch's own rule still has to hold. */
  it("still refuses an unavailable fact that does not say why", () => {
    expect(packWithCoverageFact({ value: null, reason: "" })).toThrow();
  });

  it("still refuses an owner declaration with no declaration time", () => {
    expect(packWithCoverageFact({
      ...unavailable,
      origin: "declared_owner",
      sourceRefs: [],
      priorSourceRefs: [],
      ownerDeclaredAt: null,
      evidenceChecks: "owner_declared",
    })).toThrow();
  });
});
