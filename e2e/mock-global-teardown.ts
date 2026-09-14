import { fileURLToPath } from "node:url";
import { E2eCleanupReporter } from "./cleanup-reporter.ts";
import { getMockE2eLanePaths, requireMockE2ePort } from "./mock-e2e-lane.ts";

// Same derivation as playwright.mock.config.ts: this reporter runs in the
// Playwright process, so it sees the same E2E_MOCK_PORT and cleans only its lane.
const lane = getMockE2eLanePaths(
  requireMockE2ePort(process.env["E2E_MOCK_PORT"]),
);
const nextEnv = fileURLToPath(
  new URL("../apps/web/next-env.d.ts", import.meta.url),
);

/** Clean exact mock-E2E lane paths only after Playwright has stopped Next. */
export default class MockE2eCleanupReporter extends E2eCleanupReporter {
  constructor() {
    super(`mock-${lane.port}`, {
      distDir: lane.distDir,
      blobDir: lane.blobDir,
      nextEnvPath: nextEnv,
      generatedImportPattern: lane.generatedImportPattern,
    });
  }
}
