import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkerEnvSchema,
  getWorkerEnv,
  KEYWORD_AUTO_GOVERNANCE_ENV_KEY,
  keywordAutoGovernanceEnabled,
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

const AZURE_NATIVE = {
  ...AZURE,
  AZURE_OPENAI_ENDPOINT: "https://resource-name.openai.azure.com",
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

  it("accepts direct, native Azure and gateway Azure OpenAI configurations", () => {
    expect(production.safeParse(BASE).success).toBe(true);
    expect(production.safeParse({ ...BASE, ...AZURE }).success).toBe(true);
    expect(production.safeParse({ ...BASE, ...AZURE_NATIVE }).success).toBe(
      true,
    );
  });

  it("accepts a bounded deployment-specific LLM temperature", () => {
    const parsed = production.parse({
      ...BASE,
      ...AZURE_NATIVE,
      OPENAI_TEMPERATURE: "1",
    });
    expect(resolveLlmClientConfig(parsed).temperature).toBe(1);
  });

  it.each(["-0.01", "2.01", "not-a-number"])(
    "rejects an invalid LLM temperature: %s",
    (OPENAI_TEMPERATURE) => {
      expect(
        production.safeParse({ ...BASE, OPENAI_TEMPERATURE }).success,
      ).toBe(false);
    },
  );

  it("keeps a partial Azure set fail-closed even when direct OpenAI is complete", () => {
    expect(
      production.safeParse({
        ...BASE,
        AZURE_OPENAI_API_KEY: AZURE.AZURE_OPENAI_API_KEY,
      }).success,
    ).toBe(false);
  });

  it.each([
    "not an absolute URL",
    "http://gateway.example.com/tenant/azure",
    "https://gateway.example.com/tenant/azure#fragment",
    "https://user:password@gateway.example.com/tenant/azure",
  ])("rejects an unsafe Azure OpenAI endpoint: %s", (AZURE_OPENAI_ENDPOINT) => {
    expect(
      production.safeParse({
        ...BASE,
        ...AZURE,
        AZURE_OPENAI_ENDPOINT,
      }).success,
    ).toBe(false);
  });

  it.each([
    ["OPENAI_API_KEY", " direct-key"],
    ["OPENAI_API_KEY", "direct-key "],
    ["OPENAI_API_KEY", String.raw`direct\nkey`],
    ["OPENAI_API_KEY", String.raw`direct\rkey`],
    ["OPENAI_API_KEY", "direct\nkey"],
    ["OPENAI_MODEL", " gpt-model"],
    ["OPENAI_MODEL", "gpt-model "],
    ["OPENAI_MODEL", String.raw`gpt\nmodel`],
    ["AZURE_OPENAI_API_KEY", " azure-key"],
    ["AZURE_OPENAI_API_KEY", "azure-key "],
    ["AZURE_OPENAI_API_KEY", String.raw`azure\rkey`],
    ["AZURE_OPENAI_ENDPOINT", " https://gateway.example.com/tenant/azure"],
    ["AZURE_OPENAI_ENDPOINT", "https://gateway.example.com/tenant/azure "],
    ["AZURE_OPENAI_DEPLOYMENT", " gpt-blue"],
    ["AZURE_OPENAI_DEPLOYMENT", "gpt-blue "],
    ["AZURE_OPENAI_DEPLOYMENT", String.raw`gpt-blue\n`],
    ["OPENAI_API_VERSION", " 2025-01-01-preview"],
    ["OPENAI_API_VERSION", "2025-01-01-preview "],
    ["OPENAI_API_VERSION", String.raw`2025-01-01-preview\r`],
  ] as const)("rejects provider configuration contamination in %s", (field, value) => {
    expect(
      production.safeParse({
        ...BASE,
        ...AZURE,
        [field]: value,
      }).success,
    ).toBe(false);
  });

  it.each([
    ["OPENAI_API_KEY", "REPLACE_ME_WITH_OPENAI_API_KEY"],
    ["OPENAI_MODEL", "your-model-here"],
    ["AZURE_OPENAI_API_KEY", "CHANGE_ME"],
    [
      "AZURE_OPENAI_ENDPOINT",
      "https://replace-me.example.com/tenant/azure",
    ],
    ["AZURE_OPENAI_DEPLOYMENT", "placeholder"],
    ["OPENAI_API_VERSION", "YOUR_API_VERSION"],
  ] as const)("rejects an obvious placeholder in %s", (field, value) => {
    expect(
      production.safeParse({
        ...BASE,
        ...AZURE,
        [field]: value,
      }).success,
    ).toBe(false);
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

  it("defaults automated keyword governance ON and accepts only true/false", () => {
    // The Owner requirement is that an ingested Keyword Library is populated
    // without manual work, so the rollout default must be on.
    expect(production.parse(BASE).KEYWORD_AUTO_GOVERNANCE_ENABLED).toBe(
      "true",
    );
    expect(
      production.parse({ ...BASE, KEYWORD_AUTO_GOVERNANCE_ENABLED: "false" })
        .KEYWORD_AUTO_GOVERNANCE_ENABLED,
    ).toBe("false");
    expect(
      production.safeParse({
        ...BASE,
        KEYWORD_AUTO_GOVERNANCE_ENABLED: "yes",
      }).success,
    ).toBe(false);
  });

  it("defaults DataForSEO off without requiring provider credentials", () => {
    const { DATAFORSEO_ENABLED: _enabled, ...withoutFlag } = BASE;
    const parsed = production.parse(withoutFlag);

    expect(parsed.DATAFORSEO_ENABLED).toBe("false");
    expect(parsed.DATAFORSEO_MAX_KEYWORDS).toBe(200);
    expect(parsed.DATAFORSEO_MAX_COMPETITORS).toBe(100);
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
      DATAFORSEO_MAX_COMPETITORS: "125",
    };
    const parsed = production.parse(enabled);

    expect(parsed.DATAFORSEO_ENABLED).toBe("true");
    expect(parsed.DATAFORSEO_MAX_KEYWORDS).toBe(350);
    expect(parsed.DATAFORSEO_MAX_COMPETITORS).toBe(125);
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

  it.each(["0", "1001", "1.5", "not-a-number"])(
    "rejects an unsafe DataForSEO competitor limit: %s",
    (DATAFORSEO_MAX_COMPETITORS) => {
      expect(
        production.safeParse({ ...BASE, DATAFORSEO_MAX_COMPETITORS }).success,
      ).toBe(false);
    },
  );

  it.each(["1", "1000"])(
    "accepts an inclusive DataForSEO competitor limit boundary: %s",
    (DATAFORSEO_MAX_COMPETITORS) => {
      expect(
        production.parse({ ...BASE, DATAFORSEO_MAX_COMPETITORS })
          .DATAFORSEO_MAX_COMPETITORS,
      ).toBe(Number(DATAFORSEO_MAX_COMPETITORS));
    },
  );

  it("rejects ambiguous DataForSEO feature flag values", () => {
    expect(
      production.safeParse({ ...BASE, DATAFORSEO_ENABLED: "1" }).success,
    ).toBe(false);
  });

  it("uses the same 20-page verification ceiling as the Backlinks scope", () => {
    expect(
      production.parse({
        ...BASE,
        DATAFORSEO_MAX_BACKLINK_SOURCE_VERIFICATIONS: "20",
      }).DATAFORSEO_MAX_BACKLINK_SOURCE_VERIFICATIONS,
    ).toBe(20);
    expect(
      production.safeParse({
        ...BASE,
        DATAFORSEO_MAX_BACKLINK_SOURCE_VERIFICATIONS: "21",
      }).success,
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
      OPENAI_API_KEY: ` ${sentinel}`,
      APP_ORIGIN: `https://${sentinel}:password@app.example.com`,
      DATABASE_URL: `mysql://${sentinel}:password@db.example.com/signalframe`,
      AZURE_OPENAI_API_KEY: String.raw`${sentinel}\n`,
      AZURE_OPENAI_ENDPOINT: `https://${sentinel}:password@gateway.example.com/tenant/azure`,
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

  it("supports a native Azure OpenAI resource origin", () => {
    const env = createWorkerEnvSchema("production").parse({
      ...BASE,
      ...AZURE_NATIVE,
    }) as WorkerEnv;

    expect(resolveLlmClientConfig(env).baseUrl).toBe(
      "https://resource-name.openai.azure.com/openai/deployments/gpt-blue/chat/completions?api-version=2025-01-01-preview",
    );
  });

  it("keeps complete Azure configuration ahead of direct OpenAI", () => {
    const env = createWorkerEnvSchema("production").parse({
      ...BASE,
      ...AZURE,
    }) as WorkerEnv;

    expect(resolveLlmClientConfig(env)).toMatchObject({
      apiKey: AZURE.AZURE_OPENAI_API_KEY,
      model: AZURE.AZURE_OPENAI_DEPLOYMENT,
      temperature: 0.2,
      authScheme: "api-key",
    });
  });
});

describe("keywordAutoGovernanceEnabled", () => {
  it("is on when unset and off only for an explicit or unvalidated value", () => {
    expect(keywordAutoGovernanceEnabled({})).toBe(true);
    expect(
      keywordAutoGovernanceEnabled({
        [KEYWORD_AUTO_GOVERNANCE_ENV_KEY]: "true",
      }),
    ).toBe(true);
    expect(
      keywordAutoGovernanceEnabled({
        [KEYWORD_AUTO_GOVERNANCE_ENV_KEY]: "false",
      }),
    ).toBe(false);
    // A value the boot schema would already have rejected falls back to the
    // pre-feature behaviour instead of guessing that it meant "on".
    expect(
      keywordAutoGovernanceEnabled({
        [KEYWORD_AUTO_GOVERNANCE_ENV_KEY]: "TRUE",
      }),
    ).toBe(false);
  });
});
