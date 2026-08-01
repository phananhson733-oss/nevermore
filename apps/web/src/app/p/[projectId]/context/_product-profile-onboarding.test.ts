import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  automaticSynthesisKey,
  claimOnce,
  customerProfileFieldKey,
  productProfileSynthesisFailureKind,
  shouldStartCrawlForMissingSnapshot,
} from "./_product-profile-onboarding";

describe("Product Profile automatic onboarding guard", () => {
  const draft = {
    rowId: "00000000-0000-4000-8000-000000000001",
    version: 1,
    status: "draft" as const,
    generatedAt: null,
    hasSynthesisAttemptForCurrentDraft: false,
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
    expect(
      automaticSynthesisKey({
        ...draft,
        hasSynthesisAttemptForCurrentDraft: true,
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

  it("sends a confirmed profile to Sources with one automatic refresh intent", () => {
    const source = readFileSync(
      new URL("./_product-profile.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      "router.push(automaticAnalysisRefreshUrl(projectId))",
    );
  });

  it("renders approved terminal failure copy from run.lastError without echoing its summary", () => {
    const source = readFileSync(
      new URL("./_product-profile.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      "synthesisFailureFeedback(run.status, run.lastError)",
    );
    expect(source).not.toContain("detail: run.lastError.summary");
    expect(source).not.toContain("title: run.lastError.summary");
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

describe("Product Profile synthesis failure copy", () => {
  it("treats provider configuration and authentication failures as operator action", () => {
    expect(
      productProfileSynthesisFailureKind({
        status: "failed",
        lastError: {
          code: "AUTH_FAILED",
          summary: "Provider rejected a secret credential.",
        },
      }),
    ).toBe("configuration");
    expect(
      productProfileSynthesisFailureKind({
        status: "failed",
        lastError: {
          code:
            "PRODUCT_PROFILE_SYNTHESIS_INVOCATION_CONFIGURATION_MISMATCH",
          summary: "The configured deployment does not match the invocation.",
        },
      }),
    ).toBe("configuration");
  });

  it("classifies retry exhaustion and legacy timeout summaries as temporary provider failures", () => {
    expect(
      productProfileSynthesisFailureKind({
        status: "failed",
        lastError: {
          code: "QUEUE_RETRY_EXHAUSTED",
          summary: "Queue retries exhausted before the run completed.",
        },
      }),
    ).toBe("temporary_provider");
    expect(
      productProfileSynthesisFailureKind({
        status: "failed",
        lastError: {
          code: "LEGACY_PROVIDER_FAILURE",
          summary: "The provider timed out while serving the request.",
        },
      }),
    ).toBe("temporary_provider");
  });

  it("routes invalid synthesis input and Crawl evidence failures to customer remediation", () => {
    expect(
      productProfileSynthesisFailureKind({
        status: "failed",
        lastError: {
          code: "PRODUCT_PROFILE_SYNTHESIS_INPUT_INVALID",
          summary: "Required Product Profile evidence is incomplete.",
        },
      }),
    ).toBe("input_or_evidence");
    expect(
      productProfileSynthesisFailureKind({
        status: "failed",
        lastError: {
          code: "CRAWL_SNAPSHOT_REQUIRED",
          summary: "A current Crawl snapshot is required.",
        },
      }),
    ).toBe("input_or_evidence");
  });

  it("asks for operator review when the provider outcome cannot be safely replayed", () => {
    expect(
      productProfileSynthesisFailureKind({
        status: "failed",
        lastError: {
          code: "PRODUCT_PROFILE_SYNTHESIS_INVOCATION_OUTCOME_UNKNOWN",
          summary:
            "The provider invocation outcome could not be safely recovered.",
        },
      }),
    ).toBe("operator_review");
    expect(
      productProfileSynthesisFailureKind({
        status: "failed",
        lastError: {
          code: "SCHEMA_INVALID",
          summary: "The generated candidate did not match the output schema.",
        },
      }),
    ).toBe("operator_review");
  });

  it("separates superseded work from customer cancellation", () => {
    expect(
      productProfileSynthesisFailureKind({
        status: "cancelled",
        lastError: {
          code: "PRODUCT_PROFILE_SYNTHESIS_SUPERSEDED",
          summary: "A newer Product Profile generation replaced this run.",
        },
      }),
    ).toBe("superseded");
    expect(
      productProfileSynthesisFailureKind({
        status: "cancelled",
        lastError: {
          code: "QUEUE_JOB_CANCELLED",
          summary: "The queue job was cancelled.",
        },
      }),
    ).toBe("cancelled");
  });

  it("does not classify untrusted provider text without a stable error code", () => {
    expect(
      productProfileSynthesisFailureKind({
        status: "failed",
        lastError: {
          code: "LEGACY_PROVIDER_FAILURE",
          summary:
            "API key validation timed out; customer supplied content must not control recovery guidance.",
        },
      }),
    ).toBe("unknown");
  });

  it("returns only a safe category and never returns the raw provider summary", () => {
    const rawSummary =
      "Opaque private provider diagnostic from internal-node-01.";
    const result = productProfileSynthesisFailureKind({
      status: "failed",
      lastError: {
        code: "UNCLASSIFIED_PROVIDER_FAILURE",
        summary: rawSummary,
      },
    });

    expect(result).toBe("unknown");
    expect(result).not.toContain("private provider diagnostic");
    expect(result).not.toContain("internal-node-01");
  });
});
