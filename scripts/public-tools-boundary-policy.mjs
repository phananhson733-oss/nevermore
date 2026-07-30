export const FORBIDDEN_SOURCE_IMPORTS = [
  /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']@sf\/(?:contracts|db|engine|artifacts|observability|worker)(?:\/|["'])/,
  /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']@sf\/sources["']/,
  /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']@supabase\//,
  /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](?:pg-boss|drizzle-orm)["']/,
  /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'][^"']*apps\/(?:web|worker)(?:\/|["'])/,
  /\/api\/mvp(?:\/|["'])/,
];

export const FORBIDDEN_RUNTIME_MARKERS = [
  "@sf/contracts",
  "@sf/worker",
  "@supabase/",
  "pg-boss",
  "apps/web",
  "apps/worker",
  "/api/mvp",
  "packages/contracts",
  "packages/db",
  "packages/worker",
];

export const FORBIDDEN_TRACE_PATHS = [
  "/apps/web/",
  "/apps/worker/",
  "/packages/contracts/",
  "/packages/db/",
  "/packages/engine/",
  "/packages/artifacts/",
  "/packages/observability/",
  "/packages/worker/",
  "/node_modules/@supabase/",
  "/node_modules/pg-boss/",
  "/node_modules/drizzle-orm/",
];

export function forbiddenSourcePatterns(source) {
  return FORBIDDEN_SOURCE_IMPORTS.filter((pattern) => pattern.test(source));
}

export function forbiddenRuntimeMarkers(output) {
  return FORBIDDEN_RUNTIME_MARKERS.filter((marker) => output.includes(marker));
}

export function forbiddenTracePaths(normalizedPath) {
  return FORBIDDEN_TRACE_PATHS.filter((marker) =>
    normalizedPath.includes(marker),
  );
}
