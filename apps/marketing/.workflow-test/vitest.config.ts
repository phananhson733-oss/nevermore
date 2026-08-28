import { fileURLToPath } from "node:url";
import { workflow } from "@workflow/vitest";
import { defineConfig } from "vitest/config";

const marketingRoot = fileURLToPath(new URL("../", import.meta.url));
const workflowOptions = { cwd: marketingRoot, rootDir: marketingRoot };
const [workflowTransform] = workflow(workflowOptions);

export default defineConfig({
  root: marketingRoot,
  plugins: workflowTransform === undefined ? [] : [workflowTransform],
  test: {
    include: ["./.workflow-test/**/*.workflow.vitest.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    globalSetup: [
      fileURLToPath(new URL("./global-setup.ts", import.meta.url)),
    ],
    setupFiles: [
      fileURLToPath(new URL("./setup-file.ts", import.meta.url)),
    ],
  },
});
