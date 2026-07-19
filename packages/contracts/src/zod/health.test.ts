import { describe, expect, it } from "vitest";

import {
  CONTRACT_VERSION,
  PRODUCT_VERSION,
  resolveBuildMetadata,
  versionResponse,
} from "./health.ts";

describe("build/version metadata", () => {
  it("reports the immutable product and contract versions with an explicit build SHA", () => {
    const metadata = resolveBuildMetadata("web", {
      APP_BUILD_SHA: "abc123",
      VERCEL_GIT_COMMIT_SHA: "ignored",
    });

    expect(metadata).toEqual({
      productVersion: PRODUCT_VERSION,
      contractVersion: CONTRACT_VERSION,
      service: "web",
      buildSha: "abc123",
    });
    expect(versionResponse.parse(metadata)).toEqual(metadata);
  });

  it("uses platform commit metadata and an honest development sentinel", () => {
    expect(
      resolveBuildMetadata("worker", { RAILWAY_GIT_COMMIT_SHA: "railway-sha" }),
    ).toMatchObject({ service: "worker", buildSha: "railway-sha" });
    expect(resolveBuildMetadata("web", {})).toMatchObject({
      service: "web",
      buildSha: "development",
    });
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
