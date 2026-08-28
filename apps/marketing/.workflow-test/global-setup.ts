import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildWorkflowTests } from "@workflow/vitest";

const marketingRoot = fileURLToPath(new URL("../", import.meta.url));
const stepsBundle = fileURLToPath(
  new URL("../.workflow-vitest/steps.mjs", import.meta.url),
);

export async function setup(): Promise<void> {
  await buildWorkflowTests({ cwd: marketingRoot, rootDir: marketingRoot });

  // @workflow/vitest@4.0.21 discovery currently admits its own build-time
  // serde-checker into the runtime bundle. esbuild then externalizes the JSON
  // import without the required Node import attribute. Keep the official
  // builder/Local World, but neutralize only that unused generated binding.
  const source = await readFile(stepsBundle, "utf8");
  const pattern =
    /import builtinModules from "[^"]*builtin-modules\.json";\nvar builtin_modules_default = builtinModules;/u;
  if (!pattern.test(source)) {
    throw new Error(
      "Workflow test bundle did not contain the expected v4 serde-checker import",
    );
  }
  await writeFile(
    stepsBundle,
    source.replace(pattern, "var builtin_modules_default = [];"),
    "utf8",
  );
}
