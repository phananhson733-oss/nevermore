import { afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import {
  setupWorkflowTests,
  teardownWorkflowTests,
} from "@workflow/vitest";

const marketingRoot = fileURLToPath(new URL("../", import.meta.url));

await setupWorkflowTests({ cwd: marketingRoot, rootDir: marketingRoot });

afterAll(async () => {
  await teardownWorkflowTests();
});
