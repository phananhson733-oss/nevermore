import { describe, expect, it } from "vitest";
import { EnvSchema, resolveLlmClientConfig, type WorkerEnv } from "../env.ts";

/**
 * Worker LLM config (spec §10.2): the `openai` provider is reachable either via
 * direct api.openai.com (Bearer) or an Azure OpenAI deployment (api-key header +
 * Azure endpoint). This pins two invariants:
 *  - a PARTIAL Azure set is rejected at boot, never silently falling back to
 *    public OpenAI (data-residency footgun);
 *  - `resolveLlmClientConfig` builds the correct host + auth for each mode.
 * Pure — no database, no network.
 */

const BASE: Record<string, string> = {
  APP_ORIGIN: "http://localhost:3000",
  DATABASE_URL: "postgres://u@localhost:5432/db",
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  GOOGLE_OAUTH_CLIENT_ID: "id",
  GOOGLE_OAUTH_CLIENT_SECRET: "secret",
  DATAFORSEO_ENABLED: "false",
  RAW_IMPORT_BUCKET: "raw-imports",
  EXPORT_BUCKET: "exports",
};

const DIRECT = { OPENAI_API_KEY: "sk-fake", OPENAI_MODEL: "gpt-5.2" };
const AZURE = {
  AZURE_OPENAI_API_KEY: "az-fake",
  AZURE_OPENAI_ENDPOINT: "https://res.openai.azure.com/",
  AZURE_OPENAI_DEPLOYMENT: "gpt-5-2-deploy",
  OPENAI_API_VERSION: "2024-10-21",
};

describe("worker LLM env validation (spec §10.2)", () => {
  it("accepts a complete direct-OpenAI config", () => {
    expect(EnvSchema.safeParse({ ...BASE, ...DIRECT }).success).toBe(true);
  });

  it("accepts a complete Azure config", () => {
    expect(EnvSchema.safeParse({ ...BASE, ...AZURE }).success).toBe(true);
  });

  it("rejects a config with NO LLM provider set", () => {
    expect(EnvSchema.safeParse(BASE).success).toBe(false);
  });

  it("rejects a PARTIAL Azure set even when direct OpenAI is complete", () => {
    // Direct is complete, but a stray AZURE_OPENAI_API_KEY with missing
    // endpoint/deployment/version must fail fast rather than silently use direct.
    const result = EnvSchema.safeParse({
      ...BASE,
      ...DIRECT,
      AZURE_OPENAI_API_KEY: "az-fake",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /Azure OpenAI config is partial/.test(i.message))).toBe(true);
    }
  });
});

describe("resolveLlmClientConfig", () => {
  it("resolves direct OpenAI to a Bearer client with the model name", () => {
    const env = EnvSchema.parse({ ...BASE, ...DIRECT }) as WorkerEnv;
    const cfg = resolveLlmClientConfig(env);
    expect(cfg.authScheme).toBe("bearer");
    expect(cfg.apiKey).toBe("sk-fake");
    expect(cfg.model).toBe("gpt-5.2");
    expect(cfg.baseUrl).toBeUndefined();
  });

  it("resolves Azure to an api-key client with the deployment chat-completions URL", () => {
    const env = EnvSchema.parse({ ...BASE, ...AZURE }) as WorkerEnv;
    const cfg = resolveLlmClientConfig(env);
    expect(cfg.authScheme).toBe("api-key");
    expect(cfg.apiKey).toBe("az-fake");
    expect(cfg.model).toBe("gpt-5-2-deploy");
    // Trailing slash on the endpoint is stripped; api-version is appended.
    expect(cfg.baseUrl).toBe(
      "https://res.openai.azure.com/openai/deployments/gpt-5-2-deploy/chat/completions?api-version=2024-10-21",
    );
  });

  it("prefers Azure when both direct and Azure are fully configured", () => {
    const env = EnvSchema.parse({ ...BASE, ...DIRECT, ...AZURE }) as WorkerEnv;
    expect(resolveLlmClientConfig(env).authScheme).toBe("api-key");
  });
});
