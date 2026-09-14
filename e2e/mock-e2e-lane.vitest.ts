import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getMockE2eLanePaths,
  MOCK_E2E_DEFAULT_PORT,
  requireMockE2ePort,
} from "./mock-e2e-lane.ts";

describe("mock E2E lane ports", () => {
  it("defaults to 3200 when E2E_MOCK_PORT is unset", () => {
    expect(requireMockE2ePort(undefined)).toBe(3200);
    expect(MOCK_E2E_DEFAULT_PORT).toBe(3200);
  });

  it("accepts an explicit unprivileged port", () => {
    expect(requireMockE2ePort("3201")).toBe(3201);
    expect(requireMockE2ePort("1024")).toBe(1024);
    expect(requireMockE2ePort("65535")).toBe(65_535);
  });

  it.each(["", "abc", "3200abc", "32.5", "-3200", "03200", " 3200", "0", "1023", "65536"])(
    "refuses %j instead of deriving a path from it",
    (value) => {
      expect(() => requireMockE2ePort(value)).toThrow(/E2E_MOCK_PORT/);
    },
  );
});

describe("mock E2E lane paths", () => {
  it("derives every writable path from the port, the default lane included", () => {
    const lane = getMockE2eLanePaths(3200);
    expect(lane.distDirectoryName).toBe(".next-e2e-mock-3200");
    expect(lane.distDir.endsWith("/apps/web/.next-e2e-mock-3200")).toBe(true);
    expect(basename(lane.blobDir)).toBe("signalframe-e2e-mock-3200-blobs");
    expect(lane.outputDir.endsWith("/test-results/mock-3200")).toBe(true);
  });

  it("gives two lanes disjoint dist, blob and output directories", () => {
    const a = getMockE2eLanePaths(3200);
    const b = getMockE2eLanePaths(3201);
    for (const key of ["distDirectoryName", "distDir", "blobDir", "outputDir"] as const) {
      expect(a[key]).not.toBe(b[key]);
      expect(a[key].startsWith(b[key])).toBe(false);
      expect(b[key].startsWith(a[key])).toBe(false);
    }
  });

  it("restores only its own lane's next-env rewrite", () => {
    const a = getMockE2eLanePaths(3200);
    const own = 'import "./.next-e2e-mock-3200/dev/types/routes.d.ts";';
    const otherLane = 'import "./.next-e2e-mock-32001/dev/types/routes.d.ts";';
    const neighbour = 'import "./.next-e2e-mock-3201/dev/types/routes.d.ts";';
    const legacy = 'import "./.next-e2e-mock/dev/types/routes.d.ts";';
    const canonical = 'import "./.next/types/routes.d.ts";';

    expect(a.generatedImportPattern.test(own)).toBe(true);
    for (const line of [otherLane, neighbour, legacy, canonical]) {
      expect(a.generatedImportPattern.test(line)).toBe(false);
    }
  });

  it("refuses a non-integer port passed in code", () => {
    expect(() => getMockE2eLanePaths(3200.5)).toThrow(/E2E_MOCK_PORT/);
    expect(() => getMockE2eLanePaths(Number.NaN)).toThrow(/E2E_MOCK_PORT/);
  });
});
