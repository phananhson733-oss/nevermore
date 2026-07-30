import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  forbiddenRuntimeMarkers,
  forbiddenSourcePatterns,
  forbiddenTracePaths,
} from "./public-tools-boundary-policy.mjs";

const REPO_ROOT = new URL("../", import.meta.url);
const SOURCE_ROOTS = [
  "packages/public-tools/src",
  "apps/marketing/src/app/api/tools",
  "apps/marketing/src/lib/tools",
];
const TRACE_FRESHNESS_ROOTS = [
  ...SOURCE_ROOTS,
  "packages/sources/src/public-http",
  "packages/sources/src/crawl",
  "packages/sources/src/url-safety",
];
const TRACE_FRESHNESS_FILES = [
  "apps/marketing/package.json",
  "packages/public-tools/package.json",
  "packages/sources/package.json",
  "packages/sources/src/canonical-url.ts",
  "pnpm-lock.yaml",
];
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx"]);

async function collectFiles(directory) {
  const entries = await readdir(new URL(`${directory}/`, REPO_ROOT), {
    withFileTypes: true,
  });
  const files = [];
  for (const entry of entries) {
    const child = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(child)));
    } else if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
      files.push(child);
    }
  }
  return files;
}

const violations = [];
for (const root of SOURCE_ROOTS) {
  for (const file of await collectFiles(root)) {
    const source = await readFile(new URL(file, REPO_ROOT), "utf8");
    for (const pattern of forbiddenSourcePatterns(source)) {
      violations.push(`${file}: ${pattern}`);
    }
  }
}

const builtRoute =
  "apps/marketing/.next/server/app/api/tools/seo-audit/route.js";
const builtTrace = `${builtRoute}.nft.json`;
try {
  const route = await readFile(new URL(builtRoute, REPO_ROOT), "utf8");
  const traceUrl = new URL(builtTrace, REPO_ROOT);
  const trace = JSON.parse(await readFile(traceUrl, "utf8"));
  if (
    typeof trace !== "object" ||
    trace === null ||
    !Array.isArray(trace.files)
  ) {
    throw new TypeError(`${builtTrace}: invalid Next.js trace`);
  }
  const traceStat = await stat(traceUrl);
  const freshnessFiles = [
    ...(
      await Promise.all(
        TRACE_FRESHNESS_ROOTS.map((root) => collectFiles(root)),
      )
    ).flat(),
    ...TRACE_FRESHNESS_FILES,
  ];
  const freshnessStats = await Promise.all(
    freshnessFiles.map(async (file) => ({
      file,
      value: await stat(new URL(file, REPO_ROOT)),
    })),
  );
  const newerSource = freshnessStats
    .filter(({ value }) => value.mtimeMs > traceStat.mtimeMs + 1)
    .sort((left, right) => right.value.mtimeMs - left.value.mtimeMs)[0];
  if (newerSource) {
    violations.push(
      `${builtTrace}: stale production trace; ${newerSource.file} is newer, run the marketing build first`,
    );
  }

  const tracedUrls = trace.files.map((file) => new URL(file, traceUrl));
  for (const tracedUrl of tracedUrls) {
    const normalizedPath = fileURLToPath(tracedUrl).replaceAll("\\", "/");
    for (const marker of forbiddenTracePaths(normalizedPath)) {
      violations.push(`${builtTrace}: traces ${marker}`);
    }
  }

  const runtimeUrls = [
    new URL(builtRoute, REPO_ROOT),
    ...tracedUrls.filter((url) =>
      SOURCE_EXTENSIONS.has(extname(fileURLToPath(url))),
    ),
  ];
  for (const url of runtimeUrls) {
    const output = await readFile(url, "utf8");
    for (const marker of forbiddenRuntimeMarkers(output)) {
      violations.push(
        `${relative(fileURLToPath(REPO_ROOT), fileURLToPath(url))}: contains ${marker}`,
      );
    }
  }
  console.log(
    `Public Tools boundary: checked ${runtimeUrls.length} traced runtime files.`,
  );
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  violations.push(
    `${builtTrace}: production build trace missing; run the marketing build first`,
  );
}

if (violations.length > 0) {
  console.error("Public Tools runtime boundary violations:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    `Public Tools boundary passed for ${SOURCE_ROOTS.map((root) =>
      relative(".", root),
    ).join(", ")}.`,
  );
}
