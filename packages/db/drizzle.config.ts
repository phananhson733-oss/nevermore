import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit config for INTROSPECTION/typegen only. The authoritative migration
 * is the hand-maintained SQL under ./migrations (a verbatim copy of the spec's
 * schema.sql). We do NOT use drizzle-kit generate/push to author migrations, so
 * `out` points at a throwaway scratch dir to avoid clobbering the contract.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./.drizzle",
  schemaFilter: ["app"],
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "postgres://localhost:5432/signalframe",
  },
});
