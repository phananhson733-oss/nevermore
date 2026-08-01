import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const packageJson = readJson("package.json");
const authorityIndex = readJson("authority/index.json");
const specLock = readJson(authorityIndex.active.lockPath);
const sources = new Map([
  ["README.md", read("README.md")],
  ["CLAUDE.md", read("CLAUDE.md")],
  ["docs/PROGRESS.md", read("docs/PROGRESS.md")],
  ["docs/DEPLOYMENT.md", read("docs/DEPLOYMENT.md")],
  [
    "authority/implementation-spec-v0.4/README.md",
    read("authority/implementation-spec-v0.4/README.md"),
  ],
  [
    "authority/implementation-spec-v0.4/MVP-IMPLEMENTATION-SPEC.md",
    read("authority/implementation-spec-v0.4/MVP-IMPLEMENTATION-SPEC.md"),
  ],
]);
const navigationSource = read(
  "apps/web/src/components/app-shell/nav-model.ts",
);
const zhCN = readJson("packages/i18n/src/messages/zh-CN.json");
const migrationFiles = readdirSync(
  join(repositoryRoot, specLock.migrationDirectory),
)
  .filter((name) => new RegExp(specLock.migrationFilePattern).test(name))
  .sort();

function inventoryFromDocument(source, path) {
  const match = source.match(
    /Contract inventory:\s*\*\*(\d+) API operations \/ (\d+) async operations \/ (\d+) app tables \/ (\d+) frozen rules\*\*/,
  );
  assert.ok(match, `${path} is missing the canonical inventory line`);
  return match.slice(1).map(Number);
}

function primaryNavigation(source) {
  const block = source.match(
    /export const PRIMARY_NAV_ITEMS:[\s\S]*?=\s*\[([\s\S]*?)\n\];/,
  );
  assert.ok(block, "customer primary navigation declaration is missing");
  return [...block[1].matchAll(/\{([\s\S]*?)\n\s*\},/g)].map(
    (match) => ({
      key: match[1].match(/^\s*key:\s*"([^"]+)",/m)?.[1],
      labelKey: match[1].match(/^\s*labelKey:\s*"([^"]+)",/m)?.[1],
      hrefSegment: match[1].match(
        /^\s*hrefSegment:\s*"([^"]+)",/m,
      )?.[1],
    }),
  );
}

test("authority discovery activates normative v0.4 and retains v0.3 history", () => {
  assert.deepEqual(authorityIndex.active, {
    version: "0.4.0",
    status: "active",
    normative: true,
    authorityRoot: "authority/implementation-spec-v0.4",
    lockPath: "scripts/spec-v0.4-lock.json",
  });
  assert.deepEqual(authorityIndex.history, [
    {
      version: "0.3.0",
      status: "historical",
      normative: false,
      authorityRoot: "authority/implementation-spec-v0.3",
      lockPath: "scripts/spec-v0.3-lock.json",
    },
  ]);
  assert.deepEqual(authorityIndex.historicalDesignInputs, [
    {
      label: "v0.4 publication candidate before atomic promotion",
      status: "historical",
      normative: false,
      executable: false,
      path: "authority/implementation-spec-v0.4/historical-publication-candidate",
    },
  ]);
});

test("package, active lock and current docs agree on machine versions", () => {
  assert.equal(packageJson.version, specLock.productVersion);
  assert.equal(specLock.authorityVersion, "0.4.0");
  assert.equal(specLock.contractVersion, "2026-07-21");
  assert.equal(specLock.ruleSetVersion, "mvp.rules.0.2.2");
  for (const [path, source] of sources) {
    assert.match(
      source,
      new RegExp(escapeRegExp(packageJson.version)),
      `${path} must state product ${packageJson.version}`,
    );
  }
  for (const path of [
    "README.md",
    "CLAUDE.md",
    "docs/PROGRESS.md",
    "docs/DEPLOYMENT.md",
  ]) {
    assert.match(
      sources.get(path),
      /authority\/implementation-spec-v0\.4|active v0\.4|Current authority: \*\*v0\.4/,
      `${path} must point operators to active v0.4`,
    );
  }
});

test("documented inventories are derived from the active v0.4 lock", () => {
  const expected = [
    specLock.apiOperations.length,
    specLock.asyncOperations.length,
    specLock.tables.length,
    specLock.rules.length,
  ];
  assert.deepEqual(expected, [78, 10, 78, 11]);
  for (const path of [
    "README.md",
    "CLAUDE.md",
    "docs/PROGRESS.md",
    "docs/DEPLOYMENT.md",
  ]) {
    assert.deepEqual(
      inventoryFromDocument(sources.get(path), path),
      expected,
      `${path} inventory drifted from ${authorityIndex.active.lockPath}`,
    );
  }
});

