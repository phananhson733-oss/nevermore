#!/usr/bin/env node
// Vendor baseline guard (spec §3.1, §7.3, AC-048). Node stdlib only.
//
// Vendor-copies from the old SignalFrame repo are one-way READS; the old repo
// must never be modified by this task. This script re-reads the old repo's git
// state and compares it to the baseline captured at WP0 start
// (docs/vendor/old-repo-baseline.json). Any NEW modification — a changed
// porcelain status or a changed diff hash — fails the gate.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const BASELINE_PATH = join(ROOT, "docs/vendor/old-repo-baseline.json");

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
const oldRepo = baseline.oldRepoPath;

function git(args) {
  return execFileSync("git", ["-C", oldRepo, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

const problems = [];

// 1. HEAD must be unchanged.
let head;
try {
  head = git(["rev-parse", "HEAD"]).trim();
} catch (error) {
  console.error(`Cannot read old repo at ${oldRepo}: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
if (head !== baseline.head) {
  problems.push(`HEAD changed: baseline ${baseline.head} -> now ${head}`);
}

// 2. Porcelain status must match the recorded baseline exactly (no new files/edits).
const porcelainNow = git(["status", "--porcelain"])
  .split("\n")
  .filter((l) => l.length > 0);
const baselineSet = new Set(baseline.porcelainStatus ?? []);
const nowSet = new Set(porcelainNow);
for (const line of porcelainNow) {
  if (!baselineSet.has(line)) problems.push(`new/changed working-tree entry: ${JSON.stringify(line)}`);
}
for (const line of baseline.porcelainStatus ?? []) {
  if (!nowSet.has(line)) problems.push(`baseline working-tree entry disappeared: ${JSON.stringify(line)}`);
}

// 3. Tracked-diff hash must match (guards content changes to already-modified files).
const diff = git(["diff", "HEAD"]);
const diffSha = createHash("sha256").update(diff).digest("hex");
if (baseline.diffSha256 && diffSha !== baseline.diffSha256) {
  problems.push(`tracked diff hash changed: baseline ${baseline.diffSha256} -> now ${diffSha}`);
}

if (problems.length > 0) {
  console.error("Vendor baseline check FAILED — the old SignalFrame repo was modified:");
  for (const p of problems) console.error(`- ${p}`);
  process.exit(1);
}

console.log(`Vendor baseline check passed: ${oldRepo} unchanged since WP0 (HEAD ${head.slice(0, 12)}).`);
