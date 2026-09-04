// @input  -- candidate Product/ICP refresh payloads crossing the Agent API boundary
// @output -- proof that only the exact, evidence-backed v1 wire shape is accepted
// @pos    -- browser-contract tests for live/cached Agent profile diagnosis

import { describe, expect, it } from "vitest";
import {
  AGENT_PROFILE_REFRESH_FIELD_PATHS,
  AGENT_PROFILE_REFRESH_MAX_DIAGNOSTIC_PAGES,
  AGENT_PROFILE_REFRESH_READY_FIELD_PATHS,
  isAgentProfileRefreshData,
  isAgentProfileRefreshEnvelope,
  isAgentProfileRefreshFields,
  type AgentProfileRefreshEnvelope,
  type AgentProfileRefreshField,
  type AgentProfileRefreshFieldPath,
  AGENT_PROFILE_REFRESH_SCHEMA_VERSION,
} from "./profile-refresh-contract.ts";

const SOURCE_URLS = [
  "https://www.acme.com/",
  "https://www.acme.com/pricing",
] as const;

const LIST_PATHS = new Set<AgentProfileRefreshFieldPath>([
  "coreFeatures",
  "categories",
  "trustSignals",
  "icpInterests",
  "useCases",
  "outcomes",
  "barriers",
  "qualificationSignals",
  "disqualifiers",
]);

function availableField(
  path: AgentProfileRefreshFieldPath,
): AgentProfileRefreshField {
  return {
    path,
    state: "available",
    value: LIST_PATHS.has(path) ? [`${path} evidence`] : `${path} evidence`,
    derivation: "inferred",
    confidence: "medium",
    source: "public_page",
    limitation: null,
    evidenceUrls: [SOURCE_URLS[0]],
  } as AgentProfileRefreshField;
}

function unavailableField(
  path: AgentProfileRefreshFieldPath,
): AgentProfileRefreshField {
  return {
    path,
    state: "unavailable",
    value: null,
    derivation: "missing",
    confidence: "unknown",
    source: "not_available",
    limitation: "The supplied public pages do not establish this field.",
    evidenceUrls: [],
  };
}

function envelopeWithAvailableCount(
  availableCount: number,
): AgentProfileRefreshEnvelope {
  const fields = AGENT_PROFILE_REFRESH_FIELD_PATHS.map((path, index) =>
    index < availableCount ? availableField(path) : unavailableField(path),
  );
  return {
    data: {
      schemaVersion: AGENT_PROFILE_REFRESH_SCHEMA_VERSION,
      agent: "seo",
      request: {
        submittedUrl: "www.acme.com/pricing",
        normalizedUrl: "https://www.acme.com/pricing",
        targetHost: "www.acme.com",
        marketCode: "US",
        languageTag: "en-US",
        outputLocale: "en",
      },
      availability:
        availableCount === 0
          ? "no_data"
          : availableCount === AGENT_PROFILE_REFRESH_FIELD_PATHS.length
            ? "available"
            : "partial",
      observedAt: "2026-08-13T10:00:00.000Z",
      cache: {
        status: "fresh",
        capturedAt: "2026-08-13T10:00:00.000Z",
      },
      diagnostics: {
        resolvedOrigin: "https://www.acme.com",
        pagesFetched: 2,
        productPagesFetched: 1,
        stopReason: null,
        contextSufficient: false,
        sourceUrls: SOURCE_URLS,
        fieldsAvailable: availableCount,
        fieldsMissing:
          AGENT_PROFILE_REFRESH_FIELD_PATHS.length - availableCount,
      },
      fields,
    },
  };
}

function envelopeWithAvailablePaths(
  paths: readonly AgentProfileRefreshFieldPath[],
): AgentProfileRefreshEnvelope {
  const available = new Set(paths);
  const fields = AGENT_PROFILE_REFRESH_FIELD_PATHS.map((path) =>
    available.has(path) ? availableField(path) : unavailableField(path),
  );
  return {
    data: {
      ...envelopeWithAvailableCount(0).data,
      availability:
        paths.length === 0
          ? "no_data"
          : AGENT_PROFILE_REFRESH_READY_FIELD_PATHS.every((path) =>
                available.has(path),
              )
            ? "available"
            : "partial",
      diagnostics: {
        ...envelopeWithAvailableCount(0).data.diagnostics,
        fieldsAvailable: paths.length,
        fieldsMissing: AGENT_PROFILE_REFRESH_FIELD_PATHS.length - paths.length,
      },
      fields,
    },
  };
}

function withFields(
  value: AgentProfileRefreshEnvelope,
  fields: readonly unknown[],
): unknown {
  return { data: { ...value.data, fields } };
}

function withRequest(
  value: AgentProfileRefreshEnvelope,
  request: Readonly<Record<string, unknown>>,
): unknown {
  return { data: { ...value.data, request } };
}

