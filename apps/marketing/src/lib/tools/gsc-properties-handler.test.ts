import { describe, expect, it, vi } from "vitest";
import { brandTermCandidates, createPublicToolError } from "@sf/public-tools";
import type { GrantResolution } from "../auth/grant-cookie.ts";
import { acquireGscSlot } from "./gsc-inflight.ts";
import { gscIpBucket } from "./gsc-gate.ts";
import {
  GSC_PROPERTIES_IP_MAX,
  GSC_PROPERTIES_IP_WINDOW_SECONDS,
  handleGscPropertiesRequest,
  type GscPropertiesHandlerDependencies,
} from "./gsc-properties-handler.ts";

const IP = "192.0.2.43";
const PROPERTY = "sc-domain:new-site.example";
const TOKEN = "test-access-token-private";

function post(origin: string | null = "https://gengrowth.ai") {
  return new Request("https://gengrowth.ai/api/tools/gsc-properties", {
    method: "POST",
    headers: origin === null ? {} : { Origin: origin },
  });
}

function dependencies(overrides: Partial<GscPropertiesHandlerDependencies> = {}) {
  const release = vi.fn();
  const acquireSlot = vi.fn(() => ({ acquired: true as const, release }));
  const callQuota = vi.fn(async () => ({
    allowed: true,
    hits: 1,
    reset_at: "2026-08-31T15:00:00.000Z",
  }));
  const readIdentity = vi.fn(async () => "google-sub-1");
  const refreshProperties = vi.fn(async (): Promise<GrantResolution> => ({
    kind: "grant",
    accessToken: TOKEN,
    properties: [PROPERTY],
    propertyTotal: 1,
  }));
  const deps: GscPropertiesHandlerDependencies = {
    readIdentity,
    connectEnabled: () => true,
    refreshProperties,
    extractClientIp: () => IP,
    acquireSlot,
    quota: { callQuota },
    ...overrides,
  };
  return { deps, readIdentity, refreshProperties, acquireSlot, callQuota, release };
}

describe("Search Console property refresh request", () => {
  it("returns newly listed properties and candidate terms, without serializing the token", async () => {
    const { deps, callQuota, release } = dependencies();
    const response = await handleGscPropertiesRequest(post(), deps);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({
      data: {
        properties: [PROPERTY],
        propertyTotal: 1,
        brandCandidates: { [PROPERTY]: brandTermCandidates(PROPERTY) },
      },
    });
    expect(body).not.toContain(TOKEN);
    expect(body).not.toContain("accessToken");
    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
    expect(callQuota).toHaveBeenCalledExactlyOnceWith(
      `gsc-properties:ip:${IP}`,
      GSC_PROPERTIES_IP_MAX,
      GSC_PROPERTIES_IP_WINDOW_SECONDS,
    );
    expect(callQuota).not.toHaveBeenCalledWith(
      gscIpBucket(IP), expect.anything(), expect.anything(),
    );
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("keeps an empty successful list distinct from an unavailable list", async () => {
    const { deps } = dependencies({
      refreshProperties: async () => ({
        kind: "grant", accessToken: TOKEN, properties: [], propertyTotal: 0,
      }),
    });
    const response = await handleGscPropertiesRequest(post(), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { properties: [], propertyTotal: 0, brandCandidates: {} },
    });
  });

  it("carries a truncated list's real total without inventing candidates for absent properties", async () => {
    const { deps } = dependencies({
      refreshProperties: async () => ({
        kind: "grant", accessToken: TOKEN, properties: [PROPERTY], propertyTotal: 100,
      }),
    });
    const response = await handleGscPropertiesRequest(post(), deps);
    expect(await response.json()).toEqual({
      data: {
        properties: [PROPERTY],
        propertyTotal: 100,
        brandCandidates: { [PROPERTY]: brandTermCandidates(PROPERTY) },
      },
    });
  });

  it.each([null, "https://attacker.example", "not an origin"])(
    "refuses origin %p before authentication or provider work",
    async (origin) => {
      const { deps, readIdentity, acquireSlot, callQuota, refreshProperties } = dependencies();
      const response = await handleGscPropertiesRequest(post(origin), deps);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual(createPublicToolError("invalid_request"));
      expect(readIdentity).not.toHaveBeenCalled();
      expect(acquireSlot).not.toHaveBeenCalled();
      expect(callQuota).not.toHaveBeenCalled();
      expect(refreshProperties).not.toHaveBeenCalled();
    },
  );

  it.each([
    { readIdentity: async () => null },
    { connectEnabled: () => false },
  ])(
    "refuses absent identity or disabled connection before spending quota",
    async (overrides) => {
      const { deps, acquireSlot, callQuota, refreshProperties } = dependencies(overrides);
      const response = await handleGscPropertiesRequest(post(), deps);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual(createPublicToolError("gsc_revoked"));
      expect(acquireSlot).not.toHaveBeenCalled();
      expect(callQuota).not.toHaveBeenCalled();
      expect(refreshProperties).not.toHaveBeenCalled();
    },
  );

  it("shares the in-flight slot with the report tools before spending its own quota", async () => {
    const active = acquireGscSlot(IP);
    if (!active.acquired) throw new Error("test slot unexpectedly held");
    try {
      const { deps, callQuota, refreshProperties } = dependencies({
        acquireSlot: acquireGscSlot,
      });
      const response = await handleGscPropertiesRequest(post(), deps);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual(createPublicToolError("scan_in_progress"));
      expect(callQuota).not.toHaveBeenCalled();
      expect(refreshProperties).not.toHaveBeenCalled();
    } finally {
      active.release();
    }
  });

  it.each([
    ["limited", 429, "rate_limited"],
    ["unavailable", 503, "quota_unavailable"],
  ] as const)(
    "fails closed when the durable quota is %s and releases the slot",
    async (outcome, status, code) => {
      const { deps, refreshProperties, release } = dependencies({
        quota: {
          callQuota: async () => {
            if (outcome === "unavailable") {
              throw new Error("private infrastructure failure");
            }
            return {
              allowed: false,
              hits: 31,
              reset_at: new Date(Date.now() + 60_000).toISOString(),
            };
          },
        },
      });
      const response = await handleGscPropertiesRequest(post(), deps);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual(createPublicToolError(code));
      expect(response.headers.get("Retry-After")).not.toBeNull();
      expect(refreshProperties).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["none", 401, "gsc_revoked"],
    ["revoked", 401, "gsc_revoked"],
    ["unavailable", 503, "gsc_temporarily_unavailable"],
  ] as const)(
    "maps %s to a stable refusal and releases the slot",
    async (kind, status, code) => {
      const { deps, release } = dependencies({
        refreshProperties: async () => ({ kind }),
      });
      const response = await handleGscPropertiesRequest(post(), deps);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual(createPublicToolError(code));
      expect(response.headers.get("Cache-Control")).toBe("no-store, private");
      expect(release).toHaveBeenCalledTimes(1);
    },
  );

  it("conceals unexpected upstream errors and releases the slot", async () => {
    const { deps, release } = dependencies({
      refreshProperties: async () => { throw new Error(TOKEN); },
    });
    const response = await handleGscPropertiesRequest(post(), deps);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(
      createPublicToolError("gsc_temporarily_unavailable"),
    );
    expect(release).toHaveBeenCalledTimes(1);
  });
});
