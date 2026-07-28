import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const openapi = readFileSync(
  new URL("../../../openapi/mvp.yaml", import.meta.url),
  "utf8",
);

describe("Growth Map Backlink OpenAPI source contract", () => {
  it("publishes one read-only path inside Growth Map", () => {
    expect(openapi).toContain(
      "/projects/{projectId}/audit/backlinks:",
    );
    expect(openapi).toContain("operationId: getProjectAuditBacklinks");
    expect(openapi).toContain(
      "not a fifth workspace module or a customer-managed data connection",
    );
  });

  it("keeps provider totals separate from observed CSV/search discoveries", () => {
    expect(openapi).toContain(
      "enum: [provider_import, manual_csv, search_derived]",
    );
    expect(openapi).toContain(
      "enum: [provider_index_total, observed_fact_count, unavailable]",
    );
    expect(openapi).toContain(
      "Only a\n        real provider import may expose provider index totals or DR/DA.",
    );
    expect(openapi).toContain(
      "Missing, partial, and unavailable data\n        are explicit and are never replaced with zero.",
    );
  });

  it("requires traceable snapshots for page facts, comparison, and opportunities", () => {
    for (const schema of [
      "BacklinkSnapshotSource",
      "BacklinkPageItem",
      "BacklinkComparison",
      "BacklinkOpportunity",
      "GrowthMapBacklinkReadModel",
    ]) {
      expect(openapi).toMatch(
        new RegExp(
          `    ${schema}:\\n      type: object\\n      additionalProperties: false`,
          "u",
        ),
      );
    }
    expect(openapi).toContain("evidenceSnapshotIds:");
    expect(openapi).toContain("importPreviewId:");
    expect(openapi).toContain(
      "backlinkComparisonUsesSameProviderAndApprovedCompetitors",
    );
  });
});
