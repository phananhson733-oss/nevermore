import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  const path = join(repositoryRoot, relativePath);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const packageJson = readJson("package.json");
const specLock = readJson("scripts/spec-v0.3-lock.json");
const claude = read("CLAUDE.md");
const readme = read("README.md");
const progress = read("docs/PROGRESS.md");
const deployment = read("docs/DEPLOYMENT.md");
const navigationSource = read(
  "apps/web/src/app/p/[projectId]/_nav-model.ts",
);
const zhCN = readJson("packages/i18n/src/messages/zh-CN.json");
const migrationFiles = readdirSync(
  join(repositoryRoot, specLock.migrationDirectory),
)
  .filter((name) => new RegExp(specLock.migrationFilePattern).test(name))
  .sort();

function primaryNavigation(source) {
  const block = source.match(
    /export const PRIMARY_NAV_ITEMS:[\s\S]*?=\s*\[([\s\S]*?)\n\];/,
  );
  assert.ok(block, "customer primary navigation declaration is missing");

  return [...block[1].matchAll(/\{([\s\S]*?)\n\s*\},/g)].map((match) => {
    const key = match[1].match(/^\s*key:\s*"([^"]+)",/m)?.[1];
    const labelKey = match[1].match(/^\s*labelKey:\s*"([^"]+)",/m)?.[1];
    const hrefSegment = match[1].match(
      /^\s*hrefSegment:\s*"([^"]+)",/m,
    )?.[1];
    assert.ok(key, "customer primary navigation entry is missing key");
    assert.ok(
      labelKey,
      `customer primary navigation ${key} is missing labelKey`,
    );
    assert.ok(
      hrefSegment,
      `customer primary navigation ${key} is missing hrefSegment`,
    );
    return { key, labelKey, hrefSegment };
  });
}

function inventoryFromDocument(source, path) {
  const match = source.match(
    /Contract inventory:\s*\*\*(\d+) API operations \/ (\d+) async operations \/ (\d+) app tables \/ (\d+) frozen rules\*\*/,
  );
  assert.ok(match, `${path} is missing the canonical inventory line`);
  return match.slice(1).map(Number);
}

test("package and activated spec lock agree on the current product version", () => {
  assert.equal(packageJson.version, specLock.productVersion);
});

test("customer-facing project documentation uses the package product version", () => {
  for (const [path, source] of [
    ["CLAUDE.md", claude],
    ["README.md", readme],
    ["docs/PROGRESS.md", progress],
    ["docs/DEPLOYMENT.md", deployment],
  ]) {
    assert.match(
      source,
      new RegExp(escapeRegExp(packageJson.version)),
      `${path} must report the package product version`,
    );
  }
  assert.doesNotMatch(
    [claude, readme, progress, deployment].join("\n"),
    /\b0\.2\.0\b/,
    "current project documentation must not report the retired 0.2.0 product version",
  );
});

test("current docs use the activated contract version", () => {
  for (const [path, source] of [
    ["README.md", readme],
    ["docs/PROGRESS.md", progress],
    ["docs/DEPLOYMENT.md", deployment],
  ]) {
    assert.match(
      source,
      new RegExp(specLock.contractVersion),
      `${path} must report the activated contract version`,
    );
  }
});

test("documented inventories are derived from the activated spec lock", () => {
  const expectedInventory = [
    specLock.apiOperations.length,
    specLock.asyncOperations.length,
    specLock.tables.length,
    specLock.rules.length,
  ];
  for (const [path, source] of [
    ["CLAUDE.md", claude],
    ["README.md", readme],
    ["docs/PROGRESS.md", progress],
    ["docs/DEPLOYMENT.md", deployment],
  ]) {
    assert.deepEqual(
      inventoryFromDocument(source, path),
      expectedInventory,
      `${path} inventory drifted from scripts/spec-v0.3-lock.json`,
    );
    assert.doesNotMatch(
      source,
      /\b(?:26 (?:API )?operations?|5 async operations?|28 (?:app )?tables?)\b/i,
      `${path} still contains a retired v0.2 inventory claim`,
    );
  }
});

test("progress reports the complete ordered migration range", () => {
  assert.ok(migrationFiles.length > 0, "activated migration range is empty");
  const first = migrationFiles[0];
  const last = migrationFiles.at(-1);
  assert.match(
    progress,
    new RegExp(
      `Migration range:\\s*\\\`${escapeRegExp(first)}\\\` through\\s*\\\`${escapeRegExp(last)}\\\` \\(\\*\\*${migrationFiles.length} ordered migrations\\*\\*\\)`,
    ),
  );
});

