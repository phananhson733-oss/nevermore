import { z } from "zod";
import {
  postgresUrlIssue,
  runtimeHttpUrlIssue,
  type RuntimeHttpUrlPolicy,
} from "@sf/contracts/runtime-url";

/**
 * Server env contract for the web service (spec §3.4). Fail-fast at first import
 * on the server; secrets live only in the platform secret store / .env.local.
 * This module must never be imported from client components.
 */

const base64Bytes = (expected: number) =>
  z.string().refine(
    (value) => {
      try {
        return Buffer.from(value, "base64").length === expected;
      } catch {
        return false;
      }
    },
    { message: `must be ${expected}-byte base64` },
  );

function runtimeUrl(
  environment: string | undefined,
  policy?: RuntimeHttpUrlPolicy,
) {
  return z.string().superRefine((value, ctx) => {
    const message = runtimeHttpUrlIssue(value, environment, policy);
    if (message) ctx.addIssue({ code: "custom", message });
  });
}

const postgresUrl = () =>
  z.string().superRefine((value, ctx) => {
    const message = postgresUrlIssue(value);
    if (message) ctx.addIssue({ code: "custom", message });
  });

export function createWebEnvSchema(environment: string | undefined) {
  return z.object({
    APP_ORIGIN: runtimeUrl(environment, { originOnly: true }),
    DATABASE_URL: postgresUrl(),
    // Each warm serverless instance owns a Drizzle pool and may lazily start a
    // second enqueue-only pg-boss pool. One connection per pool keeps horizontal
    // scaling inside the shared Supabase session-pool budget.
    DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(1),
    SUPABASE_URL: runtimeUrl(environment),
    SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    CREDENTIAL_ENCRYPTION_KEY: base64Bytes(32),
    GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),
    // MVP hard requirement: DataForSEO stays disabled (spec §2.2, §3.4).
    DATAFORSEO_ENABLED: z.literal("false"),
    RAW_IMPORT_BUCKET: z.string().min(1),
    EXPORT_BUCKET: z.string().min(1),
    // Production is always Supabase. Local/test may opt into Supabase, otherwise
    // they must provide one explicit absolute directory shared with the worker.
    SF_BLOB_BACKEND: z.enum(["local", "supabase"]).optional(),
    SF_BLOB_DIR: z.string().min(1).optional(),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  });
}

const EnvSchema = createWebEnvSchema(process.env["NODE_ENV"]);

export type WebEnv = z.infer<typeof EnvSchema>;

/** Minimal subset needed to build a Supabase client (safe for edge/middleware). */
export function createSupabaseClientEnvSchema(
  environment: string | undefined,
) {
  return z.object({
    SUPABASE_URL: runtimeUrl(environment),
    SUPABASE_ANON_KEY: z.string().min(1),
  });
}

const SupabaseClientEnvSchema = createSupabaseClientEnvSchema(
  process.env["NODE_ENV"],
);

export type SupabaseClientEnv = z.infer<typeof SupabaseClientEnvSchema>;

/**
 * Validate only the two Supabase browser-safe values. Used by middleware and the
 * server Supabase client so the edge runtime does not require the full server env.
 */
export function getSupabaseClientEnv(): SupabaseClientEnv {
  const parsed = SupabaseClientEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_ANON_KEY (spec §3.4)");
  }
  return parsed.data;
}

let cached: WebEnv | undefined;

/** Parse and cache the validated server environment. Throws on first invalid boot. */
export function getEnv(): WebEnv {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid web environment (spec §3.4):\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
