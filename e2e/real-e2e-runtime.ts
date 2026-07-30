import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { requireSafeTestDatabaseUrl } from "../packages/db/src/test-database-safety.ts";

export const REAL_E2E_SEGMENTS = ["light", "ac044", "ac045"] as const;
export type RealE2eSegment = (typeof REAL_E2E_SEGMENTS)[number];

const REAL_E2E_SEGMENT_SET = new Set<string>(REAL_E2E_SEGMENTS);
const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
// Keep the canonical default blocks below Linux's usual dynamic-client port
// range. A browser connected to segment N can otherwise receive segment N+1's
// consecutive listen port as its local ephemeral port, leaving the next Next
// server to fail with EADDRINUSE even though every server process was stopped.
// Explicit E2E_PORT values remain authoritative and still fail closed through
// Playwright's reuseExistingServer=false guard.
export const REAL_E2E_DEFAULT_PORT_BLOCK = {
  floor: 10_000,
  blockCount: 7_589,
  blockSize: REAL_E2E_SEGMENTS.length,
  exclusiveCeiling: 32_768,
} as const;

export interface RealE2eSegmentPaths {
  readonly segment: RealE2eSegment;
  /** The value consumed by apps/web/next.config.ts. */
  readonly distDirectoryName: string;
  /** Absolute form used by the post-Playwright cleanup reporter. */
  readonly distDir: string;
  readonly blobDir: string;
  readonly outputDir: string;
}

export function requireRealE2eInvocationId(
  value: string | undefined,
): string {
  if (!value || value.trim().length === 0) {
    throw new Error("REAL_E2E_INVOCATION_ID is required.");
  }
  return value;
}

function realE2eInvocationHash(invocationId: string): string {
  return createHash("sha256")
    .update(requireRealE2eInvocationId(invocationId))
    .digest("hex")
    .slice(0, 20);
}

/**
 * Fail closed when the Playwright config or cleanup reporter is opened outside
 * the canonical orchestrator. The error deliberately does not reflect the
 * supplied value because environment variables can contain unintended data.
 */
export function requireRealE2eSegment(
  value: string | undefined,
): RealE2eSegment {
  if (!value) {
    throw new Error("REAL_E2E_SEGMENT is required.");
  }
  if (!REAL_E2E_SEGMENT_SET.has(value)) {
    throw new Error(
      `REAL_E2E_SEGMENT must be one of ${REAL_E2E_SEGMENTS.join(", ")}.`,
    );
  }
  return value as RealE2eSegment;
}

/** Return only exact, segment-owned paths that are safe for reporter cleanup. */
export function getRealE2eSegmentPaths(
  segment: RealE2eSegment,
  invocationId: string,
): RealE2eSegmentPaths {
  const validatedSegment = requireRealE2eSegment(segment);
  const invocationHash = realE2eInvocationHash(invocationId);
  const resourceKey = `${invocationHash}-${validatedSegment}`;
  const distDirectoryName = `.next-e2e-real-${resourceKey}`;
  return {
    segment: validatedSegment,
    distDirectoryName,
    distDir: join(REPOSITORY_ROOT, "apps", "web", distDirectoryName),
    blobDir: join(
      tmpdir(),
      `signalframe-e2e-real-${resourceKey}-blobs`,
    ),
    outputDir: join(
      REPOSITORY_ROOT,
      "test-results",
      `real-${resourceKey}`,
    ),
  };
}

/**
 * Keep concurrent canonical invocations away from the same default ports. An
 * explicit E2E_PORT remains authoritative; reuseExistingServer=false still
 * fails closed if another process already owns a derived port.
 */
export function deriveRealE2eBasePort(invocationId: string): number {
  const invocationHash = realE2eInvocationHash(invocationId);
  const slot =
    Number.parseInt(invocationHash.slice(0, 8), 16) %
    REAL_E2E_DEFAULT_PORT_BLOCK.blockCount;
  return (
    REAL_E2E_DEFAULT_PORT_BLOCK.floor +
    slot * REAL_E2E_DEFAULT_PORT_BLOCK.blockSize
  );
}

/**
 * Keep the connection/auth portion of the guarded source URL while replacing
 * its database with a short invocation-and-segment-specific name. Hashing the
 * caller token makes even long CI identifiers deterministic without risking
 * PostgreSQL's 63-byte identifier truncation or admitting unsafe characters.
 */
export function deriveRealE2eDatabaseUrl(
  sourceDatabaseUrl: string | undefined,
  invocationId: string,
  segment: RealE2eSegment,
): string {
  const safeSource = requireSafeTestDatabaseUrl(
    sourceDatabaseUrl,
    "E2E_DATABASE_URL",
  );
  if (!invocationId) {
    throw new Error("A real E2E invocation identifier is required.");
  }
  const validatedSegment = requireRealE2eSegment(segment);
  const invocationHash = realE2eInvocationHash(invocationId);
  const databaseName = `signalframe_e2e_${invocationHash}_${validatedSegment}`;
  const derived = new URL(safeSource);
  derived.pathname = `/${databaseName}`;

  // Re-run the destructive-test guard after every transformation rather than
  // assuming that a safe source URL necessarily produced a safe target.
  return requireSafeTestDatabaseUrl(
    derived.toString(),
    "generated E2E_DATABASE_URL",
  );
}
