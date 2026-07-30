import assert from "node:assert/strict";
import test from "node:test";
import {
  forbiddenRuntimeMarkers,
  forbiddenSourcePatterns,
  forbiddenTracePaths,
} from "./public-tools-boundary-policy.mjs";

test("rejects App worker imports and traced runtime files", () => {
  for (const source of [
    'import worker from "@sf/worker";',
    'import("@sf/worker/runtime");',
    'import "@sf/worker";',
    'import "../../apps/worker/runtime";',
  ]) {
    assert.ok(
      forbiddenSourcePatterns(source).length > 0,
      `expected forbidden import: ${source}`,
    );
  }
  assert.deepEqual(
    forbiddenTracePaths("/repo/apps/worker/runtime.js"),
    ["/apps/worker/"],
  );
  assert.deepEqual(forbiddenRuntimeMarkers("apps/worker/runtime.js"), [
    "apps/worker",
  ]);
});

test("does not reject the neutral Public Tools runtime", () => {
  assert.deepEqual(
    forbiddenSourcePatterns(
      'import { scanSeoAuditSite } from "@sf/public-tools";',
    ),
    [],
  );
  assert.deepEqual(
    forbiddenTracePaths("/repo/packages/public-tools/src/index.ts"),
    [],
  );
  assert.deepEqual(forbiddenRuntimeMarkers("@sf/public-tools"), []);
});
