import { describe, expect, it } from "vitest";
import {
  canonicalProjectRoute,
  growthMapCompatibilityRoute,
  growthMapFindingRoute,
} from "./_compatibility-route.ts";

/**
 * These functions are the whole of the "an old link still works" promise: the
 * four compatibility routes (`/plan`, `/studio`, `/diagnosis`, `/report`) do
 * nothing but call them and `redirect()`. Until 2026-07-26 nothing tested them,
 * so dropping a query parameter or failing to translate a legacy vocabulary
 * value would have broken deep links silently — the redirect would still land
 * on a valid screen, just not the one the link asked for.
 */

const PROJECT = "00000000-0000-4000-8000-000000000042";

describe("canonicalProjectRoute", () => {
  it("omits the question mark entirely when there is no query state", () => {
    expect(canonicalProjectRoute(PROJECT, "execution", {})).toBe(
      `/p/${PROJECT}/execution`,
    );
  });

  it("carries every value of a repeated parameter, not just the first", () => {
    const route = canonicalProjectRoute(PROJECT, "results", {
      artifactId: ["a", "b"],
    });
    expect(route).toBe(`/p/${PROJECT}/results?artifactId=a&artifactId=b`);
  });

  it("drops undefined values rather than serialising them", () => {
    expect(
      canonicalProjectRoute(PROJECT, "execution", {
        actionId: "keep",
        artifactId: undefined,
      }),
    ).toBe(`/p/${PROJECT}/execution?actionId=keep`);
  });
});

describe("growthMapCompatibilityRoute", () => {
  it("translates the legacy search parameter into the canonical one", () => {
    const route = growthMapCompatibilityRoute(PROJECT, { search: "pricing" });
    expect(route).toBe(`/p/${PROJECT}/growth-map?q=pricing`);
  });

  it("lets the canonical key win when a client supplied both", () => {
    // The docstring's rule: "Canonical keys win when both old and new clients
    // supplied the same state." The legacy key must not survive either, or the
    // destination would carry two spellings of one piece of state.
    const route = growthMapCompatibilityRoute(PROJECT, {
      q: "canonical",
      search: "legacy",
    });
    expect(route).toBe(`/p/${PROJECT}/growth-map?q=canonical`);
  });

  it.each([
    ["url", "pages"],
    ["urls", "pages"],
    ["page", "pages"],
    ["keyword", "keywords"],
    ["competitor", "competitors"],
  ])("translates the legacy tab %s into object %s", (tab, object) => {
    expect(growthMapCompatibilityRoute(PROJECT, { tab })).toBe(
      `/p/${PROJECT}/growth-map?object=${object}`,
    );
  });

  it("emits no object at all for a tab value it does not recognise", () => {
    // Guessing would send the operator to an arbitrary object type. Landing on
    // Growth Map's own default is the honest outcome.
    expect(growthMapCompatibilityRoute(PROJECT, { tab: "invented" })).toBe(
      `/p/${PROJECT}/growth-map`,
    );
  });

  it("lets a canonical object win over a legacy tab", () => {
    expect(
      growthMapCompatibilityRoute(PROJECT, {
        object: "keywords",
        tab: "competitor",
      }),
    ).toBe(`/p/${PROJECT}/growth-map?object=keywords`);
  });

  it("takes the first item when a legacy key was repeated", () => {
    expect(
      growthMapCompatibilityRoute(PROJECT, {
        search: ["first", "second"],
        tab: ["keyword", "competitor"],
      }),
    ).toBe(`/p/${PROJECT}/growth-map?q=first&object=keywords`);
  });

  it("passes unrelated parameters through untouched", () => {
    expect(
      growthMapCompatibilityRoute(PROJECT, { findingId: "f-1" }),
    ).toBe(`/p/${PROJECT}/growth-map?findingId=f-1`);
  });
});

describe("growthMapFindingRoute", () => {
  it("always scopes the deep link to the URL portfolio", () => {
    expect(growthMapFindingRoute(PROJECT, "f-1")).toBe(
      `/p/${PROJECT}/growth-map?object=pages&findingId=f-1`,
    );
  });

  it("adds the address only when one is known", () => {
    expect(growthMapFindingRoute(PROJECT, "f-1", null)).toBe(
      `/p/${PROJECT}/growth-map?object=pages&findingId=f-1`,
    );
    expect(
      growthMapFindingRoute(PROJECT, "f-1", "https://example.com/pricing"),
    ).toBe(
      `/p/${PROJECT}/growth-map?object=pages&findingId=f-1&q=https%3A%2F%2Fexample.com%2Fpricing`,
    );
  });
});
