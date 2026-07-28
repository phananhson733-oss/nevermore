import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  new URL("./_geo-citation-evidence.tsx", import.meta.url),
  "utf8",
);

describe("GEO citation evidence customer surface", () => {
  it("shows the immutable query, platform, collector, citation, and paragraph identity", () => {
    expect(SOURCE).toContain("{query.query}");
    expect(SOURCE).toContain("platformLabel(query.platform, t)");
    expect(SOURCE).toContain("query.collector.providerKey");
    expect(SOURCE).toContain("query.collector.version");
    expect(SOURCE).toContain("citation.citationUrl");
    expect(SOURCE).toContain("citation.answerEvidenceExcerpt");
    expect(SOURCE).toContain("citation.citedPageExcerpt");
    expect(SOURCE).toContain(
      "citation.citedParagraphSelector",
    );
    expect(SOURCE).toContain(
      "citation.citedParagraphHash.slice(0, 12)",
    );
    expect(SOURCE).toContain("query.evidenceStatements");
    expect(SOURCE).toContain("statement.classification");
    expect(SOURCE).toContain("statement.evidence.excerpt");
    expect(SOURCE).toContain(
      "statement.evidence.contentHash.slice(0, 12)",
    );
  });

  it("renders real before/after metrics and missing phases without zero fallbacks", () => {
    expect(SOURCE).toContain(
      '<th scope="col">{t("table.before")}</th>',
    );
    expect(SOURCE).toContain(
      '<th scope="col">{t("table.after")}</th>',
    );
    expect(SOURCE).toContain(
      't("geoEvidence.phaseUnavailable")',
    );
    expect(SOURCE).toContain(
      't("geoEvidence.nonCausal")',
    );
    expect(SOURCE).not.toMatch(/\?\?\s*0/gu);
  });

  it("isolates external evidence links and exposes retry semantics", () => {
    expect(SOURCE).toContain('rel="noreferrer noopener"');
    expect(SOURCE).toContain('role="alert"');
    expect(SOURCE).toContain("query.refetch()");
  });
});
