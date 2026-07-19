import { fileURLToPath } from "node:url";
import { E2eCleanupReporter } from "./cleanup-reporter.ts";

const mockDist = fileURLToPath(
  new URL("../apps/web/.next-e2e-mock", import.meta.url),
);
const nextEnv = fileURLToPath(
  new URL("../apps/web/next-env.d.ts", import.meta.url),
);
const localBlobs = "/tmp/signalframe-e2e-mock-blobs";

/** Clean exact mock-E2E paths only after Playwright has stopped Next. */
export default class MockE2eCleanupReporter extends E2eCleanupReporter {
  constructor() {
    super("mock", {
      distDir: mockDist,
      blobDir: localBlobs,
      nextEnvPath: nextEnv,
      generatedImportPattern: /import "\.\/\.next-e2e-mock\/[^"]+";/,
    });
  }
}