function withDiagnostics(
  value: AgentProfileRefreshEnvelope,
  diagnostics: Readonly<Record<string, unknown>>,
): unknown {
  return { data: { ...value.data, diagnostics } };
}

describe("Agent profile refresh wire contract", () => {
  it.each([0, 7, AGENT_PROFILE_REFRESH_FIELD_PATHS.length])(
    "accepts a strict result with %i available fields",
    (availableCount) => {
      const value = envelopeWithAvailableCount(availableCount);

      expect(isAgentProfileRefreshEnvelope(value)).toBe(true);
      expect(isAgentProfileRefreshData(value.data)).toBe(true);
      expect(
        isAgentProfileRefreshFields(
          value.data.fields,
          value.data.diagnostics.sourceUrls,
        ),
      ).toBe(true);
      expect(value.data.fields).toHaveLength(
        AGENT_PROFILE_REFRESH_FIELD_PATHS.length,
      );
    },
  );

  it("reports available when all 14 run-readiness fields exist even if optional fields are missing", () => {
    const ready = envelopeWithAvailablePaths(
      AGENT_PROFILE_REFRESH_READY_FIELD_PATHS,
    );
    const oneReadyFieldMissing = envelopeWithAvailablePaths(
      AGENT_PROFILE_REFRESH_READY_FIELD_PATHS.slice(1),
    );
    const optionalOnly = envelopeWithAvailablePaths(["trustSignals"]);

    expect(AGENT_PROFILE_REFRESH_READY_FIELD_PATHS).toHaveLength(14);
    expect(ready.data.availability).toBe("available");
    expect(isAgentProfileRefreshEnvelope(ready)).toBe(true);
    expect(oneReadyFieldMissing.data.availability).toBe("partial");
    expect(isAgentProfileRefreshEnvelope(oneReadyFieldMissing)).toBe(true);
    expect(optionalOnly.data.availability).toBe("partial");
    expect(isAgentProfileRefreshEnvelope(optionalOnly)).toBe(true);
  });

  it("requires every profile path exactly once and with its declared value kind", () => {
    const base = envelopeWithAvailableCount(2);
    const duplicate = withFields(base, [
      base.data.fields[0],
      base.data.fields[0],
      ...base.data.fields.slice(2),
    ]);
    const missing = withFields(base, base.data.fields.slice(1));
    const allAvailable = envelopeWithAvailableCount(
      AGENT_PROFILE_REFRESH_FIELD_PATHS.length,
    );
    const wrongKind = withFields(
      allAvailable,
      allAvailable.data.fields.map((field) =>
        field.path === "coreFeatures" ? { ...field, value: "not a list" } : field,
      ),
    );

    expect(isAgentProfileRefreshEnvelope(duplicate)).toBe(false);
    expect(isAgentProfileRefreshEnvelope(missing)).toBe(false);
    expect(isAgentProfileRefreshEnvelope(wrongKind)).toBe(false);
  });

  it("requires available fields to cite unique URLs from the bounded crawl", () => {
    const base = envelopeWithAvailableCount(1);
    const replaceEvidence = (evidenceUrls: readonly string[]): unknown =>
      withFields(
        base,
        base.data.fields.map((field, index) =>
          index === 0 ? { ...field, evidenceUrls } : field,
        ),
      );
    const noEvidence = replaceEvidence([]);
    const offCrawl = replaceEvidence(["https://evil.example/invented"]);
    const duplicate = replaceEvidence([SOURCE_URLS[0], SOURCE_URLS[0]]);

    expect(isAgentProfileRefreshEnvelope(noEvidence)).toBe(false);
    expect(isAgentProfileRefreshEnvelope(offCrawl)).toBe(false);
    expect(isAgentProfileRefreshEnvelope(duplicate)).toBe(false);
  });

  it("accepts the diagnostic page limit and rejects one page above it", () => {
    const base = envelopeWithAvailableCount(1);
    const sourceUrls = Array.from(
      { length: AGENT_PROFILE_REFRESH_MAX_DIAGNOSTIC_PAGES + 1 },
      (_, index) => `https://www.acme.com/page-${index}`,
    );
    sourceUrls[0] = SOURCE_URLS[0];
    const atLimit = withDiagnostics(base, {
      ...base.data.diagnostics,
      pagesFetched: AGENT_PROFILE_REFRESH_MAX_DIAGNOSTIC_PAGES,
      productPagesFetched: 12,
      stopReason: null,
      contextSufficient: true,
      sourceUrls: sourceUrls.slice(
        0,
        AGENT_PROFILE_REFRESH_MAX_DIAGNOSTIC_PAGES,
      ),
    });
    const aboveLimit = withDiagnostics(base, {
      ...base.data.diagnostics,
      pagesFetched: AGENT_PROFILE_REFRESH_MAX_DIAGNOSTIC_PAGES + 1,
      productPagesFetched: 12,
      stopReason: null,
      contextSufficient: true,
      sourceUrls,
    });

    expect(isAgentProfileRefreshEnvelope(atLimit)).toBe(true);
    expect(isAgentProfileRefreshEnvelope(aboveLimit)).toBe(false);
  });

  it("keeps unavailable distinct from empty, inferred values", () => {
    const unavailableBase = envelopeWithAvailableCount(0);
    const unavailableWithValue = withFields(
      unavailableBase,
      unavailableBase.data.fields.map((field, index) =>
        index === 0 ? { ...field, value: "guessed" } : field,
      ),
    );
    const availableBase = envelopeWithAvailableCount(1);
    const availableEmpty = withFields(
      availableBase,
      availableBase.data.fields.map((field, index) =>
        index === 0 ? { ...field, value: "" } : field,
      ),
    );
    const missingLimitation = withFields(
      unavailableBase,
      unavailableBase.data.fields.map((field, index) =>
        index === 0 ? { ...field, limitation: "" } : field,
      ),
    );

    expect(isAgentProfileRefreshEnvelope(unavailableWithValue)).toBe(false);
    expect(isAgentProfileRefreshEnvelope(availableEmpty)).toBe(false);
    expect(isAgentProfileRefreshEnvelope(missingLimitation)).toBe(false);
  });

  it("rejects request identity that does not match its normalized URL", () => {
    const base = envelopeWithAvailableCount(1);
    const wrongHost = withRequest(base, {
      ...base.data.request,
      targetHost: "other.example",
    });
    const nonCanonicalLanguage = withRequest(base, {
      ...base.data.request,
      languageTag: "en-us",
    });
    const lowercaseMarket = withRequest(base, {
      ...base.data.request,
      marketCode: "us",
    });
    const fragment = withRequest(base, {
      ...base.data.request,
      normalizedUrl: "https://www.acme.com/#fragment",
    });

    expect(isAgentProfileRefreshEnvelope(wrongHost)).toBe(false);
    expect(isAgentProfileRefreshEnvelope(nonCanonicalLanguage)).toBe(false);
    expect(isAgentProfileRefreshEnvelope(lowercaseMarket)).toBe(false);
    expect(isAgentProfileRefreshEnvelope(fragment)).toBe(false);
  });

  it("rejects inconsistent diagnostics, counts, availability, and timestamps", () => {
    const base = envelopeWithAvailableCount(1);
    const tooManyProductPages = withDiagnostics(base, {
      ...base.data.diagnostics,
      productPagesFetched: 3,
    });
    const badCounts = withDiagnostics(base, {
      ...base.data.diagnostics,
      fieldsMissing: 0,
    });
    const wrongAvailability = {
      data: { ...base.data, availability: "available" },
    };
    const duplicateSource = withDiagnostics(base, {
      ...base.data.diagnostics,
      sourceUrls: [SOURCE_URLS[0], SOURCE_URLS[0]],
    });
    const nonCanonicalTime = {
      data: { ...base.data, observedAt: "2026-08-13T10:00:00Z" },
    };

    expect(isAgentProfileRefreshEnvelope(tooManyProductPages)).toBe(false);
    expect(isAgentProfileRefreshEnvelope(badCounts)).toBe(false);
    expect(isAgentProfileRefreshEnvelope(wrongAvailability)).toBe(false);
    expect(isAgentProfileRefreshEnvelope(duplicateSource)).toBe(false);
    expect(isAgentProfileRefreshEnvelope(nonCanonicalTime)).toBe(false);
  });

  it.each([
    ["envelope", (value: AgentProfileRefreshEnvelope) => ({ ...value, debug: true })],
    [
      "data",
      (value: AgentProfileRefreshEnvelope) => ({
        data: { ...value.data, projectId: "forbidden" },
      }),
    ],
    [
      "request",
      (value: AgentProfileRefreshEnvelope) => ({
        data: {
          ...value.data,
          request: { ...value.data.request, workspaceId: "forbidden" },
        },
      }),
    ],
    [
      "cache",
      (value: AgentProfileRefreshEnvelope) => ({
        data: { ...value.data, cache: { ...value.data.cache, age: 0 } },
      }),
    ],
    [
      "diagnostics",
      (value: AgentProfileRefreshEnvelope) => ({
        data: {
          ...value.data,
          diagnostics: { ...value.data.diagnostics, percent: 100 },
        },
      }),
    ],
    [
      "field",
      (value: AgentProfileRefreshEnvelope) => ({
        data: {
          ...value.data,
          fields: [
            { ...value.data.fields[0], durableEvidenceId: "forbidden" },
            ...value.data.fields.slice(1),
          ],
        },
      }),
    ],
  ] as const)("rejects an extra %s key", (_label, mutate) => {
    expect(isAgentProfileRefreshEnvelope(mutate(envelopeWithAvailableCount(1)))).toBe(
      false,
    );
  });
});
