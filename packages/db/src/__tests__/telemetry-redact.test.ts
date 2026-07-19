import { describe, expect, it } from "vitest";

import type { Executor } from "../repositories/base.ts";
import {
  TelemetryRepository,
  type TelemetryEventName,
} from "../repositories/telemetry.ts";

/**
 * Spec §15.1 / AC-040: telemetry is a deliberately tiny product signal, not
 * an audit or content sink. These capture-fake tests exercise the last boundary
 * before a properties object reaches Postgres.
 */

// Obviously-fake credential values (secrets:scan must never flag these).
const FAKE = "Bearer FAKE-not-a-real-token";
const FAKE_NESTED = "FAKE-nested-not-a-real-token";

function captureExecutor(): {
  exec: Executor;
  rows: ReadonlyArray<Record<string, unknown>>;
} {
  const rows: Array<Record<string, unknown>> = [];
  const exec = {
    insert: () => ({
      values: (row: Record<string, unknown>): Promise<void> => {
        rows.push(row);
        return Promise.resolve();
      },
    }),
  } as unknown as Executor;
  return { exec, rows };
}

async function emitAndCapture(
  eventName: TelemetryEventName,
  properties: unknown,
): Promise<Record<string, unknown>> {
  const { exec, rows } = captureExecutor();
  await new TelemetryRepository(exec).emit({
    workspaceId: "ws-1",
    projectId: "pr-1",
    eventName,
    actorId: "op-1",
    properties: properties as Record<string, unknown>,
  });
  expect(rows).toHaveLength(1);
  return (rows[0] as { properties: Record<string, unknown> }).properties;
}

