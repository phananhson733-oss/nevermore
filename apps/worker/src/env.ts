import { z } from "zod";
import {
  postgresUrlIssue,
  runtimeHttpUrlIssue,
  type RuntimeHttpUrlPolicy,
} from "@sf/contracts/runtime-url";
import { MAX_DATAFORSEO_SOURCE_VERIFICATIONS } from "@sf/sources";

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

const PROVIDER_PLACEHOLDER =
  /(?:^|[^a-z0-9])(?:replace[\s_-]*me|change[\s_-]*me|placeholder|your[\s_-]*(?:api[\s_-]*)?(?:key|token|secret|model|deployment|endpoint|version)(?:[\s_-]*here)?|(?:api[\s_-]*)?(?:key|token|secret|model|deployment|endpoint|version)[\s_-]*here)(?:$|[^a-z0-9])/i;

/**
 * Return one fixed, secret-safe issue for provider configuration. Never return
 * or interpolate the value: getWorkerEnv() includes these messages in boot logs.
 */
function providerConfigValueIssue(value: string): string | null {
  if (value !== value.trim()) {
    return "must not contain leading or trailing whitespace";
  }
  if (/\\[nr]/i.test(value)) {
    return "must not contain literal newline escape sequences";
  }
  if (/[\r\n\u2028\u2029]/u.test(value)) {
    return "must not contain newline characters";
  }
  if (/\s/u.test(value)) {
    return "must not contain whitespace";
  }
  if (PROVIDER_PLACEHOLDER.test(value)) {
    return "must not use a placeholder value";
  }
  return null;
}

const providerConfigValue = () =>
  z.string().min(1).superRefine((value, ctx) => {
    const message = providerConfigValueIssue(value);
    if (message) ctx.addIssue({ code: "custom", message });
  });

