import { z } from "zod";
import {
  postgresUrlIssue,
  runtimeHttpUrlIssue,
  type RuntimeHttpUrlPolicy,
} from "@sf/contracts/runtime-url";

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

export function createWorkerEnvSchema(environment: string | undefined) {
  return z
    .object({
      APP_ORIGIN: runtimeUrl(environment, { originOnly: true }),
      DATABASE_URL: postgresUrl(),
      // The persistent worker owns both a Drizzle pool and a pg-boss pool. The
      // readiness lease permanently checks out one Drizzle client, so two is the
      // safe minimum while preserving capacity for normal worker queries.
      DB_POOL_MAX: z.coerce.number().int().min(2).max(50).default(2),
      SUPABASE_URL: runtimeUrl(environment),
      SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
      CREDENTIAL_ENCRYPTION_KEY: base64Bytes(32),
      GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
      GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),
      // First release fixes the provider to OpenAI; `google` (Vertex/Gemini) is an
      // interface-only placeholder and must not be selectable in the MVP (spec
      // §3.4, §10.2). Azure OpenAI is NOT a different provider — it hosts the same
      // OpenAI models + API, so it is reached through the OpenAI provider below.
      LLM_PROVIDER: z.literal("openai").default("openai"),
      // Direct OpenAI (api.openai.com, Bearer auth).
      OPENAI_API_KEY: z.string().min(1).optional(),
      OPENAI_MODEL: z.string().min(1).optional(),
      // Azure OpenAI deployment (same OpenAI models/API; api-key header + Azure
      // endpoint). Provide the full set to route the OpenAI provider via Azure.
      AZURE_OPENAI_API_KEY: z.string().min(1).optional(),
      AZURE_OPENAI_ENDPOINT: runtimeUrl(environment).optional(),
      AZURE_OPENAI_DEPLOYMENT: z.string().min(1).optional(),
      OPENAI_API_VERSION: z.string().min(1).optional(),
      // Optional finding localization may be disabled independently from
      // artifact generation. Keep the raw env contract explicit at boot and
      // convert it to a boolean only when building WorkerContext.
      FINDING_SUMMARIES_ENABLED: z.enum(["true", "false"]).default("true"),
      // MVP hard requirement: DataForSEO stays disabled (spec §2.2, §3.4).
      DATAFORSEO_ENABLED: z.literal("false"),
      RAW_IMPORT_BUCKET: z.string().min(1),
      EXPORT_BUCKET: z.string().min(1),
      // Production is always Supabase. Local/test may opt into Supabase, otherwise
      // they must provide one explicit absolute directory shared with the web app.
      SF_BLOB_BACKEND: z.enum(["local", "supabase"]).optional(),
      SF_BLOB_DIR: z.string().min(1).optional(),
      LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    })
    .superRefine((env, ctx) => {
      const hasDirect = !!env.OPENAI_API_KEY && !!env.OPENAI_MODEL;
      const azureFields = [
        env.AZURE_OPENAI_API_KEY,
        env.AZURE_OPENAI_ENDPOINT,
        env.AZURE_OPENAI_DEPLOYMENT,
        env.OPENAI_API_VERSION,
      ];
      const azureCount = azureFields.filter(Boolean).length;
      const hasAzure = azureCount === azureFields.length;
      // Fail fast on a PARTIAL Azure set: otherwise `resolveLlmClientConfig` would
      // silently fall back to direct public OpenAI, concealing a broken Azure
      // rollout and violating an intended Azure/data-residency configuration.
      if (azureCount > 0 && !hasAzure) {
        ctx.addIssue({
          code: "custom",
          message:
            "Azure OpenAI config is partial: set ALL of AZURE_OPENAI_API_KEY + " +
            "AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_DEPLOYMENT + OPENAI_API_VERSION, or none.",
        });
      }
      if (!hasDirect && !hasAzure) {
        ctx.addIssue({
          code: "custom",
          message:
            "LLM config required: set OPENAI_API_KEY + OPENAI_MODEL (direct), or " +
            "AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_DEPLOYMENT + OPENAI_API_VERSION (Azure).",
        });
      }
    });
}

export const EnvSchema = createWorkerEnvSchema(process.env["NODE_ENV"]);

export type WorkerEnv = z.infer<typeof EnvSchema>;

/** Resolved OpenAI-provider client options (direct api.openai.com or Azure-hosted). */
export interface LlmClientConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly authScheme: "bearer" | "api-key";
}

/**
 * Derive the LLM client options from the env. Azure (when fully configured) wins;
 * otherwise direct OpenAI. Both are the `openai` provider — same models + Chat
 * Completions shape — differing only in host + auth header (spec §10.2).
 */
export function resolveLlmClientConfig(env: WorkerEnv): LlmClientConfig {
  if (
    env.AZURE_OPENAI_API_KEY &&
    env.AZURE_OPENAI_ENDPOINT &&
    env.AZURE_OPENAI_DEPLOYMENT &&
    env.OPENAI_API_VERSION
  ) {
    const endpoint = new URL(env.AZURE_OPENAI_ENDPOINT);
    const prefix = endpoint.pathname.replace(/\/+$/, "");
    endpoint.pathname =
      `${prefix}/openai/deployments/` +
      `${encodeURIComponent(env.AZURE_OPENAI_DEPLOYMENT)}/chat/completions`;
    endpoint.searchParams.set("api-version", env.OPENAI_API_VERSION);
    return {
      apiKey: env.AZURE_OPENAI_API_KEY,
      model: env.AZURE_OPENAI_DEPLOYMENT,
      baseUrl: endpoint.toString(),
      authScheme: "api-key",
    };
  }
  return {
    apiKey: env.OPENAI_API_KEY!,
    model: env.OPENAI_MODEL!,
    authScheme: "bearer",
  };
}

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
