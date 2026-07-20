import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkerEnvSchema,
  getWorkerEnv,
  resolveLlmClientConfig,
  type WorkerEnv,
} from "./env.ts";

const BASE = {
  APP_ORIGIN: "https://app.example.com",
  DATABASE_URL: "postgresql://worker:password@db.example.com/signalframe",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  GOOGLE_OAUTH_CLIENT_ID: "client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
  OPENAI_API_KEY: "openai-key",
  OPENAI_MODEL: "gpt-model",
  DATAFORSEO_ENABLED: "false" as const,
  RAW_IMPORT_BUCKET: "raw-imports",
  EXPORT_BUCKET: "exports",
};

const AZURE = {
  AZURE_OPENAI_API_KEY: "azure-key",
  AZURE_OPENAI_ENDPOINT:
    "https://gateway.example.com/tenant/azure?route=private",
  AZURE_OPENAI_DEPLOYMENT: "gpt-blue",
  OPENAI_API_VERSION: "2025-01-01-preview",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

function stubWorkerEnv(values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) {
    vi.stubEnv(name, value);
  }
}

describe("worker production URL environment policy", () => {
  const production = createWorkerEnvSchema("production");

  it("accepts HTTPS direct and Azure configurations without locking the Azure host", () => {
    expect(production.safeParse(BASE).success).toBe(true);
    expect(production.safeParse({ ...BASE, ...AZURE }).success).toBe(true);
  });

  it("defaults each persistent worker database pool to two connections", () => {
    expect(production.parse(BASE).DB_POOL_MAX).toBe(2);
    expect(production.parse({ ...BASE, DB_POOL_MAX: "3" }).DB_POOL_MAX).toBe(3);
    expect(production.safeParse({ ...BASE, DB_POOL_MAX: "1" }).success).toBe(false);
  });

  it("defaults finding summaries on and accepts only explicit true/false values", () => {
    expect(production.parse(BASE).FINDING_SUMMARIES_ENABLED).toBe("true");
    expect(
      production.parse({ ...BASE, FINDING_SUMMARIES_ENABLED: "false" })
        .FINDING_SUMMARIES_ENABLED,
    ).toBe("false");
    expect(
      production.safeParse({ ...BASE, FINDING_SUMMARIES_ENABLED: "1" }).success,
    ).toBe(false);
  });

  it("defaults DataForSEO off without requiring provider credentials", () => {
    const { DATAFORSEO_ENABLED: _enabled, ...withoutFlag } = BASE;
    const parsed = production.parse(withoutFlag);

    expect(parsed.DATAFORSEO_ENABLED).toBe("false");
    expect(parsed.DATAFORSEO_MAX_KEYWORDS).toBe(200);
    expect(parsed.DATAFORSEO_LOGIN).toBeUndefined();
    expect(parsed.DATAFORSEO_PASSWORD).toBeUndefined();
  });

  it("requires both DataForSEO credentials when enabled", () => {
    const enabled = {
      ...BASE,
      DATAFORSEO_ENABLED: "true",
      DATAFORSEO_LOGIN: "dfs-login",
      DATAFORSEO_PASSWORD: "dfs-password",
      DATAFORSEO_MAX_KEYWORDS: "350",
    };
    const parsed = production.parse(enabled);

    expect(parsed.DATAFORSEO_ENABLED).toBe("true");
    expect(parsed.DATAFORSEO_MAX_KEYWORDS).toBe(350);
    expect(production.safeParse({ ...enabled, DATAFORSEO_LOGIN: undefined }).success).toBe(
      false,
    );
    expect(
      production.safeParse({ ...enabled, DATAFORSEO_PASSWORD: "   " }).success,
    ).toBe(false);
  });

  it.each(["0", "1001", "1.5", "not-a-number"])(
    "rejects an unsafe DataForSEO keyword limit: %s",
    (DATAFORSEO_MAX_KEYWORDS) => {
      expect(
        production.safeParse({ ...BASE, DATAFORSEO_MAX_KEYWORDS }).success,
      ).toBe(false);
    },
  );

  it("rejects ambiguous DataForSEO feature flag values", () => {
    expect(
      production.safeParse({ ...BASE, DATAFORSEO_ENABLED: "1" }).success,
    ).toBe(false);
  });

  it.each([
    ["APP_ORIGIN", "http://app.example.com"],
    ["APP_ORIGIN", "http://localhost:3000"],
    ["SUPABASE_URL", "http://project.supabase.co"],
    ["SUPABASE_URL", "http://127.0.0.1:54321"],
    ["AZURE_OPENAI_ENDPOINT", "http://azure.example.com/root?tenant=one"],
    ["AZURE_OPENAI_ENDPOINT", "http://[::1]:8080/root?tenant=one"],
  ] as const)("rejects non-HTTPS production %s", (field, value) => {
    expect(
      production.safeParse({ ...BASE, ...AZURE, [field]: value }).success,
    ).toBe(false);
  });

  it.each([
    "https://db.example.com/signalframe",
    "mysql://worker:password@db.example.com/signalframe",
    "file:///tmp/signalframe.db",
    "postgresql://postgres.apbkobhfnmcqqzqeeqss:password@aws-0-us-west-1.pooler.supabase.com:6543/postgres",
    "postgresql://postgres:password@db.abcdefghijklmnopqrst.supabase.co:6543/postgres",
  ])("rejects a non-PostgreSQL DATABASE_URL: %s", (value) => {
    expect(production.safeParse({ ...BASE, DATABASE_URL: value }).success).toBe(
      false,
    );
  });

  it("rejects malformed URLs and fragments on service endpoints", () => {
    expect(
      production.safeParse({ ...BASE, APP_ORIGIN: "not an absolute URL" })
        .success,
    ).toBe(false);
    expect(
      production.safeParse({
        ...BASE,
        SUPABASE_URL: "https://project.supabase.co#fragment",
      }).success,
    ).toBe(false);
    expect(
      production.safeParse({ ...BASE, DATABASE_URL: "not a database URL" })
        .success,
    ).toBe(false);
  });

  it("does not reflect URL credentials in validation issues", () => {
    const sentinel = "worker-credential-sentinel-never-log";
    const result = production.safeParse({
      ...BASE,
      ...AZURE,
      APP_ORIGIN: `https://${sentinel}:password@app.example.com`,
      DATABASE_URL: `mysql://${sentinel}:password@db.example.com/signalframe`,
      AZURE_OPENAI_ENDPOINT: `http://${sentinel}:password@azure.example.com`,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).not.toContain(sentinel);
    }
  });
});

