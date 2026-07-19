import { describe, expect, it } from "vitest";
import { normalizeBasePath, withBasePath, BASE_PATH } from "./base-path.ts";

/**
 * The deployment base path must normalize any spelling to a clean "" or "/app"
 * form so hand-built URLs (OAuth redirect, async status, fetch base, Location)
 * never double-slash or drop the prefix. Unset must be "" so local dev/tests and
 * the current OAuth redirect URI are unchanged.
 */
describe("normalizeBasePath", () => {
  it("returns '' for unset / root inputs", () => {
    expect(normalizeBasePath(undefined)).toBe("");
    expect(normalizeBasePath("")).toBe("");
    expect(normalizeBasePath("/")).toBe("");
    expect(normalizeBasePath("///")).toBe("");
  });

  it("normalizes any spelling of a sub-path to a single leading slash", () => {
    expect(normalizeBasePath("app")).toBe("/app");
    expect(normalizeBasePath("/app")).toBe("/app");
    expect(normalizeBasePath("/app/")).toBe("/app");
    expect(normalizeBasePath("app/portal")).toBe("/app/portal");
  });
});

describe("withBasePath (default env = root)", () => {
  it("is a no-op when NEXT_PUBLIC_BASE_PATH is unset (local/test)", () => {
    expect(BASE_PATH).toBe("");
    expect(withBasePath("/p/abc/sources")).toBe("/p/abc/sources");
    expect(withBasePath("/api/mvp/health/ready")).toBe(
      "/api/mvp/health/ready",
    );
  });
});
