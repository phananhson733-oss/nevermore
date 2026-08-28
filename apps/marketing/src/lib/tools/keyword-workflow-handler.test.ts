import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPublicToolError, type KeywordOpportunityResult } from "@sf/public-tools";
import { seal } from "../auth/sealed-cookie.ts";
import type { KeywordContextToken } from "./keyword-opportunity-handler.ts";
import {
  handleKeywordWorkflowStartRequest,
  handleKeywordWorkflowStatusRequest,
  type KeywordWorkflowRunRead,
  type KeywordWorkflowStartDependencies,
  type KeywordWorkflowStatusDependencies,
} from "./keyword-workflow-handler.ts";
import {
  openKeywordWorkflowRun,
  openKeywordWorkflowSnapshots,
} from "./keyword-workflow-contract.ts";

const SECRET = Buffer.alloc(32, 31).toString("base64");
const NOW = Date.parse("2026-08-28T00:00:00.000Z");
const REQUEST_ID = "2f7b5985-75b9-44c0-9b53-2b54b7901f2f";
const TOKEN: KeywordContextToken = {
  siteUrl: "https://example.com/",
  marketCode: "US",
  languageCode: "en",
  propositions: [
    {
      statement: "Automate clinic appointments",
      sourceUrl: "https://example.com/product",
    },
  ],
  pages: [
    {
      url: "https://example.com/product",
      title: "Practice operations platform",
      headings: ["Automate patient intake"],
    },
  ],
  pagesFetched: 1,
  productPagesFetched: 1,
  stopReason: "completed",
  seeds: [],
  sub: "owner-a",
};

