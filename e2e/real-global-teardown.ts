import { fileURLToPath } from "node:url";
import { E2eCleanupReporter } from "./cleanup-reporter.ts";

const realDist = fileURLToPath(
  new URL("../apps/web/.next-e2e-real", import.meta.url),
);
const nextEnv = fileURLToPath(
  new URL("../apps/web/next-env.d.ts", import.meta.url),
);
const localBlobs = "/tmp/signalframe-e2e-real-blobs";

/** Clean exact real-E2E paths only after Playwright has stopped Next. */
export default class RealE2eCleanupReporter extends E2eCleanupReporter {
  constructor() {
    super("real", {
      distDir: realDist,
      blobDir: localBlobs,
      nextEnvPath: nextEnv,
      generatedImportPattern: /import "\.\/\.next-e2e-real\/[^"]+";/,
    });
  }
}
