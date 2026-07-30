import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  automaticSynthesisKey,
  claimOnce,
  customerProfileFieldKey,
  shouldStartCrawlForMissingSnapshot,
} from "./_product-profile-onboarding";

describe("Product Profile automatic onboarding guard", () => {
  const draft = {
    rowId: "00000000-0000-4000-8000-000000000001",
    version: 1,
    status: "draft" as const,
    generatedAt: null,
    activeSynthesisRunId: null,
    crawlRunId: "",
  };

  it("offers exactly one key for an ungenerated idle draft", () => {
    const key = automaticSynthesisKey(draft);
    expect(key).toBe(`${draft.rowId}:1`);

    const claimed = new Set<string>();
    expect(claimOnce(claimed, key!)).toBe(true);
    expect(claimOnce(claimed, key!)).toBe(false);
  });

  it("does not race active work or regenerate a completed draft", () => {
    expect(
      automaticSynthesisKey({
        ...draft,
        activeSynthesisRunId: "00000000-0000-4000-8000-000000000002",
      }),
    ).toBeNull();
    expect(
      automaticSynthesisKey({
        ...draft,
        crawlRunId: "00000000-0000-4000-8000-000000000003",
      }),
    ).toBeNull();
    expect(
      automaticSynthesisKey({
        ...draft,
        generatedAt: "2026-07-30T00:00:00.000Z",
      }),
    ).toBeNull();
  });

  it("stops the automatic loop if the post-Crawl retry still lacks evidence", () => {
    expect(shouldStartCrawlForMissingSnapshot("initial")).toBe(true);
    expect(shouldStartCrawlForMissingSnapshot("manual")).toBe(true);
    expect(shouldStartCrawlForMissingSnapshot("after_crawl")).toBe(false);
  });

  it("wires terminal Crawl success to synthesis and active-run adoption", () => {
    const source = readFileSync(
      new URL("./_product-profile.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('startSynthesis(row.version, "after_crawl")');
    expect(source).toContain("activeProjectRunIdFromError(error, projectId)");
    expect(source).toContain('startSynthesis(row.version, "initial")');
    expect(source).toContain("setSynthesisRunId(activeRunId)");
  });
});

describe("customer-visible unresolved field names", () => {
  it("maps nested internal pointers to one customer-facing concept", () => {
    expect(customerProfileFieldKey("/targetAudiences/0/buyerRoles")).toBe(
      "primaryIcp",
    );
    expect(customerProfileFieldKey("/competitorCandidates")).toBe(
      "competitors",
    );
    expect(customerProfileFieldKey("/unknownInternalRoot")).toBe("other");
  });

  it("keeps UUIDs, request ids, and raw pointers out of rendered customer copy", () => {
    const source = readFileSync(
      new URL("./_product-profile.tsx", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain(
      "<strong>{view.evidence.sourceSnapshotId",
    );
    expect(source).not.toContain(
      "<strong>{view.evidence.analysisInvocationId",
    );
    expect(source).not.toContain(
      "<ValueList values={profile.missingFields}",
    );
    expect(source).not.toContain(
      "<ValueList values={profile.conflictingFields}",
    );
    expect(source).not.toContain("feedback.requestId");
  });
});