function request(
  body: unknown,
  path = "/api/tools/hidden-keywords/opportunities",
  origin = "https://gengrowth.ai",
): Request {
  return new Request(`https://gengrowth.ai${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

function contextToken(token: KeywordContextToken = TOKEN): string {
  return seal("gg_kw_context", token, 600, () => NOW);
}

function startDependencies(
  overrides: Partial<KeywordWorkflowStartDependencies> = {},
): KeywordWorkflowStartDependencies & {
  readonly release: ReturnType<typeof vi.fn>;
  readonly startWorkflow: ReturnType<typeof vi.fn>;
} {
  const release = vi.fn();
  const startWorkflow = vi.fn(async () => ({ runId: "wrun_owner" }));
  const selectedStart = (overrides.startWorkflow ?? startWorkflow) as
    KeywordWorkflowStartDependencies["startWorkflow"] &
      ReturnType<typeof vi.fn>;
  return {
    readIdentity: async () => ({ sub: "owner-a" }),
    openGscGate: async () => ({ ok: true, release }),
    resolveGrant: async () => ({
      kind: "grant",
      accessToken: "access-secret",
      properties: ["sc-domain:example.com"],
      propertyTotal: 1,
    }),
    extractClientIp: () => "203.0.113.10",
    now: () => NOW,
    ...overrides,
    release,
    startWorkflow: selectedStart,
  };
}

function statusDependencies(
  read: KeywordWorkflowRunRead,
  sub = "owner-a",
): KeywordWorkflowStatusDependencies {
  return {
    readIdentity: async () => ({ sub }),
    readRun: async () => read,
    now: () => NOW,
  };
}

beforeEach(() => {
  process.env.MARKETING_COOKIE_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.MARKETING_COOKIE_SECRET;
  vi.restoreAllMocks();
});

describe("handleKeywordWorkflowStartRequest", () => {
  it("validates ownership and grant before starting with encrypted snapshots only", async () => {
    const events: string[] = [];
    const dependencies = startDependencies({
      readIdentity: async () => {
        events.push("identity");
        return { sub: "owner-a" };
      },
      openGscGate: async () => {
        events.push("gate");
        return { ok: true, release: vi.fn(() => events.push("release")) };
      },
      resolveGrant: async () => {
        events.push("grant");
        return {
          kind: "grant",
          accessToken: "access-secret",
          properties: ["sc-domain:example.com"],
          propertyTotal: 1,
        };
      },
      startWorkflow: vi.fn(async () => {
        events.push("start");
        return { runId: "wrun_owner" };
      }),
    });

    const response = await handleKeywordWorkflowStartRequest(
      request({ contextToken: contextToken(), requestId: REQUEST_ID }),
      dependencies,
    );
    const body = (await response.json()) as {
      data: { status: string; runToken: string };
    };

    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
    expect(response.headers.get("Retry-After")).toBe("2");
    expect(body.data.status).toBe("running");
    expect(openKeywordWorkflowRun(body.data.runToken, "owner-a", () => NOW)).toEqual(
      { runId: "wrun_owner" },
    );
    expect(events).toEqual(["identity", "gate", "grant", "start", "release"]);

    const workflowInput = dependencies.startWorkflow.mock.calls[0]?.[0];
    expect(workflowInput).toEqual({
      inputToken: expect.any(String),
      grantToken: expect.any(String),
      dedupeKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(workflowInput)).not.toContain("owner-a");
    expect(JSON.stringify(workflowInput)).not.toContain("access-secret");
    expect(
      openKeywordWorkflowSnapshots<KeywordContextToken>(
        workflowInput?.inputToken ?? "",
        workflowInput?.grantToken ?? "",
        () => NOW,
      ),
    ).toEqual({
      sub: "owner-a",
      input: TOKEN,
      grant: {
        accessToken: "access-secret",
        properties: ["sc-domain:example.com"],
      },
    });
  });

  it("refuses cross-origin, signed-out, malformed, and foreign-token requests before start", async () => {
    const scenarios: readonly [Request, Partial<KeywordWorkflowStartDependencies>][] = [
      [
        request(
          { contextToken: contextToken(), requestId: REQUEST_ID },
          undefined,
          "https://attacker.example",
        ),
        {},
      ],
      [
        request({ contextToken: contextToken(), requestId: REQUEST_ID }),
        { readIdentity: async () => null },
      ],
      [request({ contextToken: "bad", requestId: "bad" }), {}],
      [
        request({
          contextToken: contextToken({ ...TOKEN, sub: "owner-b" }),
          requestId: REQUEST_ID,
        }),
        {},
      ],
    ];

    for (const [input, overrides] of scenarios) {
      const dependencies = startDependencies(overrides);
      const response = await handleKeywordWorkflowStartRequest(
        input,
        dependencies,
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(dependencies.startWorkflow).not.toHaveBeenCalled();
    }
  });

  it("releases the GSC slot on grant refusal and enqueue failure", async () => {
    const refused = startDependencies({
      resolveGrant: async () => ({ kind: "revoked" }),
    });
    const refusal = await handleKeywordWorkflowStartRequest(
      request({ contextToken: contextToken(), requestId: REQUEST_ID }),
      refused,
    );
    expect(refusal.status).toBe(401);
    expect(refused.release).toHaveBeenCalledTimes(1);
    expect(refused.startWorkflow).not.toHaveBeenCalled();

    const failed = startDependencies({
      startWorkflow: vi.fn(async () => {
        throw new Error("Vercel World unavailable: sensitive-internal-detail");
      }),
    });
    const failure = await handleKeywordWorkflowStartRequest(
      request({ contextToken: contextToken(), requestId: REQUEST_ID }),
      failed,
    );
    expect(failure.status).toBe(503);
    expect(failed.release).toHaveBeenCalledTimes(1);
    expect(await failure.json()).toEqual(
      createPublicToolError("keyword_run_unavailable"),
    );
  });
});

describe("handleKeywordWorkflowStatusRequest", () => {
  it("returns private queued/running states without exposing a raw run id", async () => {
    const token = seal("gg_kw_workflow_run", {
      version: "keyword_workflow.v1",
      runId: "wrun_owner",
      sub: "owner-a",
    }, 86_400, () => NOW);

    for (const state of ["queued", "running"] as const) {
      const response = await handleKeywordWorkflowStatusRequest(
        request({ runToken: token }, "/api/tools/hidden-keywords/opportunities/status"),
        statusDependencies({ kind: state }),
      );
      const body = (await response.json()) as {
        data: { status: string; runToken: string };
      };
      const serialized = JSON.stringify(body);
      expect(response.status).toBe(200);
      expect(response.headers.get("Retry-After")).toBe("2");
      expect(body.data.status).toBe(state);
      expect(serialized).not.toContain("wrun_owner");
    }
  });

  it("returns only the public result for completed runs", async () => {
    const token = seal("gg_kw_workflow_run", {
      version: "keyword_workflow.v1",
      runId: "wrun_owner",
      sub: "owner-a",
    }, 86_400, () => NOW);
    const result = { availability: "available" } as unknown as KeywordOpportunityResult;
    const response = await handleKeywordWorkflowStatusRequest(
      request({ runToken: token }, "/api/tools/hidden-keywords/opportunities/status"),
      statusDependencies({ kind: "completed", result }),
    );

    expect(await response.json()).toEqual({
      data: { status: "completed", result },
    });
  });

  it("seals a duplicate owner redirect instead of exposing the owner run id", async () => {
    const token = seal("gg_kw_workflow_run", {
      version: "keyword_workflow.v1",
      runId: "wrun_duplicate",
      sub: "owner-a",
    }, 86_400, () => NOW);
    const response = await handleKeywordWorkflowStatusRequest(
      request({ runToken: token }, "/api/tools/hidden-keywords/opportunities/status"),
      statusDependencies({ kind: "redirect", ownerRunId: "wrun_owner" }),
    );
    const body = (await response.json()) as {
      data: { status: string; runToken: string };
    };

    expect(body.data.status).toBe("redirect");
    expect(JSON.stringify(body)).not.toContain("wrun_owner");
    expect(openKeywordWorkflowRun(body.data.runToken, "owner-a", () => NOW)).toEqual(
      { runId: "wrun_owner" },
    );
  });

  it("makes absent, tampered, expired, and foreign run tokens indistinguishable", async () => {
    const ownerToken = seal("gg_kw_workflow_run", {
      version: "keyword_workflow.v1",
      runId: "wrun_owner",
      sub: "owner-a",
    }, 86_400, () => NOW);
    const expired = seal("gg_kw_workflow_run", {
      version: "keyword_workflow.v1",
      runId: "wrun_expired",
      sub: "owner-a",
    }, 1, () => NOW - 2_000);
    const cases = [
      { token: ownerToken, deps: statusDependencies({ kind: "missing" }) },
      { token: "tampered", deps: statusDependencies({ kind: "running" }) },
      { token: expired, deps: statusDependencies({ kind: "running" }) },
      { token: ownerToken, deps: statusDependencies({ kind: "running" }, "owner-b") },
    ];

    const responses = [];
    for (const entry of cases) {
      const response = await handleKeywordWorkflowStatusRequest(
        request(
          { runToken: entry.token },
          "/api/tools/hidden-keywords/opportunities/status",
        ),
        entry.deps,
      );
      responses.push({ status: response.status, body: await response.json() });
    }

    expect(responses).toEqual(
      new Array(cases.length).fill({
        status: 404,
        body: createPublicToolError("keyword_run_unavailable"),
      }),
    );
  });

  it("maps typed failure, SDK failure, and cancellation without raw errors", async () => {
    const token = seal("gg_kw_workflow_run", {
      version: "keyword_workflow.v1",
      runId: "wrun_owner",
      sub: "owner-a",
    }, 86_400, () => NOW);
    const cases: readonly [KeywordWorkflowRunRead, number, string][] = [
      [
        { kind: "typed_failure", code: "keyword_generation_unavailable" },
        502,
        "keyword_generation_unavailable",
      ],
      [{ kind: "failed" }, 502, "keyword_run_unavailable"],
      [{ kind: "cancelled" }, 409, "keyword_run_cancelled"],
      [{ kind: "unavailable" }, 503, "keyword_run_unavailable"],
    ];

    for (const [read, status, code] of cases) {
      const response = await handleKeywordWorkflowStatusRequest(
        request({ runToken: token }, "/api/tools/hidden-keywords/opportunities/status"),
        statusDependencies(read),
      );
      expect(response.status).toBe(status);
      expect(JSON.stringify(await response.json())).toBe(
        JSON.stringify({ error: { code } }),
      );
    }
  });
});
