#!/usr/bin/env node

/**
 * Non-blocking companion to the branch-coverage gate.
 *
 * The gate (vitest.config.ts) is measured on the unit AND integration projects
 * together, because the tests that verify this repo's highest-risk behavior —
 * keyset paging, tenant boundaries, activeKey races — can only be written
 * against a real Postgres. Measuring `unit` alone answered a different question
 * and rewarded mock-shaped assertions.
 *
 * The merge costs one fact: it can no longer show that a file has no unit test
 * at all. `packages/db/src/repositories/flow-shadow-runs.ts` reads 0% on unit
 * and 75.9% merged; after the merge nobody would notice the 0 again. This
 * report is that fact, printed on every CI run, with no threshold attached.
 *
 * It runs the unit project by itself with coverage thresholds zeroed, so a
 * FAILING TEST still exits non-zero (test failures must keep blocking) while a
 * low coverage number never does.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Files at or under this unit branch percentage are named in the report. */
const LOW_WATER_PCT = 30;

const reportsDirectory = mkdtempSync(join(tmpdir(), "sf-unit-cov-"));

try {
  const run = spawnSync(
    "pnpm",
    [
      "exec",
      "vitest",
      "run",
      "--project",
      "unit",
      "--coverage",
      "--coverage.reporter=json-summary",
      `--coverage.reportsDirectory=${reportsDirectory}`,
      // Zeroed on purpose: this command reports, it does not gate. The gate
      // lives in the `database` job, over unit + integration together.
      "--coverage.thresholds.statements=0",
      "--coverage.thresholds.branches=0",
      "--coverage.thresholds.functions=0",
      "--coverage.thresholds.lines=0",
    ],
    { cwd: root, stdio: ["ignore", "inherit", "inherit"] },
  );

  if (run.status !== 0) {
    // A real unit-test failure. Propagate it: only the coverage number is
    // non-blocking here, never the tests themselves.
    process.exit(run.status ?? 1);
  }

  const summary = JSON.parse(
    readFileSync(join(reportsDirectory, "coverage-summary.json"), "utf8"),
  );

  const rows = [];
  for (const [absolutePath, entry] of Object.entries(summary)) {
    if (absolutePath === "total") continue;
    const branches = entry.branches ?? { total: 0, covered: 0, pct: 100 };
    const statements = entry.statements ?? { covered: 0 };
    if (branches.total === 0) continue;
    const pct = (branches.covered / branches.total) * 100;
    if (pct > LOW_WATER_PCT) continue;
    rows.push({
      file: absolutePath.startsWith(root)
        ? absolutePath.slice(root.length + 1)
        : absolutePath,
      covered: branches.covered,
      total: branches.total,
      pct,
      // Zero covered statements means no unit test ever imported and ran this
      // module — a stronger and more actionable statement than a low branch %.
      unreached: statements.covered === 0,
    });
  }
  rows.sort((a, b) => b.total - a.total || a.file.localeCompare(b.file));

  const unreached = rows.filter((row) => row.unreached).length;

  console.log("");
  console.log(
    "================ unit-coverage gaps (non-blocking report) ================",
  );
  console.log(
    "The branch-coverage gate runs on unit + integration together. That merge",
  );
  console.log(
    "is honest about \"is this code tested?\" but it hides \"this file has no unit",
  );
  console.log(
    "test at all\". The files below are that hidden fact. No threshold applies.",
  );
  console.log("");

  if (rows.length === 0) {
    console.log(`No file sits at or below ${LOW_WATER_PCT}% unit branch coverage.`);
  } else {
    console.log("  unit branches           file");
    for (const row of rows) {
      const fraction = `${row.covered}/${row.total}`.padStart(9);
      const pct = `${row.pct.toFixed(1)}%`.padStart(7);
      const mark = row.unreached ? "  <- no unit test reaches this file" : "";
      console.log(`  ${fraction} ${pct}   ${row.file}${mark}`);
    }
    console.log("");
    console.log(
      `${rows.length} file(s) at or below ${LOW_WATER_PCT}% unit branch coverage; ` +
        `${unreached} of them are never reached by any unit test.`,
    );
  }
  console.log(
    "=========================================================================",
  );
} finally {
  rmSync(reportsDirectory, { recursive: true, force: true });
}
