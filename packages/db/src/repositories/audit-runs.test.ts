import { describe, expect, it } from "vitest";
import {
  GROWTH_AUDIT_PROJECTION_VERSION,
  LEGACY_GROWTH_AUDIT_PROJECTION_VERSION,
} from "./audit-runs.ts";

describe("Growth Audit projection generations", () => {
  it("keeps the known historical projection distinct from the current read model", () => {
    expect(LEGACY_GROWTH_AUDIT_PROJECTION_VERSION).toBe(
      "growth-audit.0.3.0",
    );
    expect(GROWTH_AUDIT_PROJECTION_VERSION).toBe("growth-audit.0.3.1");
    expect(GROWTH_AUDIT_PROJECTION_VERSION).not.toBe(
      LEGACY_GROWTH_AUDIT_PROJECTION_VERSION,
    );
  });
});