test("operator guidance names the repository-owned v0.3 authority as current", () => {
  assert.match(claude, /authority\/implementation-spec-v0\.3/);
  assert.doesNotMatch(
    claude,
    /implementation-spec-v0\.2/,
    "CLAUDE.md must not direct operators to the retired v0.2 authority",
  );
});

test("README documents the exact four-entry customer navigation source", () => {
  const primary = primaryNavigation(navigationSource);
  assert.deepEqual(
    primary.map(({ key }) => key),
    ["overview", "growth-map", "execution", "results"],
  );

  for (const { labelKey, hrefSegment } of primary) {
    const label = zhCN.nav[labelKey];
    assert.equal(typeof label, "string", `missing zh-CN nav label ${labelKey}`);
    assert.match(
      readme,
      new RegExp(
        `\\|\\s*${label}\\s*\\|\\s*\\\`/p/:projectId/${hrefSegment}\\\`\\s*\\|`,
      ),
      `README.md is missing the canonical ${label} navigation row`,
    );
  }

  const documentedTable = readme.match(
    /\| Customer label \| Canonical route \|\n\| --- \| --- \|\n((?:\|.*\|\n)+)\n/,
  );
  assert.ok(
    documentedTable,
    "README.md primary navigation table must contain exactly four rows",
  );
  assert.equal(
    [...documentedTable[1].matchAll(/^\|/gm)].length,
    primary.length,
  );
});

test("current Content Shadow is described as reviewed, not published", () => {
  for (const [path, source] of [
    ["CLAUDE.md", claude],
    ["README.md", readme],
    ["docs/PROGRESS.md", progress],
    ["docs/DEPLOYMENT.md", deployment],
  ]) {
    assert.match(
      source,
      /Content Shadow state:\s*\*\*reviewed, not published\*\*/,
      `${path} must state the current Content Shadow publication truth`,
    );
    assert.match(
      source,
      /Current v0\.3 external-write boundary:\s*\*\*no external writes\*\*/,
      `${path} must state the versioned v0.3 external-write boundary`,
    );
    assert.doesNotMatch(
      source,
      /Content Shadow(?:\s+state:|\s+is)\s*\*\*?published\*\*?/i,
      `${path} must never document current Content Shadow as published`,
    );
    assert.doesNotMatch(
      source,
      /Content Shadow\s*(?:现已|已经|已)(?:发布|上线)/,
      `${path} must never document current Content Shadow as published or live`,
    );
  }
  assert.doesNotMatch(
    claude,
    /无 CMS\/GitHub\/生产站点写入、无自动发布/,
    "the old permanent no-CMS/GitHub wording must become a versioned v0.3 boundary",
  );
});

test("docs identify both delivered slices and v0.4 as the next reviewed slice", () => {
  for (const [path, source] of [
    ["CLAUDE.md", claude],
    ["README.md", readme],
    ["docs/PROGRESS.md", progress],
  ]) {
    assert.match(source, /Slice 1 status:\s*\*\*complete\*\*/);
    assert.match(source, /Slice 2 status:\s*\*\*complete\*\*/);
    assert.match(
      source,
      /Next reviewed slice:\s*\*\*v0\.4 authorized publication and attribution\*\*/,
      `${path} must identify v0.4 as next, not current`,
    );
    assert.match(source, /Nevermore/);
    assert.match(source, /GenGrowth/);
  }
});

test("v0.4 docs separate delivery evidence from an attribution anchor", () => {
  for (const [path, source] of [
    ["CLAUDE.md", claude],
    ["README.md", readme],
    ["docs/PROGRESS.md", progress],
    ["docs/DEPLOYMENT.md", deployment],
  ]) {
    assert.match(
      source,
      /non-normative (?:v0\.4 )?(?:authority )?candidate/i,
      `${path} must keep the first v0.4 authority candidate non-normative`,
    );
    assert.match(source, /delivery receipt/i, `${path} is missing delivery receipt`);
    assert.match(source, /change receipt/i, `${path} is missing change receipt`);
    assert.match(
      source,
      /live canonical URL/i,
      `${path} is missing the change receipt live-URL requirement`,
    );
    assert.match(
      source,
      /change receipt[\s\S]{0,200}(?:anchor|锚定)/i,
      `${path} must allow only a change receipt to anchor attribution`,
    );
    assert.doesNotMatch(
      source,
      /publication receipt/i,
      `${path} must not describe a PR or draft delivery receipt as a publication receipt`,
    );
  }
});
