import { describe, expect, it } from "vitest";
import {
  buildProjectReportPath,
  exportPollInterval,
  isTerminalRun,
  normalizeOutputLocale,
  type ExportBundle,
  type ExportPollState,
  type RunStatus,
} from "./hooks-report";

describe("Report locale helpers", () => {
  it("keeps a valid BCP-47 output locale", () => {
    expect(normalizeOutputLocale("fr-FR")).toBe("fr-FR");
    expect(normalizeOutputLocale(" pt-BR ")).toBe("pt-BR");
    // RFC 5646 reserves 5-8 alpha primary-language subtags structurally.
    expect(normalizeOutputLocale("english")).toBe("english");
  });

  it("drops blank and invalid output locales", () => {
    expect(normalizeOutputLocale("")).toBeUndefined();
    expect(normalizeOutputLocale("  ")).toBeUndefined();
    expect(normalizeOutputLocale("en_US")).toBeUndefined();
  });

  it("builds the report path only for valid locales", () => {
    expect(buildProjectReportPath("project-1", "fr-FR")).toBe(
      "/projects/project-1/report?outputLocale=fr-FR",
    );
    expect(buildProjectReportPath("project-1", "  ")).toBe(
      "/projects/project-1/report",
    );
    expect(buildProjectReportPath("project-1", "en_US")).toBe(
      "/projects/project-1/report",
    );
  });
});

function bundle(status: RunStatus): ExportBundle {
  return {
    id: "00000000-0000-4000-8000-000000000902",
    kind: "client_bundle",
    schemaVersion: "signalframe.service-bundle.0.3.0",
    outputLocale: "en",
    run: {
      id: "00000000-0000-4000-8000-000000000901",
      projectId: "00000000-0000-4000-8000-000000000042",
      kind: "export",
      status,
      progress: { phase: "zip", current: 1, total: 2, messageKey: "run.zip" },
      lastError: null,
      resultRef: null,
      queuedAt: "2026-07-20T00:00:00.000Z",
      startedAt: null,
      completedAt: null,
    },
    checksum: null,
    itemCounts: {},
    downloadUrl: null,
    downloadExpiresAt: null,
    createdAt: "2026-07-20T00:00:00.000Z",
  };
}

function pollState(overrides: Partial<ExportPollState> = {}): ExportPollState {
  return {
    status: "success",
    data: bundle("running"),
    dataUpdateCount: 1,
    ...overrides,
  };
}

/**
 * The export poller decides one thing — "ask again, and when?" — mirroring the
 * diagnosis run poller (hooks-diagnosis-poll.test.ts): stopping early freezes
 * a live export on screen, never stopping is an unbounded 1s loop against an
 * endpoint that is already refusing us. The state is per queryKey (projectId +
 * exportId), so switching to another export restarts the schedule at its
 * first step by construction — the same `dataUpdateCount` indexing asserted
 * here applies to the fresh query.
 */
describe("export poll cadence", () => {
  it("escalates 1s -> 2s -> 4s -> 5s and then holds", () => {
    const waits = [0, 1, 2, 3, 4, 9, 40].map((dataUpdateCount) =>
      exportPollInterval(pollState({ dataUpdateCount })),
    );

    expect(waits).toStrictEqual([1000, 1000, 2000, 4000, 5000, 5000, 5000]);
  });

  it("stops polling when the status query itself is failing", () => {
    expect(
      exportPollInterval(pollState({ status: "error", dataUpdateCount: 0 })),
    ).toBe(false);
    expect(
      exportPollInterval(pollState({ status: "error", data: undefined })),
    ).toBe(false);
  });

  it("stops on every status the database will never let change again", () => {
    for (const status of [
      "completed",
      "partial",
      "failed",
      "cancelled",
    ] as const) {
      expect(isTerminalRun(status), status).toBe(true);
      expect(
        exportPollInterval(pollState({ data: bundle(status) })),
        status,
      ).toBe(false);
    }
    for (const status of ["queued", "running"] as const) {
      expect(isTerminalRun(status), status).toBe(false);
      expect(
        exportPollInterval(pollState({ data: bundle(status) })),
        status,
      ).toBeGreaterThan(0);
    }
  });

  it("schedules no repeat until a bundle has actually been read", () => {
    expect(
      exportPollInterval(
        pollState({ status: "pending", data: undefined, dataUpdateCount: 0 }),
      ),
    ).toBe(false);
    expect(exportPollInterval(pollState({ dataUpdateCount: 1 }))).toBe(1000);
  });
});
