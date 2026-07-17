import { z } from "zod";

/**
 * Server env contract for the worker service (spec §3.4, worker column).
 * Fail-fast at boot; secrets live only in the platform secret store / .env.local.
 *
 * Differences from the web env: the worker has no SUPABASE_ANON_KEY (browser-only)
 * and additionally owns the LLM configuration (LLM_PROVIDER / OPENAI_API_KEY /
 * OPENAI_MODEL) used by artifact generation and finding summaries (spec §10.2).
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

const EnvSchema = z.object({
  APP_ORIGIN: z.url(),
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CREDENTIAL_ENCRYPTION_KEY: base64Bytes(32),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),
  // First release fixes the provider to OpenAI; `google` is an interface-only
  // placeholder and must not be selectable in the MVP (spec §3.4, §10.2).
  LLM_PROVIDER: z.literal("openai").default("openai"),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1),
  // MVP hard requirement: DataForSEO stays disabled (spec §2.2, §3.4).
  DATAFORSEO_ENABLED: z.literal("false"),
  RAW_IMPORT_BUCKET: z.string().min(1),
  EXPORT_BUCKET: z.string().min(1),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type WorkerEnv = z.infer<typeof EnvSchema>;

let cached: WorkerEnv | undefined;

/** Parse and cache the validated worker environment. Throws on first invalid boot. */
export function getWorkerEnv(): WorkerEnv {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid worker environment (spec §3.4):\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
