import { isAbsolute } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REAL_E2E_SEGMENTS,
  REAL_E2E_DEFAULT_PORT_BLOCK,
  deriveRealE2eBasePort,
  deriveRealE2eDatabaseUrl,
  getRealE2eSegmentPaths,
  requireRealE2eInvocationId,
  requireRealE2eSegment,
} from "./real-e2e-runtime.ts";
import { requireSafeTestDatabaseUrl } from "../packages/db/src/test-database-safety.ts";

describe("real E2E segment runtime", () => {
  it("accepts exactly the three canonical segment keys", () => {
    expect(REAL_E2E_SEGMENTS).toEqual(["light", "ac044", "ac045"]);
    for (const segment of REAL_E2E_SEGMENTS) {
      expect(requireRealE2eSegment(segment)).toBe(segment);
    }
    expect(() => requireRealE2eSegment(undefined)).toThrow(
      "REAL_E2E_SEGMENT is required",
    );
    expect(() => requireRealE2eSegment("AC-044")).toThrow(
      "REAL_E2E_SEGMENT must be one of",
    );
  });

  it("gives each segment isolated dist, blob, and Playwright output paths", () => {
    const runtimes = REAL_E2E_SEGMENTS.map((segment) =>
      getRealE2eSegmentPaths(segment, "invocation-one"),
    );

    expect(new Set(runtimes.map(({ distDir }) => distDir)).size).toBe(3);
    expect(new Set(runtimes.map(({ blobDir }) => blobDir)).size).toBe(3);
    expect(new Set(runtimes.map(({ outputDir }) => outputDir)).size).toBe(3);
    for (const runtime of runtimes) {
      expect(runtime.distDirectoryName).toContain(runtime.segment);
      expect(isAbsolute(runtime.distDir)).toBe(true);
      expect(isAbsolute(runtime.blobDir)).toBe(true);
      expect(isAbsolute(runtime.outputDir)).toBe(true);
    }
  });

  it("does not reuse paths or default ports across invocations", () => {
    const first = getRealE2eSegmentPaths("light", "invocation-one");
    const second = getRealE2eSegmentPaths("light", "invocation-two");

    expect(first.distDir).not.toBe(second.distDir);
    expect(first.blobDir).not.toBe(second.blobDir);
    expect(first.outputDir).not.toBe(second.outputDir);
    expect(deriveRealE2eBasePort("invocation-one")).not.toBe(
      deriveRealE2eBasePort("invocation-two"),
    );
    for (const port of [
      deriveRealE2eBasePort("invocation-one"),
      deriveRealE2eBasePort("invocation-two"),
    ]) {
      expect(port).toBeGreaterThanOrEqual(
        REAL_E2E_DEFAULT_PORT_BLOCK.floor,
      );
      expect(port + REAL_E2E_SEGMENTS.length - 1).toBeLessThan(
        REAL_E2E_DEFAULT_PORT_BLOCK.exclusiveCeiling,
      );
    }
  });

  it("keeps every possible default segment port below the ephemeral boundary", () => {
    const maximumPort =
      REAL_E2E_DEFAULT_PORT_BLOCK.floor +
      (REAL_E2E_DEFAULT_PORT_BLOCK.blockCount - 1) *
        REAL_E2E_DEFAULT_PORT_BLOCK.blockSize +
      REAL_E2E_SEGMENTS.length -
      1;

    expect(REAL_E2E_DEFAULT_PORT_BLOCK.blockSize).toBe(
      REAL_E2E_SEGMENTS.length,
    );
    expect(maximumPort).toBeLessThan(
      REAL_E2E_DEFAULT_PORT_BLOCK.exclusiveCeiling,
    );
  });

  it("keeps the CI collision regression invocation below the ephemeral boundary", () => {
    const basePort = deriveRealE2eBasePort("ephemeral-regression-0");

    expect(basePort + REAL_E2E_SEGMENTS.length - 1).toBeLessThan(
      REAL_E2E_DEFAULT_PORT_BLOCK.exclusiveCeiling,
    );
  });

  it("requires a non-empty invocation identifier", () => {
    expect(() => requireRealE2eInvocationId(undefined)).toThrow(
      "REAL_E2E_INVOCATION_ID is required",
    );
    expect(() => requireRealE2eInvocationId("  ")).toThrow(
      "REAL_E2E_INVOCATION_ID is required",
    );
  });

  it("derives deterministic, unique, guarded databases within 63 bytes", () => {
    const source =
      "postgresql://runner:secret@127.0.0.1:5432/signalframe_e2e_ci";
    const invocationId = "workflow-attempt-with-a-very-long-name-".repeat(10);
    const urls = REAL_E2E_SEGMENTS.map((segment) =>
      deriveRealE2eDatabaseUrl(source, invocationId, segment),
    );

    expect(new Set(urls).size).toBe(3);
    for (const url of urls) {
      const parsed = new URL(url);
      const databaseName = decodeURIComponent(parsed.pathname.slice(1));
      expect(Buffer.byteLength(databaseName, "utf8")).toBeLessThanOrEqual(63);
      expect(requireSafeTestDatabaseUrl(url, "generated URL")).toBe(url);
      expect(parsed.hostname).toBe("127.0.0.1");
      expect(parsed.username).toBe("runner");
      expect(parsed.password).toBe("secret");
    }

    expect(
      deriveRealE2eDatabaseUrl(source, invocationId, "light"),
    ).toBe(urls[0]);
  });

  it("requires an invocation identifier before deriving a database", () => {
    expect(() =>
      deriveRealE2eDatabaseUrl(
        "postgresql://localhost/signalframe_e2e_ci",
        "",
        "light",
      ),
    ).toThrow("invocation identifier");
  });
});
