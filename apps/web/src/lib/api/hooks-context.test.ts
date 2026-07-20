import { describe, expect, it } from "vitest";
import type { IcpProfile } from "./types";
import { buildProjectContextQueryOptions } from "./hooks";

const PROFILE: IcpProfile = {
  id: "00000000-0000-4000-8000-000000000501",
  projectId: "00000000-0000-4000-8000-000000000042",
  version: 3,
  status: "draft",
  profile: { productName: "Server-rendered product" },
  contentHash: "sha256:server-context",
  createdAt: "2026-07-20T00:00:00.000Z",
};

describe("Context query SSR handoff", () => {
  it("uses a canonical server profile without a redundant mount refetch", () => {
    const options = buildProjectContextQueryOptions(PROFILE.projectId, PROFILE);

    expect(options.queryKey).toEqual(["context", PROFILE.projectId]);
    expect(options.initialData).toBe(PROFILE);
    expect(options.refetchOnMount).toBe(false);
  });

  it("treats a server-confirmed missing profile as initial data", () => {
    const options = buildProjectContextQueryOptions(PROFILE.projectId, null);

    expect(options.initialData).toBeNull();
    expect(options.refetchOnMount).toBe(false);
  });

  it("keeps the browser-fetching fallback when no server value was supplied", () => {
    const options = buildProjectContextQueryOptions(PROFILE.projectId);

    expect(options).not.toHaveProperty("initialData");
    expect(options).not.toHaveProperty("refetchOnMount");
  });
});
