#!/usr/bin/env node

/**
 * Clone-local implementation contract gate.
 *
 * This deliberately does not read the sibling implementation-spec or the old
 * SignalFrame repository. Redocly parses the checked-in OpenAPI document into
 * JSON, Node loads the executable rule registry, and every vendored target is
 * verified against the checked-in provenance manifest.
 *
 * `--root <path>` exists so the failure paths can be exercised against an
 * isolated fixture without mutating the real working tree.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

const PRODUCT_VERSION = "0.2.0";
const CONTRACT_VERSION = "2026-07-18";
const RULE_SET_VERSION = "mvp.rules.0.2.0";
const PROMPT_SET_VERSION = "mvp.prompts.0.2.0";
const BUNDLE_SCHEMA_VERSION = "signalframe.service-bundle.0.2.0";

const EXPECTED_OPENAPI_OPERATIONS = [
  "listProjects",
  "createProject",
  "getProject",
  "getProjectContext",
  "updateProjectContext",
  "getProjectWorkspaceView",
  "listProjectSources",
  "connectProjectSource",
  "handleGoogleOAuthCallback",
  "importProjectSourceFile",
  "disconnectProjectSource",
  "createCollectionRun",
  "listProjectSnapshots",
  "getProjectRun",
  "createDiagnosticRun",
  "listProjectFindings",
  "reviewProjectFinding",
  "listProjectActions",
  "updateProjectAction",
  "listProjectArtifacts",
  "createActionArtifact",
  "getProjectArtifact",
  "updateProjectArtifact",
  "getProjectReport",
  "createProjectExport",
  "getProjectExport",
];

const EXPECTED_ASYNC_OPERATIONS = [
  "importProjectSourceFile",
  "createCollectionRun",
  "createDiagnosticRun",
  "createActionArtifact",
  "createProjectExport",
];

const EXPECTED_ASYNC_ROUTE_IMPLEMENTATIONS = [
  {
    operationId: "importProjectSourceFile",
    file: "apps/web/src/app/api/mvp/projects/[projectId]/sources/[sourceRef]/import/route.ts",
  },
  {
    operationId: "createCollectionRun",
    file: "apps/web/src/app/api/mvp/projects/[projectId]/collection-runs/route.ts",
  },
  {
    operationId: "createDiagnosticRun",
    file: "apps/web/src/app/api/mvp/projects/[projectId]/diagnostic-runs/route.ts",
  },
  {
    operationId: "createActionArtifact",
    file: "apps/web/src/app/api/mvp/projects/[projectId]/actions/[actionId]/artifacts/route.ts",
  },
  {
    operationId: "createProjectExport",
    file: "apps/web/src/app/api/mvp/projects/[projectId]/exports/route.ts",
  },
];

const RUN_STATUS_ROUTE_FILE =
  "apps/web/src/app/api/mvp/projects/[projectId]/runs/[runId]/route.ts";

const WEB_PROXY_FILE = "apps/web/src/proxy.ts";
const INTEGRATION_SETUP_FILE =
  "packages/db/src/integration-test-setup.ts";
const INTEGRATION_SETUP_CONFIG_PATH =
  "./packages/db/src/integration-test-setup.ts";

const EXPECTED_TABLES = [
  "workspaces",
  "operator_profiles",
  "client_projects",
  "sites",
  "icp_profiles",
  "source_connections",
  "source_credentials",
  "oauth_intents",
  "import_previews",
  "async_runs",
  "collection_runs",
  "data_snapshots",
  "normalized_observations",
  "provider_discrepancies",
  "diagnostic_runs",
  "diagnostic_run_rules",
  "analysis_invocations",
  "evidence",
  "findings",
  "finding_observations",
  "finding_review_events",
  "actions",
  "action_override_audit",
  "execution_artifacts",
  "artifact_revisions",
  "export_bundles",
  "idempotency_keys",
  "telemetry_events",
];

const EXPECTED_RULES = [
  "TECH-HTTP-001",
  "TECH-CANONICAL-002",
  "TECH-LINKGRAPH-005",
  "SEARCH-CTR-004",
  "SEARCH-DECAY-002",
  "CONTENT-COVERAGE-001",
  "CONTENT-GAP-011",
  "CRO-PATH-001",
  "CRO-LANDING-003",
  "GEO-ENTITY-001",
  "GEO-CRAWLER-002",
];

const WORKSPACE_PACKAGES = [
  "package.json",
  "apps/web/package.json",
  "apps/worker/package.json",
  "packages/artifacts/package.json",
  "packages/contracts/package.json",
  "packages/db/package.json",
  "packages/engine/package.json",
  "packages/i18n/package.json",
  "packages/observability/package.json",
  "packages/sources/package.json",
];

const HTTP_METHODS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

function fail(message) {
  throw new Error(message);
}

function invariant(condition, message) {
  if (!condition) fail(message);
}

function parseRoot(argv) {
  if (argv.length === 0) return SCRIPT_REPO_ROOT;
  if (argv.length === 2 && argv[0] === "--root" && argv[1]) {
    return resolve(argv[1]);
  }
  fail("usage: node scripts/verify-implementation.mjs [--root <repository>]");
}

const root = parseRoot(process.argv.slice(2));

function fromRoot(relativePath) {
  return resolve(root, relativePath);
}

function read(relativePath) {
  return readFileSync(fromRoot(relativePath), "utf8");
}

function readJson(relativePath) {
  try {
    return JSON.parse(read(relativePath));
  } catch (error) {
    fail(
      `${relativePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function difference(left, right) {
  const rightSet = new Set(right);
  return [...new Set(left)].filter((value) => !rightSet.has(value));
}

function assertExactSet(actual, expected, label) {
  const missing = difference(expected, actual);
  const extra = difference(actual, expected);
  const duplicates = actual.filter(
    (value, index) => actual.indexOf(value) !== index,
  );
  invariant(
    missing.length === 0 && extra.length === 0 && duplicates.length === 0,
    `${label} drift (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}; duplicates: ${[...new Set(duplicates)].join(", ") || "none"})`,
  );
}

function assertExactOrder(actual, expected, label) {
  assertExactSet(actual, expected, label);
  invariant(
    actual.every((value, index) => value === expected[index]),
    `${label} order drift (expected ${expected.join(" -> ")}; got ${actual.join(" -> ")})`,
  );
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function bundleOpenApi() {
  const redocly = resolve(
    SCRIPT_REPO_ROOT,
    "node_modules/.bin/redocly",
  );
  const temporaryDirectory = mkdtempSync(
    resolve(tmpdir(), "signalframe-openapi-"),
  );
  const output = resolve(temporaryDirectory, "mvp.json");
  try {
    execFileSync(
      redocly,
      [
        "bundle",
        fromRoot("openapi/mvp.yaml"),
        "--ext",
        "json",
        "--output",
        output,
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1" },
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return JSON.parse(readFileSync(output, "utf8"));
  } catch (error) {
    fail(`cannot parse OpenAPI with the local Redocly CLI: ${formatError(error)}`);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function checkOpenApi() {
  const source = read("openapi/mvp.yaml");
  invariant(
    !/\$ref\s*:\s*["']?https?:\/\//i.test(source),
    "OpenAPI must not contain external HTTP references",
  );
  const document = bundleOpenApi();
  invariant(document.openapi === "3.1.0", "OpenAPI version must be 3.1.0");
  invariant(
    document.info?.version === PRODUCT_VERSION,
    `OpenAPI info.version must be ${PRODUCT_VERSION}`,
  );

  const operations = [];
  for (const [pathName, pathItem] of Object.entries(document.paths ?? {})) {
    invariant(
      pathItem && typeof pathItem === "object",
      `OpenAPI path ${pathName} must be an object`,
    );
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) continue;
      invariant(
        operation && typeof operation === "object",
        `${method.toUpperCase()} ${pathName} must be an operation object`,
      );
      invariant(
        typeof operation.operationId === "string" &&
          operation.operationId.length > 0,
        `${method.toUpperCase()} ${pathName} is missing operationId`,
      );
      operations.push({
        operationId: operation.operationId,
        responses: operation.responses ?? {},
      });
    }
  }

  const operationIds = operations.map((operation) => operation.operationId);
  invariant(
    operationIds.length === 26,
    `expected 26 OpenAPI operations, found ${operationIds.length}`,
  );
  assertExactSet(
    operationIds,
    EXPECTED_OPENAPI_OPERATIONS,
    "OpenAPI operationIds",
  );

  const asyncOperations = operations.filter(
    (operation) => operation.responses["202"] !== undefined,
  );
  invariant(
    asyncOperations.length === 5,
    `expected 5 async 202 operations, found ${asyncOperations.length}`,
  );
  assertExactSet(
    asyncOperations.map((operation) => operation.operationId),
    EXPECTED_ASYNC_OPERATIONS,
    "OpenAPI async operationIds",
  );
  for (const operation of asyncOperations) {
    invariant(
      operation.responses["202"]?.$ref ===
        "#/components/responses/AsyncAccepted",
      `${operation.operationId} must use the shared AsyncAccepted 202 response`,
    );
  }

  const asyncData =
    document.components?.schemas?.AsyncAcceptedResponse?.properties?.data;
  invariant(
    Array.isArray(asyncData?.required) &&
      asyncData.required.includes("statusUrl"),
    "AsyncAcceptedResponse.data must require statusUrl",
  );
  invariant(
    typeof asyncData?.properties?.statusUrl?.pattern === "string" &&
      asyncData.properties.statusUrl.pattern.includes("/runs/"),
    "AsyncAcceptedResponse.statusUrl must point to the canonical run endpoint",
  );

  return "OpenAPI: 26 operations, 5 shared 202 statusUrl operations";
}

function checkAsyncRouteImplementations() {
  invariant(
    EXPECTED_ASYNC_ROUTE_IMPLEMENTATIONS.length === 5,
    "expected exactly 5 runtime async route implementations",
  );
  assertExactSet(
    EXPECTED_ASYNC_ROUTE_IMPLEMENTATIONS.map((route) => route.operationId),
    EXPECTED_ASYNC_OPERATIONS,
    "runtime async route operationIds",
  );
  assertExactSet(
    EXPECTED_ASYNC_ROUTE_IMPLEMENTATIONS.map((route) => route.file),
    [
      ...new Set(
        EXPECTED_ASYNC_ROUTE_IMPLEMENTATIONS.map((route) => route.file),
      ),
    ],
    "runtime async route files",
  );

  for (const route of EXPECTED_ASYNC_ROUTE_IMPLEMENTATIONS) {
    const source = read(route.file);
    invariant(
      /import\s*\{[^}]*\basyncAccepted\b[^}]*\}\s*from\s*["']@\/lib\/http\/respond["'];?/s.test(
        source,
      ),
      `${route.operationId} must import the shared asyncAccepted responder`,
    );
    const sharedReturns = source.match(
      /\breturn\s+asyncAccepted\s*\(/g,
    ) ?? [];
    invariant(
      sharedReturns.length === 1,
      `${route.operationId} must return through asyncAccepted exactly once (found ${sharedReturns.length})`,
    );
    invariant(
      !/\bNextResponse\s*\.\s*json\s*\(/.test(source),
      `${route.operationId} must not construct a direct NextResponse.json response`,
    );
    invariant(
      !/\bstatus\s*:\s*202\b/.test(source),
      `${route.operationId} must not construct a direct 202 response`,
    );
  }

  const responder = read("apps/web/src/lib/http/respond.ts");
  invariant(
    /export\s+function\s+asyncAccepted\b/.test(responder) &&
      /\breturn\s+ok\s*\(/.test(responder) &&
      /\bstatus\s*:\s*202\b/.test(responder) &&
      /headers\s*:\s*\{\s*Location\s*:\s*location\s*,\s*["']Retry-After["']\s*:\s*["']1["']\s*\}/s.test(
        responder,
      ),
    "shared asyncAccepted responder must preserve the { data } envelope, 202 status, Location, and Retry-After",
  );

  return "async runtime: 5 route handlers use the shared asyncAccepted envelope";
}

function checkRunPollingImplementation() {
  const source = read(RUN_STATUS_ROUTE_FILE);
  invariant(
    /import\s*\{[^}]*\brunPollingHeaders\b[^}]*\}\s*from\s*["']@\/lib\/services\/runs["'];?/s.test(
      source,
    ),
    "canonical run status route must import runPollingHeaders",
  );
  invariant(
    /headers\s*:\s*runPollingHeaders\s*\(\s*run\.status\s*\)\s*\?\?\s*\{\s*\}/s.test(
      source,
    ),
    "canonical run status route must derive response headers from runPollingHeaders(run.status)",
  );
  invariant(
    !/["']Retry-After["']\s*:/.test(source),
    "canonical run status route must not duplicate Retry-After state logic",
  );

  const service = read("apps/web/src/lib/services/runs.ts");
  invariant(
    /export\s+function\s+runPollingHeaders\b/.test(service),
    "runPollingHeaders must remain an exported shared service helper",
  );

  return "run polling: canonical status route delegates Retry-After state handling";
}

async function checkWebProxyImplementation() {
  const boundaryPattern = /^(?:proxy|middleware)\.(?:[cm]?[jt]sx?)$/;
  const boundaryEntrypoints = ["apps/web", "apps/web/src"].flatMap(
    (directory) =>
      readdirSync(fromRoot(directory))
        .filter((fileName) => boundaryPattern.test(fileName))
        .map((fileName) => `${directory}/${fileName}`),
  );
  invariant(
    existsSync(fromRoot(WEB_PROXY_FILE)),
    `Next.js request boundary must exist at ${WEB_PROXY_FILE}`,
  );
  assertExactSet(
    boundaryEntrypoints,
    [WEB_PROXY_FILE],
    "Next.js request boundary entrypoints",
  );

  const proxy = read(WEB_PROXY_FILE);
  invariant(
    /import\s*\{\s*buildContentSecurityPolicy\s*\}\s*from\s*["']\.\.\/security-headers\.ts["'];?/.test(
      proxy,
    ),
    "src/proxy.ts must import the shared CSP builder",
  );
  invariant(
    /buildContentSecurityPolicy\s*\(\s*process\.env\[\s*["']NODE_ENV["']\s*\]\s*===\s*["']development["']\s*,\s*nonce\s*,?\s*\)/s.test(
      proxy,
    ),
    "src/proxy.ts must enable CSP relaxations only in explicit development mode",
  );
  invariant(
    /function\s+requestHeaderOverrides\s*\([^)]*\bcsp\s*:\s*string[^)]*\)[\s\S]*?headers\.set\s*\(\s*["']Content-Security-Policy["']\s*,\s*csp\s*\)[\s\S]*?return\s+headers\s*;/s.test(
      proxy,
    ),
    "src/proxy.ts must propagate CSP through request header overrides",
  );
  invariant(
    /NextResponse\.next\s*\(\s*\{\s*request\s*:\s*\{\s*headers\s*\}\s*\}\s*\)/s.test(
      proxy,
    ),
    "src/proxy.ts must pass overridden request headers to NextResponse.next",
  );
  invariant(
    /function\s+secure\s*\([^)]*\bresponse\s*:\s*NextResponse[^)]*\bcsp\s*:\s*string[^)]*\)[\s\S]*?response\.headers\.set\s*\(\s*["']Content-Security-Policy["']\s*,\s*csp\s*\)[\s\S]*?return\s+response\s*;/s.test(
      proxy,
    ) && /\breturn\s+secure\s*\(/.test(proxy),
    "src/proxy.ts must attach the same CSP to outgoing responses",
  );

  const securityHeaders = read("apps/web/security-headers.ts");
  invariant(
    /export\s+function\s+buildContentSecurityPolicy\b/.test(securityHeaders),
    "buildContentSecurityPolicy must remain an exported shared builder",
  );
  const securityHeadersUrl = pathToFileURL(
    fromRoot("apps/web/security-headers.ts"),
  );
  securityHeadersUrl.searchParams.set("implementation-check", String(Date.now()));
  const securityHeadersModule = await import(securityHeadersUrl.href);
  const buildCsp = securityHeadersModule.buildContentSecurityPolicy;
  invariant(
    typeof buildCsp === "function",
    "buildContentSecurityPolicy must be executable by the implementation gate",
  );

  const nonce = "implementation-check-nonce";
  const productionCsp = buildCsp(false, nonce);
  const developmentCsp = buildCsp(true, nonce);
  const directive = (csp, name) =>
    csp
      .split(";")
      .map((value) => value.trim())
      .find((value) => value === name || value.startsWith(`${name} `)) ?? "";
  const productionScript = directive(productionCsp, "script-src");
  const productionStyle = directive(productionCsp, "style-src");
  const developmentScript = directive(developmentCsp, "script-src");
  const developmentStyle = directive(developmentCsp, "style-src");

  invariant(
    productionScript.includes(`'nonce-${nonce}'`) &&
      productionScript.includes("'strict-dynamic'") &&
      !productionScript.includes("'unsafe-eval'") &&
      !productionScript.includes("'unsafe-inline'"),
    "production script-src must be nonce/strict-dynamic gated without unsafe relaxations",
  );
  invariant(
    productionStyle === `style-src 'self' 'nonce-${nonce}'`,
    "production style-src must remain nonce-gated without unsafe-inline",
  );
  invariant(
    developmentScript.includes(`'nonce-${nonce}'`) &&
      developmentScript.includes("'strict-dynamic'") &&
      developmentScript.includes("'unsafe-eval'"),
    "development script-src must retain the Next runtime relaxation and nonce",
  );
  invariant(
    developmentStyle === "style-src 'self' 'unsafe-inline'" &&
      !developmentStyle.includes("'nonce-"),
    "development style-src must permit Next DevTools styles without a nonce",
  );

  const devAuthUrl = pathToFileURL(
    fromRoot("apps/web/src/lib/auth/dev.ts"),
  );
  devAuthUrl.searchParams.set("implementation-check", String(Date.now()));
  const devAuthModule = await import(devAuthUrl.href);
  const isDevAuthEnabled = devAuthModule.isDevAuthEnabled;
  invariant(
    typeof isDevAuthEnabled === "function",
    "the local development auth gate must remain executable",
  );
  const localDevelopment = {
    NODE_ENV: "development",
    APP_ORIGIN: "http://127.0.0.1:3000",
    SF_DEV_AUTH: "true",
  };
  invariant(
    isDevAuthEnabled(localDevelopment) === true,
    "the explicit loopback development harness must remain available",
  );
  for (const unsafeEnvironment of [
    { ...localDevelopment, NODE_ENV: "test" },
    { ...localDevelopment, NODE_ENV: "staging" },
    { ...localDevelopment, NODE_ENV: "production" },
    { ...localDevelopment, APP_ORIGIN: "https://staging.example.com" },
    { ...localDevelopment, APP_ORIGIN: "https://localhost.example.com" },
  ]) {
    invariant(
      isDevAuthEnabled(unsafeEnvironment) === false,
      "SF_DEV_AUTH must fail closed outside exact loopback development",
    );
  }

  const webPackage = readJson("apps/web/package.json");
  invariant(
    typeof webPackage.scripts?.dev === "string" &&
      /\bnext\s+dev\b/.test(webPackage.scripts.dev) &&
      /(?:--hostname|-H)\s+127\.0\.0\.1\b/.test(webPackage.scripts.dev),
    "the supported Next development command must bind to 127.0.0.1 when local dev auth can be enabled",
  );

  const session = read("apps/web/src/lib/auth/session.ts");
  invariant(
    /if\s*\(\s*isDevAuthEnabled\(\)\s*\)/.test(session),
    "operator bootstrap must remain behind the shared local-development gate",
  );
  invariant(
    /if\s*\(\s*isDevAuthEnabled\(\)\s*\)/.test(proxy),
    "the proxy auth bypass must remain behind the shared local-development gate",
  );
  const e2eShell = read("apps/web/src/app/p/[projectId]/_e2e-shell.ts");
  invariant(
    /isLoopbackDevelopmentRuntime\s*\(\s*env\s*\)/.test(e2eShell) &&
      /env\[\s*["']SF_E2E_MOCK_API["']\s*\]\s*===\s*["']true["']/.test(
        e2eShell,
      ),
    "the mock project shell must remain behind the loopback-development gate",
  );

  return "web boundary: src/proxy.ts propagates nonce CSP without production unsafe relaxations";
}

function stripCodeComments(source) {
  let result = "";
  let state = "code";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (state === "line-comment") {
      if (char === "\n" || char === "\r") {
        state = "code";
        result += char;
      } else {
        result += " ";
      }
      continue;
    }
    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        result += "  ";
        index += 1;
        state = "code";
      } else {
        result += char === "\n" || char === "\r" ? char : " ";
      }
      continue;
    }
    if (state === "single-quote" || state === "double-quote" || state === "template") {
      result += char;
      if (char === "\\") {
        if (next !== undefined) {
          result += next;
          index += 1;
        }
        continue;
      }
      if (
        (state === "single-quote" && char === "'") ||
        (state === "double-quote" && char === '"') ||
        (state === "template" && char === "`")
      ) {
        state = "code";
      }
      continue;
    }

    if (char === "/" && next === "/") {
      result += "  ";
      index += 1;
      state = "line-comment";
    } else if (char === "/" && next === "*") {
      result += "  ";
      index += 1;
      state = "block-comment";
    } else {
      result += char;
      if (char === "'") state = "single-quote";
      else if (char === '"') state = "double-quote";
      else if (char === "`") state = "template";
    }
  }
  return result;
}

function walkSourceFiles(relativeDirectory) {
  const files = [];
  for (const entry of readdirSync(fromRoot(relativeDirectory), {
    withFileTypes: true,
  })) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".next" ||
        entry.name === "dist" ||
        entry.name === "coverage"
      ) {
        continue;
      }
      files.push(...walkSourceFiles(relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

function checkIntegrationDatabaseSafety() {
  const config = stripCodeComments(read("vitest.config.ts"));
  const integrationMarkers = [
    ...config.matchAll(/\bname\s*:\s*["']integration["']/g),
  ];
  invariant(
    integrationMarkers.length === 1,
    `vitest.config.ts must define exactly one integration project (found ${integrationMarkers.length})`,
  );

  const integrationStart = integrationMarkers[0].index;
  const remaining = config.slice(integrationStart + 1);
  const nextProjectMarker = remaining.search(
    /\bname\s*:\s*["'][^"']+["']/,
  );
  const integrationProject = config.slice(
    integrationStart,
    nextProjectMarker === -1
      ? undefined
      : integrationStart + 1 + nextProjectMarker,
  );
  invariant(
    new RegExp(
      `\\bsetupFiles\\s*:\\s*\\[\\s*["']${INTEGRATION_SETUP_CONFIG_PATH.replaceAll(
        ".",
        "\\.",
      )}["']\\s*\\]`,
    ).test(integrationProject),
    `the Vitest integration project must load ${INTEGRATION_SETUP_CONFIG_PATH} through setupFiles`,
  );

  const setup = stripCodeComments(read(INTEGRATION_SETUP_FILE));
  invariant(
    /\bimport\s*\{\s*requireSafeTestDatabaseUrl\s*\}\s*from\s*["']\.\/test-database-safety\.ts["'];?/.test(
      setup,
    ),
    `${INTEGRATION_SETUP_FILE} must import requireSafeTestDatabaseUrl from test-database-safety.ts`,
  );
  invariant(
    /\brequireSafeTestDatabaseUrl\s*\(\s*process\.env\s*\[\s*["']DATABASE_URL["']\s*\]/.test(
      setup,
    ),
    `${INTEGRATION_SETUP_FILE} must call requireSafeTestDatabaseUrl for process.env["DATABASE_URL"]`,
  );

  const integrationSources = ["apps", "packages"]
    .flatMap(walkSourceFiles)
    .filter(
      (relativePath) =>
        /(?:^|[./_-])integration(?:[./_-]|$)/i.test(relativePath) ||
        /(?:^|[./_-])harness(?:[./_-]|$)/i.test(relativePath),
    )
    .filter((relativePath) => /\.[cm]?[jt]sx?$/.test(relativePath));
  const unsafeDefaults = integrationSources.filter((relativePath) =>
    /signalframe_mvp_dev/.test(read(relativePath)),
  );
  invariant(
    unsafeDefaults.length === 0,
    `integration tests and harnesses must not contain a signalframe_mvp_dev fallback (${unsafeDefaults.join(
      ", ",
    )})`,
  );

  return `integration safety: Vitest preflight validates DATABASE_URL; ${integrationSources.length} integration/harness sources have no dev-database fallback`;
}

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n\r]*/g, "");
}

