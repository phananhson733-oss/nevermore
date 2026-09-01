import { describe, expect, it, vi } from "vitest";

vi.mock("./kb-v2-digest.ts", () => { throw new Error("Browser shape imported server digest"); });
vi.mock("./kb-profile-copy-server.ts", () => { throw new Error("Browser shape imported server Profile resolver"); });

describe("browser-safe complete context shape", () => {
  it("can load and reject malformed wire content without server-only hashing or stores", async () => {
    const module = await import("./snapshot-context-v2-shape.ts");
    expect(() => module.parseGeoSnapshotContextV2Shape({ schemaVersion: "marketing-geo-snapshot-context.v2" })).toThrow();
  });
});
