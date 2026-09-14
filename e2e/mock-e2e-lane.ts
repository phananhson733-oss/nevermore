import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));

export const MOCK_E2E_DEFAULT_PORT = 3200;
// Unprivileged TCP ports only; the value is spliced into paths that the
// cleanup reporter deletes, so anything but a plain integer is refused.
const MOCK_E2E_PORT_FLOOR = 1024;
const MOCK_E2E_PORT_CEILING = 65_535;

export interface MockE2eLanePaths {
  readonly port: number;
  /** The value consumed by apps/web/next.config.ts. */
  readonly distDirectoryName: string;
  /** Absolute form used by the post-Playwright cleanup reporter. */
  readonly distDir: string;
  readonly blobDir: string;
  readonly outputDir: string;
  /** Matches only this lane's rewrite of apps/web/next-env.d.ts. */
  readonly generatedImportPattern: RegExp;
}

/**
 * A mock lane is identified by its port. Everything the lane writes (the Next
 * dist directory, local blobs, Playwright output) is derived from that port, so
 * two lanes on different ports never share, clean, or overwrite each other's
 * files. The error does not echo the supplied value.
 */
export function requireMockE2ePort(value: string | undefined): number {
  if (value === undefined) {
    return MOCK_E2E_DEFAULT_PORT;
  }
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error("E2E_MOCK_PORT must be a decimal integer.");
  }
  const port = Number(value);
  if (port < MOCK_E2E_PORT_FLOOR || port > MOCK_E2E_PORT_CEILING) {
    throw new Error(
      `E2E_MOCK_PORT must be between ${MOCK_E2E_PORT_FLOOR} and ${MOCK_E2E_PORT_CEILING}.`,
    );
  }
  return port;
}

/** Return only exact, lane-owned paths that are safe for reporter cleanup. */
export function getMockE2eLanePaths(port: number): MockE2eLanePaths {
  const validatedPort = requireMockE2ePort(String(port));
  const distDirectoryName = `.next-e2e-mock-${validatedPort}`;
  return {
    port: validatedPort,
    distDirectoryName,
    distDir: join(REPOSITORY_ROOT, "apps", "web", distDirectoryName),
    blobDir: join(tmpdir(), `signalframe-e2e-mock-${validatedPort}-blobs`),
    outputDir: join(REPOSITORY_ROOT, "test-results", `mock-${validatedPort}`),
    generatedImportPattern: new RegExp(
      `import "\\./\\.next-e2e-mock-${validatedPort}/[^"]+";`,
    ),
  };
}
