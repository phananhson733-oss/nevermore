import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  TOOL_HANDOFF_KEY,
  TOOL_HANDOFF_TTL_MS,
  consumeToolHandoff,
  writeToolHandoff,
} from "./tool-handoff.ts";

function storage() {
  const entries = new Map<string, string>();
  return {
    getItem(key: string) {
      return entries.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      entries.set(key, value);
    },
    removeItem(key: string) {
      entries.delete(key);
    },
  };
}

function payload() {
  return {
    source: "daily-search-briefing" as const,
    destination: "on-page-seo-check" as const,
    scope: "query_page" as const,
    property: "sc-domain:example.com",
    query: "pricing automation",
    page: "https://example.com/pricing",
    evidenceId: "first-observed:pricing-automation",
  };
}

function propertyPayload() {
  return {
    source: "daily-search-briefing" as const,
    destination: "traffic-drop-diagnosis" as const,
    scope: "property" as const,
    property: "sc-domain:example.com",
    query: null,
    page: null,
    evidenceId: "sitewide-click-decline",
  };
}

function competitorGapPayload() {
  return {
    source: "competitor-keyword-gap" as const,
    destination: "on-page-seo-check" as const,
    scope: "query_page" as const,
    property: "sc-domain:example.com",
    query: "pricing automation",
    page: "https://example.com/pricing",
    evidenceId: "gap:pricing-automation:observed-sufficient",
    marketCode: "GB",
    languageCode: "en",
  };
}