test("current handoff documents the complete ordered migration range", () => {
  assert.equal(migrationFiles.length, 35);
  const expected = new RegExp(
    `Migration range:\\s*\\\`${escapeRegExp(migrationFiles[0])}\\\` through\\s*\\\`${escapeRegExp(migrationFiles.at(-1))}\\\` \\(\\*\\*${migrationFiles.length} ordered migrations\\*\\*\\)`,
  );
  assert.match(sources.get("docs/PROGRESS.md"), expected);
  assert.match(sources.get("docs/DEPLOYMENT.md"), expected);
});

test("current docs freeze server-owned DFS and published-generation reads", () => {
  for (const path of [
    "README.md",
    "CLAUDE.md",
    "docs/PROGRESS.md",
    "authority/implementation-spec-v0.4/README.md",
    "authority/implementation-spec-v0.4/MVP-IMPLEMENTATION-SPEC.md",
  ]) {
    const source = sources.get(path);
    assert.match(source, /DataForSEO Search Landscape\s*[(（]DFS[)）]/);
    assert.match(source, /diagnosticRunId/);
    assert.match(source, /view=review/);
    assert.match(source, /PATCH.*query|PATCH 拒绝全部 query/s);
  }
  for (const path of [
    "README.md",
    "CLAUDE.md",
    "docs/PROGRESS.md",
    "docs/DEPLOYMENT.md",
    "authority/implementation-spec-v0.4/README.md",
    "authority/implementation-spec-v0.4/MVP-IMPLEMENTATION-SPEC.md",
  ]) {
    const source = sources.get(path);
    assert.match(
      source,
      /createCollectionRun|public\s+collection|公共\s+`createCollectionRun`|公开\s+`createCollectionRun`/,
    );
    assert.match(
      source,
      /(?:crawl|Crawl)[\s\S]{0,100}(?:gsc|GSC)[\s\S]{0,100}(?:ga4|GA4)/,
    );
  }
});

test("README mirrors the exact four-entry customer navigation", () => {
  const primary = primaryNavigation(navigationSource);
  assert.deepEqual(
    primary.map(({ key }) => key),
    ["overview", "growth-map", "execution", "results"],
  );
  for (const { labelKey, hrefSegment } of primary) {
    const label = zhCN.nav[labelKey];
    assert.equal(typeof label, "string");
    assert.match(
      sources.get("README.md"),
      new RegExp(
        `\\|\\s*${label}\\s*\\|\\s*\\\`/p/:projectId/${hrefSegment}\\\`\\s*\\|`,
      ),
    );
  }
});

test("current docs describe keyword and competitor paths as integrated Growth Map capabilities", () => {
  for (const path of [
    "docs/PROGRESS.md",
    "authority/implementation-spec-v0.4/README.md",
    "authority/implementation-spec-v0.4/MVP-IMPLEMENTATION-SPEC.md",
  ]) {
    const source = sources.get(path);
    assert.match(source, /关键词|Keyword/);
    assert.match(source, /竞品|Competitor/);
    assert.match(source, /增长地图/);
    assert.match(source, /四模块/);
  }
});

test("current external-write truth is versioned v0.4, not an active candidate", () => {
  for (const path of [
    "README.md",
    "CLAUDE.md",
    "docs/PROGRESS.md",
    "docs/DEPLOYMENT.md",
    "authority/implementation-spec-v0.4/README.md",
    "authority/implementation-spec-v0.4/MVP-IMPLEMENTATION-SPEC.md",
  ]) {
    const source = sources.get(path);
    assert.match(source, /Content Shadow state: \*\*reviewed, not published\*\*/);
    assert.match(
      source,
      /Current v0\.4 external-write boundary: \*\*no external writes\*\*/,
    );
    assert.doesNotMatch(
      source,
      /v0\.4 (?:is |先是|begins as (?:a )?)?non-normative candidate/i,
      `${path} still calls active v0.4 a candidate`,
    );
  }
});

test("publication narrative keeps delivery, live change and attribution distinct", () => {
  for (const path of [
    "README.md",
    "docs/PROGRESS.md",
    "docs/DEPLOYMENT.md",
    "authority/implementation-spec-v0.4/README.md",
  ]) {
    const source = sources.get(path);
    assert.match(source, /delivery receipt/i, `${path} is missing Delivery Receipt`);
    assert.match(source, /change receipt/i, `${path} is missing Change Receipt`);
    assert.match(source, /live\s+canonical URL/i);
    assert.match(source, /before\/after|归因|attribution/i);
    assert.doesNotMatch(
      source,
      /preview (?:is|是) (?:a )?(?:publish|publication|发布)/i,
    );
  }
});

test("historical candidate is quarantined and explicitly non-executable", () => {
  const historicalRoot =
    "authority/implementation-spec-v0.4/historical-publication-candidate";
  const historicalReadme = read(`${historicalRoot}/README.md`);
  assert.match(historicalReadme, /Normative: \*\*false\*\*/);
  assert.match(historicalReadme, /Executable: \*\*false\*\*/);
  const activeRootEntries = readdirSync(
    join(repositoryRoot, "authority/implementation-spec-v0.4"),
  );
  assert.deepEqual(
    activeRootEntries.filter((name) => /\.candidate\.|candidate-lock/.test(name)),
    [],
  );
});