function checkDatabaseContract() {
  const migrationsDirectory = fromRoot("packages/db/migrations");
  const migrationFiles = readdirSync(migrationsDirectory)
    .filter(
      (fileName) =>
        fileName.endsWith(".sql") && fileName !== "schema-smoke.sql",
    )
    .sort();
  invariant(migrationFiles.length > 0, "at least one SQL migration is required");
  const migration = stripSqlComments(
    migrationFiles
      .map((fileName) =>
        read(`packages/db/migrations/${fileName}`),
      )
      .join("\n"),
  );
  const tables = [
    ...migration.matchAll(
      /\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+app\.([a-z][a-z0-9_]*)\s*\(/gi,
    ),
  ].map((match) => match[1]);
  invariant(
    tables.length === EXPECTED_TABLES.length,
    `expected ${EXPECTED_TABLES.length} app tables in the migrations, found ${tables.length}`,
  );
  assertExactSet(tables, EXPECTED_TABLES, "application tables");
  invariant(
    !tables.some((table) => table.startsWith("pgboss") || table === "job"),
    "pg-boss tables must not be counted as application tables",
  );

  const smoke = read("packages/db/migrations/schema-smoke.sql");
  invariant(
    /\bROLLBACK\s*;\s*$/.test(smoke),
    "schema-smoke.sql must finish with ROLLBACK",
  );
  return `database: ${EXPECTED_TABLES.length} app tables (pg-boss excluded)`;
}

async function importSource(relativePath) {
  const url = pathToFileURL(fromRoot(relativePath));
  url.searchParams.set("implementation-check", String(Date.now()));
  return import(url.href);
}

function loadRuleContract() {
  const registryUrl = pathToFileURL(
    fromRoot("packages/engine/src/registry.ts"),
  ).href;
  const rulesUrl = pathToFileURL(
    fromRoot("packages/engine/src/rules/index.ts"),
  ).href;
  const evaluation = `
    import * as registryModule from ${JSON.stringify(registryUrl)};
    import { ALL_RULES } from ${JSON.stringify(rulesUrl)};
    process.stdout.write(JSON.stringify({
      RULE_SET_VERSION: registryModule.RULE_SET_VERSION,
      PROMPT_SET_VERSION: registryModule.PROMPT_SET_VERSION,
      FINDING_REGISTRY: registryModule.FINDING_REGISTRY,
      ALL_RULES: ALL_RULES.map(({ id, version, domain }) => ({ id, version, domain })),
    }));
  `;
  try {
    const output = execFileSync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        "--input-type=module",
        "--eval",
        evaluation,
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1" },
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return JSON.parse(output);
  } catch (error) {
    fail(`cannot load executable rules through tsx: ${formatError(error)}`);
  }
}

function checkRuleContract() {
  const registryModule = loadRuleContract();
  invariant(
    registryModule.RULE_SET_VERSION === RULE_SET_VERSION,
    `RULE_SET_VERSION must be ${RULE_SET_VERSION}`,
  );
  invariant(
    registryModule.PROMPT_SET_VERSION === PROMPT_SET_VERSION,
    `PROMPT_SET_VERSION must be ${PROMPT_SET_VERSION}`,
  );

  const registry = registryModule.FINDING_REGISTRY;
  invariant(
    registry && typeof registry === "object",
    "FINDING_REGISTRY must be an object",
  );
  assertExactSet(Object.keys(registry), EXPECTED_RULES, "finding registry");

  const rules = registryModule.ALL_RULES;
  invariant(Array.isArray(rules), "ALL_RULES must be an array");
  const ruleIds = rules.map((rule) => rule.id);
  invariant(
    ruleIds.length === 11,
    `expected 11 executable rules, found ${ruleIds.length}`,
  );
  assertExactOrder(ruleIds, EXPECTED_RULES, "executable frozen rules");
  for (const rule of rules) {
    invariant(rule.version === 1, `${rule.id} must remain at rule version 1`);
    invariant(
      registry[rule.id]?.domain === rule.domain,
      `${rule.id} domain differs between ALL_RULES and FINDING_REGISTRY`,
    );
  }
  return "diagnostics: 11 executable frozen rules in canonical order";
}

async function checkVersions() {
  for (const packagePath of WORKSPACE_PACKAGES) {
    const packageJson = readJson(packagePath);
    invariant(
      packageJson.version === PRODUCT_VERSION,
      `${packagePath} version must be ${PRODUCT_VERSION}`,
    );
  }

  const health = await importSource("packages/contracts/src/zod/health.ts");
  invariant(
    health.PRODUCT_VERSION === PRODUCT_VERSION,
    `health PRODUCT_VERSION must be ${PRODUCT_VERSION}`,
  );
  invariant(
    health.CONTRACT_VERSION === CONTRACT_VERSION,
    `health CONTRACT_VERSION must be ${CONTRACT_VERSION}`,
  );

  const schema = readJson("schemas/service-bundle-manifest.schema.json");
  invariant(
    schema.properties?.schemaVersion?.const === BUNDLE_SCHEMA_VERSION,
    `bundle schemaVersion must be ${BUNDLE_SCHEMA_VERSION}`,
  );
  invariant(
    schema.properties?.productVersion?.const === PRODUCT_VERSION,
    `bundle productVersion must be ${PRODUCT_VERSION}`,
  );
  invariant(
    schema.properties?.contractVersion?.const === CONTRACT_VERSION,
    `bundle contractVersion must be ${CONTRACT_VERSION}`,
  );
  invariant(
    schema.properties?.ruleSetVersion?.const === RULE_SET_VERSION,
    `bundle ruleSetVersion must be ${RULE_SET_VERSION}`,
  );
  invariant(
    typeof schema.$id === "string" && schema.$id.endsWith(`/${PRODUCT_VERSION}`),
    `bundle schema $id must end with /${PRODUCT_VERSION}`,
  );

  return `versions: product ${PRODUCT_VERSION}, contract ${CONTRACT_VERSION}`;
}

function assertSafeRelativePath(value, label) {
  invariant(
    typeof value === "string" && value.trim().length > 0,
    `${label} must be a non-empty string`,
  );
  invariant(!isAbsolute(value), `${label} must be repository-relative`);
  const normalized = resolve(root, value);
  const rel = relative(root, normalized);
  invariant(
    rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel),
    `${label} escapes the repository root`,
  );
  return normalized;
}

