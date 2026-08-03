import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * Behavioural proof for the permanent Ahrefs API prohibition.
 *
 * These cases run the real verifier against real files rather than grepping its
 * source, because the value of the rule is entirely in what it *stops*. A guard
 * that is only asserted to contain a regex still passes after that regex is
 * quietly narrowed.
 *
 * Every forbidden token is assembled from fragments here, so this file is not
 * itself an instance of the thing it forbids — the verifier scans `scripts/`.
 */
const A = "ahrefs";
const UPPER = A.toUpperCase();
const HOST = `api.${A}.com`;
const MCP_PREFIX = `mcp__claude_ai_A${"hrefs"}__`;

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const probeDirectory = resolve(repositoryRoot, "scripts/__ahrefs_probe__");
const probeFile = resolve(probeDirectory, "probe.ts");
const PROHIBITED = /Ahrefs API integration is permanently prohibited/u;

function verifierRejects(source) {
  mkdirSync(probeDirectory, { recursive: true });
  writeFileSync(probeFile, source, "utf8");
  try {
    execFileSync(
      process.execPath,
      ["scripts/verify-implementation.mjs", "--root", "."],
      { cwd: repositoryRoot, encoding: "utf8", stdio: "pipe" },
    );
    return false;
  } catch (error) {
    return PROHIBITED.test(`${error.stdout ?? ""}${error.stderr ?? ""}`);
  } finally {
    rmSync(probeDirectory, { recursive: true, force: true });
  }
}

test("rejects every executable route to the Ahrefs API", () => {
  const forbidden = [
    ["direct API host", `await fetch("https://${HOST}/v3/site-explorer");`],
    ["host behind a constant", `const B = "https://${HOST}";\nawait get(B);`],
    ["bracket env credential", `const k = process.env["${UPPER}_API_KEY"];`],
    ["dotted env credential", `const k = process.env.${UPPER}_TOKEN;`],
    ["base URL override", `const u = process.env.${UPPER}_BASE_URL;`],
    ["camelCase credential", `const ${A}ApiKey = readSecret();`],
    ["camelCase client binding", `const ${A}Client = makeClient();`],
    ["MCP tool binding", `callTool("${MCP_PREFIX}site-explorer-metrics");`],
    ["SDK import", `import { Client } from "${A}-api";`],
    ["scoped SDK require", `const c = require("@${A}/sdk");`],
    ["dynamic import", `const m = await import("${A}-client");`],
  ];
  const missed = forbidden
    .filter(([, source]) => !verifierRejects(source))
    .map(([label]) => label);
  assert.deepEqual(
    missed,
    [],
    `the prohibition must reject every executable Ahrefs surface; it allowed: ${missed.join(", ")}`,
  );
});

test("permits Ahrefs as inert provenance", () => {
  // The rule bans integration, not the vendor's name. Banning the bare token
  // would fail the build on the provider enum, on migration 0030's CHECK
  // constraint, and on customer-visible attribution — data that records where
  // evidence came from, which is what the honesty rules require it to state.
  const permitted = [
    ["provider enum member", `export const P = z.enum(["${A}","moz"]);`],
    ["SQL check constraint", `-- provider IN ('${A}','moz')`],
    ["explanatory prose", `// Evidence may name ${A} as its origin.`],
    ["customer-facing link", `const href = "https://${A}.com/blog/x";`],
  ];
  const rejected = permitted
    .filter(([, source]) => verifierRejects(source))
    .map(([label]) => label);
  assert.deepEqual(
    rejected,
    [],
    `inert provenance must stay legal; it rejected: ${rejected.join(", ")}`,
  );
});
