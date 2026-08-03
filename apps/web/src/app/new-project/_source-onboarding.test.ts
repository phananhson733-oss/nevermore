import { describe, expect, it } from "vitest";
import {
  newProductContinuationPath,
  toggleOptionalGoogleSource,
} from "./_source-onboarding";

describe("optional Google source onboarding", () => {
  it("continues directly to Product Profile when the customer shares no data", () => {
    expect(newProductContinuationPath("project-id", [])).toBe(
      "/p/project-id/context",
    );
  });

  it("routes any explicit source choice through the optional setup step", () => {
    expect(newProductContinuationPath("project-id", ["gsc"])).toBe(
      "/p/project-id/setup-sources",
    );
    expect(newProductContinuationPath("project-id", ["gsc", "ga4"])).toBe(
      "/p/project-id/setup-sources",
    );
  });

  it("toggles providers without duplicates and keeps the other choice", () => {
    expect(toggleOptionalGoogleSource([], "gsc", true)).toEqual(["gsc"]);
    expect(toggleOptionalGoogleSource(["gsc"], "gsc", true)).toEqual([
      "gsc",
    ]);
    expect(
      toggleOptionalGoogleSource(["gsc", "ga4"], "gsc", false),
    ).toEqual(["ga4"]);
  });
});