function checkVendorManifest() {
  const manifestPath = "docs/vendor/signalframe-manifest.json";
  const manifest = readJson(manifestPath);
  invariant(
    typeof manifest.purpose === "string" && manifest.purpose.trim().length > 0,
    "vendor manifest purpose is required",
  );
  invariant(
    typeof manifest.sourceRepo === "string" &&
      manifest.sourceRepo.trim().length > 0,
    "vendor manifest sourceRepo is required",
  );
  invariant(
    /^[0-9a-f]{40}$/.test(manifest.sourceRepoHeadAtBaseline ?? ""),
    "vendor manifest sourceRepoHeadAtBaseline must be a 40-character git SHA",
  );
  invariant(
    Array.isArray(manifest.allowedSources) &&
      manifest.allowedSources.length > 0 &&
      manifest.allowedSources.every(
        (entry) => typeof entry === "string" && entry.trim().length > 0,
      ),
    "vendor manifest allowedSources must be a non-empty string array",
  );
  invariant(
    Array.isArray(manifest.entries) && manifest.entries.length > 0,
    "vendor manifest entries must be a non-empty array",
  );

  const rootRealPath = `${realpathSync(root)}${sep}`;
  const targetPaths = [];
  for (const [index, entry] of manifest.entries.entries()) {
    const label = `vendor entry ${index + 1}`;
    invariant(
      entry && typeof entry === "object" && !Array.isArray(entry),
      `${label} must be an object`,
    );
    invariant(
      /^[0-9a-f]{40}$/.test(entry.sourceCommit ?? ""),
      `${label}.sourceCommit must be a 40-character git SHA`,
    );
    invariant(
      entry.sourceCommit === manifest.sourceRepoHeadAtBaseline,
      `${label}.sourceCommit differs from sourceRepoHeadAtBaseline`,
    );
    assertSafeRelativePath(entry.sourcePath, `${label}.sourcePath`);
    const target = assertSafeRelativePath(
      entry.targetPath,
      `${label}.targetPath`,
    );
    targetPaths.push(entry.targetPath);
    invariant(
      typeof entry.adaptation === "string" &&
        entry.adaptation.trim().length > 0,
      `${label}.adaptation is required`,
    );
    invariant(
      /^[0-9a-f]{64}$/.test(entry.sha256 ?? ""),
      `${label}.sha256 must be a lowercase SHA-256 digest`,
    );

    let targetRealPath;
    try {
      targetRealPath = realpathSync(target);
      invariant(statSync(targetRealPath).isFile(), `${entry.targetPath} is not a file`);
    } catch (error) {
      fail(`${label} target is unreadable (${entry.targetPath}): ${formatError(error)}`);
    }
    invariant(
      targetRealPath.startsWith(rootRealPath),
      `${label}.targetPath resolves outside the repository`,
    );
    const actualHash = createHash("sha256")
      .update(readFileSync(targetRealPath))
      .digest("hex");
    invariant(
      actualHash === entry.sha256,
      `${label} hash drift for ${entry.targetPath}: expected ${entry.sha256}, found ${actualHash}`,
    );
  }

  assertExactSet(targetPaths, [...new Set(targetPaths)], "vendor targets");
  for (const requiredTarget of [
    "packages/sources/src/url-safety/pin-agent.ts",
    "packages/sources/src/crawl/engine.ts",
  ]) {
    invariant(
      targetPaths.includes(requiredTarget),
      `vendor manifest is missing required target ${requiredTarget}`,
    );
  }
  return `vendor provenance: ${manifest.entries.length} target hashes current`;
}

