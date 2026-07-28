import { fileURLToPath } from "node:url";
import { E2eCleanupReporter } from "./cleanup-reporter.ts";

const workbenchDist = fileURLToPath(
  new URL("../apps/web/.next-workbench-artifact", import.meta.url),
);
const nextEnv = fileURLToPath(
  new URL("../apps/web/next-env.d.ts", import.meta.url),
);
const localBlobs = "/tmp/signalframe-workbench-artifact-blobs";

/** Clean only the generated files owned by the isolated artifact harness. */
export default class WorkbenchArtifactCleanupReporter extends E2eCleanupReporter {
  constructor() {
    super("workbench-artifact", {
      distDir: workbenchDist,
      blobDir: localBlobs,
      nextEnvPath: nextEnv,
      generatedImportPattern:
        /import "\.\/\.next-workbench-artifact\/[^"]+";/,
    });
  }
}
