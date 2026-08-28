import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  KEYWORD_WORKFLOW_VERSION,
  isSameOriginKeywordWorkflowRequest,
  keywordWorkflowDedupeKey,
  keywordWorkflowJson,
  openKeywordWorkflowGrant,
  openKeywordWorkflowInput,
  openKeywordWorkflowRun,
  parseKeywordWorkflowStartInput,
  parseKeywordWorkflowStatusInput,
  sealKeywordWorkflowGrant,
  sealKeywordWorkflowInput,
  sealKeywordWorkflowRun,
  type KeywordWorkflowStartResponse,
} from "./keyword-workflow-contract.ts";

const SECRET = Buffer.alloc(32, 17).toString("base64");
const NOW = 1_787_900_000_000;
const REQUEST_ID = "2f7b5985-75b9-44c0-9b53-2b54b7901f2f";

describe("keyword Workflow public contract", () => {
  beforeEach(() => {
    process.env.MARKETING_COOKIE_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.MARKETING_COOKIE_SECRET;
  });

  it("accepts only the exact versioned start and status request shapes", () => {
    expect(
      parseKeywordWorkflowStartInput({
        contextToken: "sealed-context",
        requestId: REQUEST_ID,
      }),
    ).toEqual({ contextToken: "sealed-context", requestId: REQUEST_ID });
    expect(
      parseKeywordWorkflowStartInput({
        contextToken: "sealed-context",
        requestId: REQUEST_ID,
        runId: "must-not-be-client-controlled",
      }),
    ).toBeNull();
    expect(
      parseKeywordWorkflowStartInput({
        contextToken: "",
        requestId: "not-a-uuid",
      }),
    ).toBeNull();

    expect(parseKeywordWorkflowStatusInput({ runToken: "sealed-run" })).toEqual(
      { runToken: "sealed-run" },
    );
    expect(
      parseKeywordWorkflowStatusInput({
        runToken: "sealed-run",
        runId: "raw-run-id",
      }),
    ).toBeNull();
  });

  it("rejects cross-origin browser mutations while admitting same-origin and originless server calls", () => {
    expect(
      isSameOriginKeywordWorkflowRequest(
        new Request("https://gengrowth.ai/api/tools/hidden-keywords/opportunities", {
          method: "POST",
          headers: { Origin: "https://gengrowth.ai" },
        }),
      ),
    ).toBe(true);
    expect(
      isSameOriginKeywordWorkflowRequest(
        new Request("https://gengrowth.ai/api/tools/hidden-keywords/opportunities", {
          method: "POST",
          headers: { Origin: "https://attacker.example" },
        }),
      ),
    ).toBe(false);
    expect(
      isSameOriginKeywordWorkflowRequest(
        new Request("https://gengrowth.ai/api/tools/hidden-keywords/opportunities", {
          method: "POST",
        }),
      ),
    ).toBe(true);
  });

  it("seals Workflow input, grant, and caller ownership under separate purposes", () => {
    const input = sealKeywordWorkflowInput(
      { siteUrl: "https://example.com", sub: "owner-a" },
      () => NOW,
    );
    const grant = sealKeywordWorkflowGrant(
      { accessToken: "access-secret", properties: ["sc-domain:example.com"] },
      () => NOW,
    );
    const run = sealKeywordWorkflowRun(
      { runId: "run_123", sub: "owner-a" },
      () => NOW,
    );

    expect(openKeywordWorkflowInput(input, () => NOW)).toEqual({
      siteUrl: "https://example.com",
      sub: "owner-a",
    });
    expect(openKeywordWorkflowGrant(grant, () => NOW)).toEqual({
      accessToken: "access-secret",
      properties: ["sc-domain:example.com"],
    });
    expect(openKeywordWorkflowRun(run, "owner-a", () => NOW)).toEqual({
      runId: "run_123",
    });
    expect(openKeywordWorkflowRun(run, "owner-b", () => NOW)).toBeNull();
    expect(openKeywordWorkflowRun(input, "owner-a", () => NOW)).toBeNull();
    expect(run).not.toContain("run_123");
    expect(grant).not.toContain("access-secret");
  });

  it("fails closed on token expiry and malformed versioned payloads", () => {
    const run = sealKeywordWorkflowRun(
      { runId: "run_123", sub: "owner-a" },
      () => NOW,
    );
    expect(
      openKeywordWorkflowRun(run, "owner-a", () => NOW + 24 * 60 * 60 * 1000 + 1),
    ).toBeNull();
    expect(openKeywordWorkflowRun("malformed", "owner-a", () => NOW)).toBeNull();
  });

  it("derives a deterministic caller-scoped duplicate key without exposing the subject", () => {
    const first = keywordWorkflowDedupeKey("owner-a", REQUEST_ID);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(keywordWorkflowDedupeKey("owner-a", REQUEST_ID));
    expect(first).not.toBe(keywordWorkflowDedupeKey("owner-b", REQUEST_ID));
    expect(first).not.toContain("owner-a");
  });

  it("returns private no-store responses and never requires a raw run id", async () => {
    const body: KeywordWorkflowStartResponse = {
      data: {
        status: "running",
        runToken: "sealed-run-token",
      },
    };
    const response = keywordWorkflowJson(body, 202, 2);

    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
    expect(response.headers.get("Retry-After")).toBe("2");
    await expect(response.json()).resolves.toEqual(body);
    expect(KEYWORD_WORKFLOW_VERSION).toBe("keyword_workflow.v1");
  });
});
