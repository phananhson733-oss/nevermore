import { describe, expect, it, vi } from "vitest";
import type { CollectionContext, NormalizeContext } from "../adapter.ts";
import { SourceError } from "../adapter.ts";
import { DATAFORSEO_ENABLED, dataforseoAdapter, disabledCapability } from "./adapter.ts";

const collectCtx: CollectionContext = {
  workspaceId: "w",
  projectId: "p",
  siteId: "s",
  runId: "r",
};

const normalizeCtx: NormalizeContext = {
  workspaceId: "w",
  projectId: "p",
  siteId: "s",
  capturedAt: "2026-07-18T00:00:00.000Z",
};

describe("dataforseo disabled adapter (spec §7.2, AC-020)", () => {
  it("keeps the feature flag off", () => {
    expect(DATAFORSEO_ENABLED).toBe(false);
  });

  it("identifies as the dataforseo provider", () => {
    expect(dataforseoAdapter.provider).toBe("dataforseo");
  });

  it("advertises an unavailable/disabled capability", () => {
    const cap = disabledCapability();
    expect(cap.available).toBe(false);
    expect(cap.limitation).toMatch(/disabled/i);
  });

  it("throws a stable FEATURE_DISABLED from every method and issues no network call", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const invocations: ReadonlyArray<() => unknown> = [
      () => dataforseoAdapter.validateConfig({}),
      () => dataforseoAdapter.capabilities(undefined as never),
      () => dataforseoAdapter.collect(undefined as never, collectCtx),
      () => dataforseoAdapter.normalize(undefined as never, normalizeCtx),
    ];

    for (const invoke of invocations) {
      let thrown: unknown;
      try {
        invoke();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(SourceError);
      expect((thrown as SourceError).code).toBe("FEATURE_DISABLED");
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