const azureOpenAiEndpoint = (environment: string | undefined) =>
  z.string().min(1).superRefine((value, ctx) => {
    const configMessage = providerConfigValueIssue(value);
    if (configMessage) {
      ctx.addIssue({ code: "custom", message: configMessage });
      return;
    }

    // Keep the established gateway contract: deployments may use a private
    // HTTPS host with a path prefix and existing query parameters. The shared
    // runtime URL policy still rejects malformed URLs, userinfo, fragments and
    // remote HTTP, while permitting canonical loopback HTTP in development/test.
    const urlMessage = runtimeHttpUrlIssue(value, environment);
    if (urlMessage) ctx.addIssue({ code: "custom", message: urlMessage });
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
      OPENAI_API_KEY: providerConfigValue().optional(),
      OPENAI_MODEL: providerConfigValue().optional(),
      // Keep sampling policy deploy-configurable because some hosted model
      // deployments accept only their default temperature. This remains bounded
      // and applies uniformly to artifact, product-profile, and summary calls.
      OPENAI_TEMPERATURE: z.coerce.number().finite().min(0).max(2).default(0.2),
      // Azure OpenAI deployment (same OpenAI models/API; api-key header + Azure
      // endpoint). Provide the full set to route the OpenAI provider via Azure.
      // Private gateway hosts and path/query prefixes are intentionally allowed.
      AZURE_OPENAI_API_KEY: providerConfigValue().optional(),
      AZURE_OPENAI_ENDPOINT: azureOpenAiEndpoint(environment).optional(),
      AZURE_OPENAI_DEPLOYMENT: providerConfigValue().optional(),
      OPENAI_API_VERSION: providerConfigValue().optional(),
      // Optional finding localization may be disabled independently from
      // artifact generation. Keep the raw env contract explicit at boot and
      // convert it to a boolean only when building WorkerContext.
      FINDING_SUMMARIES_ENABLED: z.enum(["true", "false"]).default("true"),
      // Automated keyword governance approves ingested candidate keywords that
      // already carry immutable provider evidence, so the Keyword Library is
      // not empty merely because nobody has clicked through it. It is ON by
      // default; setting it to "false" restores fully manual governance and the
      // Analysis Refresh writes no automated decision at all.
      KEYWORD_AUTO_GOVERNANCE_ENABLED: z
        .enum(["true", "false"])
        .default("true"),
      DATAFORSEO_ENABLED: z.enum(["true", "false"]).default("false"),
      DATAFORSEO_BACKLINKS_ENABLED: z
        .enum(["true", "false"])
        .default("false"),
      DATAFORSEO_AI_CITATIONS_ENABLED: z
        .enum(["true", "false"])
        .default("false"),
      DATAFORSEO_AI_CITATION_MODEL: providerConfigValue().optional(),
      // Credentials are global provider secrets, never persisted in connection
      // config or job payloads. They become mandatory only when rollout is on.
      DATAFORSEO_LOGIN: z
        .string()
        .min(1)
        .refine((value) => value.trim().length > 0, {
          message: "must not be blank",
        })
        .optional(),
      DATAFORSEO_PASSWORD: z
        .string()
        .min(1)
        .refine((value) => value.trim().length > 0, {
          message: "must not be blank",
        })
        .optional(),
      DATAFORSEO_MAX_KEYWORDS: z.coerce
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(200),
      DATAFORSEO_MAX_COMPETITORS: z.coerce
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(100),
      DATAFORSEO_MAX_BACKLINKS: z.coerce
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(500),
      DATAFORSEO_MAX_REFERRING_DOMAINS: z.coerce
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(100),
      DATAFORSEO_MAX_BACKLINK_PAGES: z.coerce
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(500),
      DATAFORSEO_MAX_BACKLINK_SOURCE_VERIFICATIONS: z.coerce
        .number()
        .int()
        .min(0)
        .max(MAX_DATAFORSEO_SOURCE_VERIFICATIONS)
        .default(20),
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
      if (env.DATAFORSEO_ENABLED === "true") {
        if (!env.DATAFORSEO_LOGIN) {
          ctx.addIssue({
            code: "custom",
            path: ["DATAFORSEO_LOGIN"],
            message: "DATAFORSEO_LOGIN is required when DataForSEO is enabled.",
          });
        }
        if (!env.DATAFORSEO_PASSWORD) {
          ctx.addIssue({
            code: "custom",
            path: ["DATAFORSEO_PASSWORD"],
            message:
              "DATAFORSEO_PASSWORD is required when DataForSEO is enabled.",
          });
        }
      }
      if (env.DATAFORSEO_AI_CITATIONS_ENABLED === "true") {
        if (env.DATAFORSEO_ENABLED !== "true") {
          ctx.addIssue({
            code: "custom",
            path: ["DATAFORSEO_AI_CITATIONS_ENABLED"],
            message:
              "DataForSEO AI citations require DATAFORSEO_ENABLED=true.",
          });
        }
        if (!env.DATAFORSEO_AI_CITATION_MODEL) {
          ctx.addIssue({
            code: "custom",
            path: ["DATAFORSEO_AI_CITATION_MODEL"],
            message:
              "DATAFORSEO_AI_CITATION_MODEL is required when AI citations are enabled.",
          });
        }
      }
    });
}

export const EnvSchema = createWorkerEnvSchema(process.env["NODE_ENV"]);

export type WorkerEnv = z.infer<typeof EnvSchema>;

/** Resolved OpenAI-provider client options (direct api.openai.com or Azure-hosted). */
export interface LlmClientConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly temperature: number;
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
      temperature: env.OPENAI_TEMPERATURE,
      baseUrl: endpoint.toString(),
      authScheme: "api-key",
    };
  }
  return {
    apiKey: env.OPENAI_API_KEY!,
    model: env.OPENAI_MODEL!,
    temperature: env.OPENAI_TEMPERATURE,
    authScheme: "bearer",
  };
}

/** Env key for the automated keyword governance rollout switch. */
export const KEYWORD_AUTO_GOVERNANCE_ENV_KEY =
  "KEYWORD_AUTO_GOVERNANCE_ENABLED";

/**
 * Resolve the automated keyword governance switch.
 *
 * Default ON: the Owner-visible requirement is that an ingested Keyword Library
 * is populated without manual work. A booted worker has already validated this
 * key through the schema above, so only "true", "false" or absent can reach
 * here; any other value can only come from an unvalidated caller and is treated
 * as OFF, which is the behaviour that existed before the feature.
 */
export function keywordAutoGovernanceEnabled(
  source: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const raw = source[KEYWORD_AUTO_GOVERNANCE_ENV_KEY];
  return raw === undefined ? true : raw === "true";
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
