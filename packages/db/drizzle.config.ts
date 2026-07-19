/**
 * Optional drizzle-kit config for ad-hoc INTROSPECTION/typegen only. The
 * authoritative migration
 * is the hand-maintained SQL under ./migrations (a verbatim copy of the spec's
 * schema.sql). We do NOT use drizzle-kit generate/push to author migrations, so
 * `out` points at a throwaway scratch dir to avoid clobbering the contract. This
 * is deliberately a plain config object: drizzle-kit is not part of the build,
 * migration, or CI runtime and can be invoked explicitly with `pnpm dlx` when an
 * operator needs introspection.
 */
export default {
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./.drizzle",
  schemaFilter: ["app"],
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "postgres://localhost:5432/signalframe",
  },
} as const;
