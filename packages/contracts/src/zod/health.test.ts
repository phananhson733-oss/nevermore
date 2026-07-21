import { describe, expect, it } from "vitest";

import {
  CONTRACT_VERSION,
  PRODUCT_VERSION,
  resolveBuildMetadata,
  versionResponse,
} from "./health.ts";

describe("build/version metadata", () => {
  it("pins the active product and runtime contract versions", () => {
    expect(PRODUCT_VERSION).toBe("0.3.0");
    expect(CONTRACT_VERSION).toBe("2026-07-21");
  });

  it("reports the immutable product and contract versions with the web platform SHA", () => {
    const metadata = resolveBuildMetadata("web", {
      APP_BUILD_SHA: "stale-fallback",
      VERCEL_GIT_COMMIT_SHA: "vercel-sha",
    });

    expect(metadata).toEqual({
      productVersion: PRODUCT_VERSION,
      contractVersion: CONTRACT_VERSION,
      service: "web",
      buildSha: "vercel-sha",
    });
    expect(versionResponse.parse(metadata)).toEqual(metadata);
  });

  it("uses platform commit metadata and an honest development sentinel", () => {
    expect(
      resolveBuildMetadata("worker", { RAILWAY_GIT_COMMIT_SHA: "railway-sha" }),
    ).toMatchObject({ service: "worker", buildSha: "railway-sha" });
    expect(
      resolveBuildMetadata("worker", { RENDER_GIT_COMMIT: "render-sha" }),
    ).toMatchObject({ service: "worker", buildSha: "render-sha" });
    expect(resolveBuildMetadata("web", {})).toMatchObject({
      service: "web",
      buildSha: "development",
    });
  });

  it("prefers immutable worker platform metadata over a stale portable fallback", () => {
    expect(
      resolveBuildMetadata("worker", {
        APP_BUILD_SHA: "stale-fallback",
        RAILWAY_GIT_COMMIT_SHA: "railway-sha",
      }),
    ).toMatchObject({ service: "worker", buildSha: "railway-sha" });
  });

  it("ignores blank build variables", () => {
    expect(
      resolveBuildMetadata("web", {
        APP_BUILD_SHA: "   ",
        VERCEL_GIT_COMMIT_SHA: "vercel-sha",
      }),
    ).toMatchObject({ buildSha: "vercel-sha" });
  });
});
