// @input  -- signed-in and signed-out requests, a quota store that allows, limits, and fails
// @output -- proof the bound is per account and that a broken limiter refuses rather than spends
// @pos    -- server guard for the Agent's Search Console read

import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TARGET_QUERY_DEPENDENCIES,
  handleAgentTargetQueryRequest,
  targetQueryQuotaBucket,
  type AgentTargetQueryDependencies,
} from "./target-query-handler.ts";

function request(url = "https://www.acme.com/birth-chart"): Request {
  return new Request("https://gengrowth.ai/api/agents/target-query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

function deps(
  overrides: Partial<AgentTargetQueryDependencies> = {},
): AgentTargetQueryDependencies {
  return {
    ...DEFAULT_TARGET_QUERY_DEPENDENCIES,
    readUser: (async () => ({
      status: "authenticated" as const,
      userId: "user-1",
      email: null,
    })) as AgentTargetQueryDependencies["readUser"],
    consumeQuota: (async () => ({
      kind: "allowed" as const,
      hits: 1,
    })) as AgentTargetQueryDependencies["consumeQuota"],
    resolveGrant: (async () => ({
      kind: "none" as const,
    })) as AgentTargetQueryDependencies["resolveGrant"],
    now: () => 1_757_000_000_000,
    ...overrides,
  };
}

describe("the Agent target-query read", () => {
  it("bounds by account, not by the address the request came from", async () => {
    /*
      The public tools bound Search Console by IP because an anonymous caller
      in a loop spends quota counted per GCP project. Every caller here is
      signed in, and per-IP would make two people behind one office NAT share
      a single allowance -- one of them refused for the other's work.
    */
    const seen: string[] = [];
    await handleAgentTargetQueryRequest(
      request(),
      deps({
        consumeQuota: (async (bucket: string) => {
          seen.push(bucket);
          return { kind: "allowed" as const, hits: 1 };
        }) as AgentTargetQueryDependencies["consumeQuota"],
      }),
    );

    expect(seen).toEqual([targetQueryQuotaBucket("user-1")]);
    expect(seen[0]).toContain("user-1");
  });

  it("refuses rather than spends when the limiter cannot answer", async () => {
    // Fails closed like the sibling gate: the visitor turned away comes back,
    // while exhausted project quota takes Search Console down for every tool.
    const response = await handleAgentTargetQueryRequest(
      request(),
      deps({
        consumeQuota: (async () => ({
          kind: "unavailable" as const,
        })) as unknown as AgentTargetQueryDependencies["consumeQuota"],
        resolveGrant: (() => {
          throw new Error("must not reach the grant");
        }) as unknown as AgentTargetQueryDependencies["resolveGrant"],
      }),
    );

    expect(response.status).toBe(503);
  });

  it("says how long to wait instead of failing anonymously", async () => {
    const response = await handleAgentTargetQueryRequest(
      request(),
      deps({
        consumeQuota: (async () => ({
          kind: "limited" as const,
          retryAfterSeconds: 900,
        })) as AgentTargetQueryDependencies["consumeQuota"],
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("900");
  });

  it("spends no quota on a request that was never signed in", async () => {
    const consumeQuota = vi.fn();
    const response = await handleAgentTargetQueryRequest(
      request(),
      deps({
        readUser: (async () => ({
          status: "unauthenticated" as const,
        })) as AgentTargetQueryDependencies["readUser"],
        consumeQuota:
          consumeQuota as unknown as AgentTargetQueryDependencies["consumeQuota"],
      }),
    );

    expect(response.status).toBe(401);
    expect(consumeQuota).not.toHaveBeenCalled();
  });

  it("reports a missing grant as an answer, not as an error", async () => {
    // The panel routes an unconnected visitor to the consent screen. A 4xx
    // here would render as "something went wrong" for a state that is simply
    // "not connected yet".
    const response = await handleAgentTargetQueryRequest(request(), deps());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { kind: "no_grant" } });
  });

  it("separates a grant that cannot be refreshed from one that is absent", async () => {
    const response = await handleAgentTargetQueryRequest(
      request(),
      deps({
        resolveGrant: (async () => ({
          kind: "unavailable" as const,
        })) as AgentTargetQueryDependencies["resolveGrant"],
      }),
    );

    expect(await response.json()).toEqual({ data: { kind: "unavailable" } });
  });

  it("rejects a URL the audit could never have inspected", async () => {
    const response = await handleAgentTargetQueryRequest(
      request("not a url"),
      deps(),
    );

    expect(response.status).toBe(400);
  });
});