describe("worker development/test URL environment policy", () => {
  it.each(["localhost", "127.0.0.1", "127.12.34.56", "[::1]"])(
    "allows loopback HTTP for %s in explicit development mode",
    (host) => {
      expect(
        createWorkerEnvSchema("development").safeParse({
          ...BASE,
          ...AZURE,
          APP_ORIGIN: `http://${host}:3000`,
          SUPABASE_URL: `http://${host}:54321/rest/v1?local=true`,
          AZURE_OPENAI_ENDPOINT: `http://${host}:8080/azure?tenant=local`,
        }).success,
      ).toBe(true);
    },
  );

  it("rejects remote HTTP even outside production", () => {
    expect(
      createWorkerEnvSchema("test").safeParse({
        ...BASE,
        ...AZURE,
        AZURE_OPENAI_ENDPOINT: "http://azure.example.com",
      }).success,
    ).toBe(false);
  });

  it.each([
    "0177.0.0.1",
    "0x7f.0.0.1",
    "2130706433",
    "127.0.0.1.",
  ])("rejects non-canonical loopback host spelling: %s", (host) => {
    expect(
      createWorkerEnvSchema("test").safeParse({
        ...BASE,
        ...AZURE,
        AZURE_OPENAI_ENDPOINT: `http://${host}:8080/azure`,
      }).success,
    ).toBe(false);
  });

  it.each([undefined, "staging"])(
    "fails closed when the runtime is not explicit development/test: %s",
    (environment) => {
      expect(
        createWorkerEnvSchema(environment).safeParse({
          ...BASE,
          ...AZURE,
          APP_ORIGIN: "http://127.0.0.1:3000",
          SUPABASE_URL: "http://127.0.0.1:54321",
          AZURE_OPENAI_ENDPOINT: "http://127.0.0.1:8080/azure",
        }).success,
      ).toBe(false);
    },
  );

  it("fails fast, then returns validated and cached runtime env values", () => {
    vi.stubEnv("APP_ORIGIN", "not an absolute URL");
    expect(() => getWorkerEnv()).toThrowError("Invalid worker environment");

    stubWorkerEnv({ ...BASE, ...AZURE });
    const env = getWorkerEnv();
    expect(env.APP_ORIGIN).toBe(BASE.APP_ORIGIN);
    expect(getWorkerEnv()).toBe(env);
  });
});

describe("Azure endpoint composition", () => {
  it("preserves a supported endpoint path/query while appending the encoded API route", () => {
    const env = createWorkerEnvSchema("production").parse({
      ...BASE,
      ...AZURE,
    }) as WorkerEnv;

    expect(resolveLlmClientConfig(env).baseUrl).toBe(
      "https://gateway.example.com/tenant/azure/openai/deployments/gpt-blue/chat/completions?route=private&api-version=2025-01-01-preview",
    );
  });
});