describe("tool handoff storage", () => {
  it("uses one fixed tab-scoped key and a ten-minute lifetime", () => {
    expect(TOOL_HANDOFF_KEY).toBe("gengrowth.tool-handoff.v1");
    expect(TOOL_HANDOFF_TTL_MS).toBe(600_000);
  });

  it("writes one valid handoff and consumes it exactly once", () => {
    const session = storage();
    const now = 1_000;

    expect(writeToolHandoff(session, now, payload())).toBe(true);

    expect(consumeToolHandoff(session, now + 1, "on-page-seo-check")).toEqual({
      source: "daily-search-briefing",
      destination: "on-page-seo-check",
      scope: "query_page",
      property: "sc-domain:example.com",
      query: "pricing automation",
      page: "https://example.com/pricing",
      evidenceId: "first-observed:pricing-automation",
      createdAt: now,
      expiresAt: now + TOOL_HANDOFF_TTL_MS,
    });
    expect(consumeToolHandoff(session, now + 2, "on-page-seo-check")).toBeNull();
  });

  it("writes and consumes one competitor-gap handoff with its full private context", () => {
    const session = storage();
    const now = 1_000;

    expect(writeToolHandoff(session, now, competitorGapPayload())).toBe(true);

    expect(consumeToolHandoff(session, now + 1, "on-page-seo-check")).toEqual({
      source: "competitor-keyword-gap",
      destination: "on-page-seo-check",
      scope: "query_page",
      property: "sc-domain:example.com",
      query: "pricing automation",
      page: "https://example.com/pricing",
      evidenceId: "gap:pricing-automation:observed-sufficient",
      marketCode: "GB",
      languageCode: "en",
      createdAt: now,
      expiresAt: now + TOOL_HANDOFF_TTL_MS,
    });
    expect(consumeToolHandoff(session, now + 2, "on-page-seo-check")).toBeNull();
  });

  it("keeps unsupported but well-shaped gap market context for the consumer to resolve", () => {
    const session = storage();

    expect(
      writeToolHandoff(session, 1_000, {
        ...competitorGapPayload(),
        marketCode: "ZZ",
        languageCode: "zz",
      }),
    ).toBe(true);
    expect(consumeToolHandoff(session, 1_001, "on-page-seo-check")).toMatchObject({
      marketCode: "ZZ",
      languageCode: "zz",
    });
  });

  it("writes one property-scoped handoff with no invented query or page", () => {
    const session = storage();
    const now = 1_000;

    expect(writeToolHandoff(session, now, propertyPayload())).toBe(true);

    expect(
      consumeToolHandoff(session, now + 1, "traffic-drop-diagnosis"),
    ).toEqual({
      source: "daily-search-briefing",
      destination: "traffic-drop-diagnosis",
      scope: "property",
      property: "sc-domain:example.com",
      query: null,
      page: null,
      evidenceId: "sitewide-click-decline",
      createdAt: now,
      expiresAt: now + TOOL_HANDOFF_TTL_MS,
    });
  });

  it.each([
    ["a property query", { ...propertyPayload(), query: "invented query" }],
    ["a property page", { ...propertyPayload(), page: "https://example.com" }],
    [
      "a property destination for On-Page",
      { ...propertyPayload(), destination: "on-page-seo-check" },
    ],
    ["a null query/page query", { ...payload(), query: null }],
    ["a blank query/page query", { ...payload(), query: "   " }],
    ["a null query/page page", { ...payload(), page: null }],
    ["a blank query/page page", { ...payload(), page: "   " }],
    [
      "a missing scope",
      {
        source: "daily-search-briefing",
        destination: "traffic-drop-diagnosis",
        property: "sc-domain:example.com",
        query: null,
        page: null,
        evidenceId: "sitewide-click-decline",
      },
    ],
    ["an unknown scope", { ...propertyPayload(), scope: "site" }],
  ] as const)("rejects %s on write and removes it on consume", (_label, candidate) => {
    const written = storage();
    const stored = storage();

    expect(writeToolHandoff(written, 1_000, candidate as never)).toBe(false);
    stored.setItem(
      TOOL_HANDOFF_KEY,
      JSON.stringify({
        ...candidate,
        createdAt: 1_000,
        expiresAt: 1_000 + TOOL_HANDOFF_TTL_MS,
      }),
    );

    expect(consumeToolHandoff(stored, 1_001, "on-page-seo-check")).toBeNull();
    expect(stored.getItem(TOOL_HANDOFF_KEY)).toBeNull();
  });

  it.each([
    [
      "a non-On-Page destination",
      { ...competitorGapPayload(), destination: "seo-quick-wins" },
    ],
    ["a non-query-page scope", { ...competitorGapPayload(), scope: "property" }],
    ["a blank property", { ...competitorGapPayload(), property: "   " }],
    [
      "an oversized property",
      { ...competitorGapPayload(), property: "x".repeat(513) },
    ],
    ["a blank query", { ...competitorGapPayload(), query: "   " }],
    [
      "an oversized query",
      { ...competitorGapPayload(), query: "x".repeat(513) },
    ],
    ["a blank evidence id", { ...competitorGapPayload(), evidenceId: "   " }],
    [
      "an oversized evidence id",
      { ...competitorGapPayload(), evidenceId: "x".repeat(257) },
    ],
    [
      "a missing market",
      (({ marketCode: _marketCode, ...rest }) => rest)(competitorGapPayload()),
    ],
    ["an oversized market", { ...competitorGapPayload(), marketCode: "USA" }],
    ["a lowercase market", { ...competitorGapPayload(), marketCode: "gb" }],
    [
      "a missing language",
      (({ languageCode: _languageCode, ...rest }) => rest)(
        competitorGapPayload(),
      ),
    ],
    ["an oversized language", { ...competitorGapPayload(), languageCode: "eng" }],
    ["an uppercase language", { ...competitorGapPayload(), languageCode: "EN" }],
    ["a relative page", { ...competitorGapPayload(), page: "/pricing" }],
    ["a non-http page", { ...competitorGapPayload(), page: "javascript:alert(1)" }],
    [
      "an oversized page",
      {
        ...competitorGapPayload(),
        page: `https://example.com/${"x".repeat(2_048)}`,
      },
    ],
    [
      "a credential-bearing page",
      { ...competitorGapPayload(), page: "https://user:secret@example.com/pricing" },
    ],
    ["an extra field", { ...competitorGapPayload(), privateExtra: "no" }],
  ] as const)(
    "rejects competitor-gap payload with %s on write and removes it on consume",
    (_label, candidate) => {
      const written = storage();
      const stored = storage();

      expect(writeToolHandoff(written, 1_000, candidate as never)).toBe(false);
      stored.setItem(
        TOOL_HANDOFF_KEY,
        JSON.stringify({
          ...candidate,
          createdAt: 1_000,
          expiresAt: 1_000 + TOOL_HANDOFF_TTL_MS,
        }),
      );

      expect(consumeToolHandoff(stored, 1_001, "on-page-seo-check")).toBeNull();
      expect(stored.getItem(TOOL_HANDOFF_KEY)).toBeNull();
    },
  );

  it("does not let gap-only fields loosen the Daily Briefing exact-key contract", () => {
    const session = storage();

    expect(
      writeToolHandoff(session, 1_000, {
        ...payload(),
        marketCode: "GB",
        languageCode: "en",
      } as never),
    ).toBe(false);
  });

  it("expires and removes a competitor-gap handoff at the shared TTL", () => {
    const session = storage();
    const now = 1_000;

    expect(writeToolHandoff(session, now, competitorGapPayload())).toBe(true);
    expect(
      consumeToolHandoff(
        session,
        now + TOOL_HANDOFF_TTL_MS,
        "on-page-seo-check",
      ),
    ).toBeNull();
    expect(session.getItem(TOOL_HANDOFF_KEY)).toBeNull();
  });

  it("leaves the payload untouched for a different destination", () => {
    const session = storage();

    writeToolHandoff(session, 1_000, payload());

    expect(consumeToolHandoff(session, 1_001, "seo-quick-wins")).toBeNull();
    expect(consumeToolHandoff(session, 1_002, "on-page-seo-check")).not.toBeNull();
  });

  it("expires the payload after ten minutes", () => {
    const session = storage();
    const now = 1_000;

    writeToolHandoff(session, now, payload());

    expect(
      consumeToolHandoff(
        session,
        now + TOOL_HANDOFF_TTL_MS + 1,
        "on-page-seo-check",
      ),
    ).toBeNull();
    expect(session.getItem("gengrowth.tool-handoff.v1")).toBeNull();
  });

  it("treats the exact expiry instant as expired", () => {
    const session = storage();
    const now = 1_000;

    writeToolHandoff(session, now, payload());

    expect(
      consumeToolHandoff(
        session,
        now + TOOL_HANDOFF_TTL_MS,
        "on-page-seo-check",
      ),
    ).toBeNull();
    expect(session.getItem(TOOL_HANDOFF_KEY)).toBeNull();
  });

  it("rejects a handoff whose creation time is still in the future", () => {
    const session = storage();
    const now = 1_000;
    session.setItem(
      TOOL_HANDOFF_KEY,
      JSON.stringify({
        ...payload(),
        createdAt: now + 1,
        expiresAt: now + 1 + TOOL_HANDOFF_TTL_MS,
      }),
    );

    expect(consumeToolHandoff(session, now, "on-page-seo-check")).toBeNull();
    expect(session.getItem(TOOL_HANDOFF_KEY)).toBeNull();
  });

  it("rejects malformed JSON and clears it", () => {
    const session = storage();
    session.setItem("gengrowth.tool-handoff.v1", "{");

    expect(consumeToolHandoff(session, 1_000, "on-page-seo-check")).toBeNull();
    expect(session.getItem("gengrowth.tool-handoff.v1")).toBeNull();
  });

  it("rejects unexpected payload fields on write and consume", () => {
    const written = storage();
    const stored = storage();
    const withExtra = { ...payload(), unexpected: "do not carry this" };

    expect(writeToolHandoff(written, 1_000, withExtra)).toBe(false);

    stored.setItem(
      TOOL_HANDOFF_KEY,
      JSON.stringify({
        ...withExtra,
        createdAt: 1_000,
        expiresAt: 1_000 + TOOL_HANDOFF_TTL_MS,
      }),
    );
    expect(consumeToolHandoff(stored, 1_001, "on-page-seo-check")).toBeNull();
    expect(stored.getItem(TOOL_HANDOFF_KEY)).toBeNull();
  });

  it.each([
    ["source", "another-tool"],
    ["destination", "another-destination"],
    ["property", "   "],
    ["query", "x".repeat(513)],
    ["page", "x".repeat(2_049)],
    ["evidenceId", "x".repeat(257)],
  ] as const)("clears a stored payload with an invalid %s", (field, value) => {
    const session = storage();
    session.setItem(
      TOOL_HANDOFF_KEY,
      JSON.stringify({
        ...payload(),
        [field]: value,
        createdAt: 1_000,
        expiresAt: 1_000 + TOOL_HANDOFF_TTL_MS,
      }),
    );

    expect(consumeToolHandoff(session, 1_001, "on-page-seo-check")).toBeNull();
    expect(session.getItem(TOOL_HANDOFF_KEY)).toBeNull();
  });

  it("fails closed on oversized or blank fields", () => {
    const session = storage();

    expect(
      writeToolHandoff(session, 1_000, {
        ...payload(),
        query: "x".repeat(513),
      }),
    ).toBe(false);
    expect(
      writeToolHandoff(session, 1_000, {
        ...payload(),
        page: "   ",
      }),
    ).toBe(false);
  });

  it.each([
    ["property", 512],
    ["query", 512],
    ["page", 2_048],
    ["evidenceId", 256],
  ] as const)("accepts %s only through its declared boundary", (field, max) => {
    const exact = storage();
    const oversized = storage();

    expect(
      writeToolHandoff(exact, 1_000, {
        ...payload(),
        [field]: "x".repeat(max),
      }),
    ).toBe(true);
    expect(
      writeToolHandoff(oversized, 1_000, {
        ...payload(),
        [field]: "x".repeat(max + 1),
      }),
    ).toBe(false);
  });

  it.each([
    ["non-finite writer time", Number.POSITIVE_INFINITY],
    ["not-a-number writer time", Number.NaN],
  ] as const)("rejects %s", (_label, now) => {
    const session = storage();

    expect(writeToolHandoff(session, now, payload())).toBe(false);
    expect(session.getItem(TOOL_HANDOFF_KEY)).toBeNull();
  });

  it("clears a stored payload with non-finite timestamps or an overlong lifetime", () => {
    for (const timestamps of [
      { createdAt: null, expiresAt: 2_000 },
      { createdAt: 1_000, expiresAt: null },
      { createdAt: 1_000, expiresAt: 1_000 + TOOL_HANDOFF_TTL_MS + 1 },
    ]) {
      const session = storage();
      session.setItem(
        TOOL_HANDOFF_KEY,
        JSON.stringify({ ...payload(), ...timestamps }),
      );

      expect(consumeToolHandoff(session, 1_001, "on-page-seo-check")).toBeNull();
      expect(session.getItem(TOOL_HANDOFF_KEY)).toBeNull();
    }
  });

  it("treats storage failures as an unavailable handoff", () => {
    const session = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
    };

    expect(writeToolHandoff(session, 1_000, payload())).toBe(false);
    expect(consumeToolHandoff(session, 1_000, "on-page-seo-check")).toBeNull();
  });

  it("does not release a valid payload when deleting it throws", () => {
    const handoff = JSON.stringify({
      ...payload(),
      createdAt: 1_000,
      expiresAt: 1_000 + TOOL_HANDOFF_TTL_MS,
    });
    const session = {
      getItem: () => handoff,
      setItem: () => undefined,
      removeItem: () => {
        throw new Error("blocked");
      },
    };

    expect(consumeToolHandoff(session, 1_001, "on-page-seo-check")).toBeNull();
  });

  it("has no URL, persistent-storage, cookie, or network transport API", () => {
    const source = readFileSync(new URL("./tool-handoff.ts", import.meta.url), "utf8");

    for (const forbidden of [
      "URLSearchParams",
      "window.location",
      "localStorage",
      "document.cookie",
      "fetch(",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
