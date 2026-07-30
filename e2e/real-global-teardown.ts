import { fileURLToPath } from "node:url";
import { E2eCleanupReporter } from "./cleanup-reporter.ts";
import {
  getRealE2eSegmentPaths,
  requireRealE2eSegment,
} from "./real-e2e-runtime.ts";

const segment = requireRealE2eSegment(process.env["REAL_E2E_SEGMENT"]);
const segmentPaths = getRealE2eSegmentPaths(
  segment,
  process.env["REAL_E2E_INVOCATION_ID"] ?? "",
);
const nextEnv = fileURLToPath(
  new URL("../apps/web/next-env.d.ts", import.meta.url),
);
const escapedDistDirectoryName =
  segmentPaths.distDirectoryName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Clean exact real-E2E paths only after Playwright has stopped Next. */
export default class RealE2eCleanupReporter extends E2eCleanupReporter {
  constructor() {
    super(`real-${segment}`, {
      distDir: segmentPaths.distDir,
      blobDir: segmentPaths.blobDir,
      nextEnvPath: nextEnv,
      generatedImportPattern: new RegExp(
        `import "\\./${escapedDistDirectoryName}/[^"]+";`,
      ),
    });
  }
}