describe("TelemetryRepository.emit property contract", () => {
  it.each<{
    eventName: TelemetryEventName;
    properties: Record<string, unknown>;
    expected: Record<string, unknown>;
  }>([
    {
      eventName: "project_created",
      properties: {
        profileType: "b2b_saas",
        marketCount: 2,
        languageCount: 1,
        clientName: "Sensitive client name",
        query: "customer search query",
      },
      expected: {
        profileType: "b2b_saas",
        marketCount: 2,
        languageCount: 1,
      },
    },
    {
      eventName: "source_snapshot_ready",
      properties: {
        provider: "gsc",
        availability: "partial",
        rowCount: 25_000,
        durationBucket: "under_30s",
        fullUrl: "https://client.example/private?q=sensitive",
        rawPayload: { query: "customer search query" },
      },
      expected: {
        provider: "gsc",
        availability: "partial",
        rowCount: 25_000,
        durationBucket: "under_30s",
      },
    },
    {
      eventName: "diagnostic_completed",
      properties: {
        status: "completed",
        domainCoverage: "available",
        findingCount: 7,
        durationBucket: "under_10m",
        prompt: "customer prompt",
        output: "model output",
      },
      expected: {
        status: "completed",
        domainCoverage: "available",
        findingCount: 7,
        durationBucket: "under_10m",
      },
    },
    {
      eventName: "action_confirmed",
      properties: {
        ruleId: "TECH-HTTP-001",
        priorityBand: "high",
        roadmapLane: "now",
        findingTitle: "Customer finding title",
        evidence: ["private evidence"],
      },
      expected: {
        ruleId: "TECH-HTTP-001",
        priorityBand: "high",
        roadmapLane: "now",
      },
    },
    {
      eventName: "export_ready",
      properties: {
        kind: "client_bundle",
        itemCounts: { findings: 3, actions: 2 },
        sizeBucket: "under_1mb",
        clientName: "Sensitive client name",
        manifest: { projectName: "Sensitive project" },
      },
      expected: {
        kind: "client_bundle",
        itemCounts: { findings: 3, actions: 2 },
        sizeBucket: "under_1mb",
      },
    },
  ])("keeps only the exact $eventName allowlist", async ({ eventName, properties, expected }) => {
    await expect(emitAndCapture(eventName, properties)).resolves.toEqual(expected);
  });

  it("keeps project profileType optional", async () => {
    await expect(
      emitAndCapture("project_created", {
        marketCount: 1,
        languageCount: 2,
      }),
    ).resolves.toEqual({ marketCount: 1, languageCount: 2 });
  });

  it.each([null, [], "customer content"])(
    "treats a non-object properties payload as empty",
    async (properties) => {
      await expect(
        emitAndCapture("project_created", properties),
      ).resolves.toEqual({});
    },
  );

  it.each<{
    eventName: TelemetryEventName;
    properties: Record<string, unknown>;
    expected: Record<string, unknown>;
  }>([
    {
      eventName: "project_created",
      properties: {
        profileType: "customer-specific-profile",
        marketCount: -1,
        languageCount: Number.POSITIVE_INFINITY,
      },
      expected: {},
    },
    {
      eventName: "source_snapshot_ready",
      properties: {
        provider: "customer-provider",
        availability: "mostly-available",
        rowCount: 1.5,
        durationBucket: "customer-specific-duration",
      },
      expected: {},
    },
    {
      eventName: "diagnostic_completed",
      properties: {
        status: "customer-status",
        domainCoverage: {
          customerDomain: "customer coverage details",
        },
        findingCount: Number.MAX_SAFE_INTEGER + 1,
        durationBucket: "under_1s",
      },
      expected: {},
    },
    {
      eventName: "action_confirmed",
      properties: {
        ruleId: "CUSTOMER-RULE-999",
        priorityBand: "urgent-for-client",
        roadmapLane: "customer-roadmap",
      },
      expected: {},
    },
    {
      eventName: "export_ready",
      properties: {
        kind: "customer-export",
        itemCounts: null,
        sizeBucket: "customer-size",
      },
      expected: {},
    },
  ])("drops out-of-domain $eventName values", async ({ eventName, properties, expected }) => {
    await expect(emitAndCapture(eventName, properties)).resolves.toEqual(expected);
  });

  it("limits itemCounts to manifest keys with non-negative safe integers", async () => {
    const properties = await emitAndCapture("export_ready", {
      kind: "service_bundle",
      itemCounts: {
        projects: 1,
        contexts: 1,
        sources: 3,
        snapshots: 2,
        observations: 0,
        findings: 4,
        evidence: 9,
        actions: 2,
        artifacts: 1,
        artifactRevisions: 3,
        customerSlug: 99,
        clientNames: ["private"],
        negative: -1,
      },
      sizeBucket: "over_10mb",
    });

    expect(properties).toEqual({
      kind: "service_bundle",
      itemCounts: {
        projects: 1,
        contexts: 1,
        sources: 3,
        snapshots: 2,
        observations: 0,
        findings: 4,
        evidence: 9,
        actions: 2,
        artifacts: 1,
        artifactRevisions: 3,
      },
      sizeBucket: "over_10mb",
    });
  });

  it("drops invalid values from otherwise valid itemCounts", async () => {
    const properties = await emitAndCapture("export_ready", {
      itemCounts: {
        findings: 2,
        projects: -1,
        contexts: 1.5,
        sources: Number.NaN,
        snapshots: Number.POSITIVE_INFINITY,
        observations: Number.MAX_SAFE_INTEGER + 1,
        actions: "3",
        artifacts: null,
      },
    });

    expect(properties).toEqual({ itemCounts: { findings: 2 } });
    expect(Number.isFinite(JSON.stringify(properties).length)).toBe(true);
  });

  it("drops secret-named and arbitrary nested properties before insert", async () => {
    const properties = await emitAndCapture("export_ready", {
      kind: "service_bundle",
      authorization: FAKE,
      nested: { api_key: FAKE_NESTED },
      message: `${FAKE} ${FAKE_NESTED}`,
    });

    expect(properties).toEqual({ kind: "service_bundle" });
    const serialized = JSON.stringify(properties);
    expect(serialized).not.toContain(FAKE);
    expect(serialized).not.toContain(FAKE_NESTED);
  });

  it("scrubs credential-shaped values even when callers use a benign extra key", async () => {
    const oauthToken = `ya29.${"O".repeat(40)}`;
    const apiKey = `sk-${"A".repeat(32)}`;
    const cookie = `Cookie: sf_session=${"C".repeat(32)}`;
    const ciphertext = `encrypted_payload=${Buffer.from(
      "telemetry-ciphertext-fixture",
    ).toString("base64")}`;

    const properties = await emitAndCapture("export_ready", {
      kind: "client_bundle",
      message: `${oauthToken} ${apiKey} ${cookie} ${ciphertext}`,
    });

    const serialized = JSON.stringify(properties);
    for (const secret of [oauthToken, apiKey, cookie, ciphertext]) {
      expect(serialized).not.toContain(secret);
    }
    expect(properties).toEqual({ kind: "client_bundle" });
  });
});
