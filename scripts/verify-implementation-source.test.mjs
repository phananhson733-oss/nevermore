import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const verifier = readFileSync(
  resolve(scriptDirectory, "verify-implementation.mjs"),
  "utf8",
);

test("derives the migration table count from the expected table contract", () => {
  assert.match(verifier, /tables\.length\s*===\s*EXPECTED_TABLES\.length/);
  assert.match(
    verifier,
    /expected \$\{EXPECTED_TABLES\.length\} app tables in the migrations/,
  );
  assert.match(
    verifier,
    /database: \$\{EXPECTED_TABLES\.length\} app tables \(pg-boss excluded\)/,
  );
  assert.doesNotMatch(verifier, /tables\.length\s*===\s*28/);
});
