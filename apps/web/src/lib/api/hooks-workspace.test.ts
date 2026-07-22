import { describe, expect, it } from "vitest";
import type { OverviewView } from "./types";
import { buildWorkspaceViewQueryOptions } from "./hooks";

const PROJECT_ID = "00000000-0000-4000-8000-000000000042";
const VIEW: OverviewView = {
  view: "overview",
  project: {
    id: PROJECT_ID,
    clientName: "Server client",
    projectName: "Server overview",
    stage: "planning",
    site: {
      id: "00000000-0000-4000-8000-000000000043",
      origin: "https://example.test",
      host: "example.test",
      marketCodes: ["US"],
      languageCodes: ["en"],
    },
    contextStatus: "complete",
    currentIcpProfileVersion: 2,
    defaultDeliveryLocale: "en",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    archivedAt: null,
  },
  coverage: { overall: "complete", domains: {}, limitations: [] },
  activeRuns: [],
  frozenDiagnosticRunId: null,
  topActions: [],
  latestSnapshot: null,
  topActionEvidence: [],
  deliveryFocus: null,
};

describe("Overview query SSR handoff", () => {
  it("uses the canonical server view without a redundant mount refetch", () => {
    const options = buildWorkspaceViewQueryOptions(
      PROJECT_ID,
      "overview",
      VIEW,
    );

    expect(options.queryKey).toEqual(["workspace", PROJECT_ID, "overview"]);
    expect(options.initialData).toBe(VIEW);
    expect(options.refetchOnMount).toBe(false);
  });

  it("keeps the browser-fetching fallback when no server view was supplied", () => {
    const options = buildWorkspaceViewQueryOptions(PROJECT_ID, "overview");

    expect(options).not.toHaveProperty("initialData");
    expect(options).not.toHaveProperty("refetchOnMount");
  });
});