function checkE2eDatabaseSafety() {
  const realConfig = read("playwright.config.ts");
  invariant(
    /requireSafeTestDatabaseUrl\s*\(\s*process\.env\["E2E_DATABASE_URL"\]/s.test(
      realConfig,
    ),
    "database-backed Playwright must fail closed through E2E_DATABASE_URL",
  );
  invariant(
    /reuseExistingServer\s*:\s*false\b/.test(realConfig),
    "database-backed Playwright must never reuse an unknown local server",
  );
  invariant(
    !/\bglobalTeardown\s*:/.test(realConfig) &&
      /\["\.\/e2e\/real-global-teardown\.ts"\]/.test(realConfig),
    "database-backed E2E cleanup must run as a reporter after webServer teardown",
  );

  const mockConfig = read("playwright.mock.config.ts");
  invariant(
    /reuseExistingServer\s*:\s*false\b/.test(mockConfig),
    "mock Playwright must never reuse an unknown local server",
  );
  invariant(
    !/\bglobalTeardown\s*:/.test(mockConfig) &&
      /\["\.\/e2e\/mock-global-teardown\.ts"\]/.test(mockConfig),
    "mock E2E cleanup must run as a reporter after webServer teardown",
  );

  const cleanupReporter = read("e2e/cleanup-reporter.ts");
  invariant(
    /async onEnd\([\s\S]*await cleanupE2eArtifacts\(this\.paths\)/.test(
      cleanupReporter,
    ),
    "E2E artifact cleanup reporter must remove artifacts from reporter.onEnd",
  );
  return "E2E safety: guarded disposable DB, no unknown server reuse, ordered cleanup";
}

const checks = [
  ["OpenAPI contract", checkOpenApi],
  ["async route implementations", checkAsyncRouteImplementations],
  ["run polling implementation", checkRunPollingImplementation],
  ["web proxy implementation", checkWebProxyImplementation],
  ["integration database safety", checkIntegrationDatabaseSafety],
  ["E2E database safety", checkE2eDatabaseSafety],
  ["database contract", checkDatabaseContract],
  ["diagnostic rules", checkRuleContract],
  ["product/contract versions", checkVersions],
  ["vendor manifest", checkVendorManifest],
];

const failures = [];
const summaries = [];
for (const [label, check] of checks) {
  try {
    summaries.push(await check());
  } catch (error) {
    failures.push(`${label}: ${formatError(error)}`);
  }
}

if (failures.length > 0) {
  console.error(
    `SignalFrame implementation consistency FAILED (${failures.length} section${failures.length === 1 ? "" : "s"}):`,
  );
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("SignalFrame implementation consistency passed:");
for (const summary of summaries) console.log(`- ${summary}`);
console.log("- generated OpenAPI types: enforced separately by contracts:check");
