import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSupabaseClientEnvSchema,
  createWebEnvSchema,
  getEnv,
  getSupabaseClientEnv,
} from "./env.ts";

const BASE = {
  APP_ORIGIN: "https://app.example.com",
  DATABASE_URL: "postgresql://app:password@db.example.com:5432/signalframe",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  GOOGLE_OAUTH_CLIENT_ID: "client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
  DATAFORSEO_ENABLED: "false" as const,
  RAW_IMPORT_BUCKET: "raw-imports",
  EXPORT_BUCKET: "exports",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

function stubWebEnv(values: Record<string, string> = BASE): void {
  for (const [name, value] of Object.entries(values)) {
    vi.stubEnv(name, value);
  }
}

describe("web production URL environment policy", () => {
  const production = createWebEnvSchema("production");

  it("accepts HTTPS service origins and both PostgreSQL URL protocols", () => {
    expect(production.safeParse(BASE).success).toBe(true);
    expect(
      production.safeParse({
        ...BASE,
        DATABASE_URL: "postgres://app:password@db.example.com/signalframe",
      }).success,
    ).toBe(true);
  });

  it("defaults each serverless database pool to one connection", () => {
    expect(production.parse(BASE).DB_POOL_MAX).toBe(1);
    expect(production.parse({ ...BASE, DB_POOL_MAX: "2" }).DB_POOL_MAX).toBe(2);
  });

  it("defaults DataForSEO off with a bounded collection size", () => {
    const { DATAFORSEO_ENABLED: _enabled, ...withoutFlag } = BASE;
    const parsed = production.parse(withoutFlag);

    expect(parsed.DATAFORSEO_ENABLED).toBe("false");
    expect(parsed.DATAFORSEO_MAX_KEYWORDS).toBe(200);
  });

  it("accepts an explicit DataForSEO rollout and coerces its collection size", () => {
    const parsed = production.parse({
      ...BASE,
      DATAFORSEO_ENABLED: "true",
      DATAFORSEO_MAX_KEYWORDS: "350",
    });

    expect(parsed.DATAFORSEO_ENABLED).toBe("true");
    expect(parsed.DATAFORSEO_MAX_KEYWORDS).toBe(350);
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
  ] as const)("rejects non-HTTPS production %s", (field, value) => {
    expect(production.safeParse({ ...BASE, [field]: value }).success).toBe(
      false,
    );
  });

  it.each([
    "ftp://app.example.com",
    "https://operator:password@app.example.com",
    "https://app.example.com/app",
    "https://app.example.com?tenant=one",
    "https://app.example.com#fragment",
  ])("rejects APP_ORIGIN that is not a canonical HTTP(S) origin: %s", (value) => {
    expect(production.safeParse({ ...BASE, APP_ORIGIN: value }).success).toBe(
      false,
    );
  });

  it.each([
    "https://db.example.com/signalframe",
    "mysql://app:password@db.example.com/signalframe",
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
    const sentinel = "credential-sentinel-never-log";
    const result = production.safeParse({
      ...BASE,
      APP_ORIGIN: `https://${sentinel}:password@app.example.com`,
      DATABASE_URL: `mysql://${sentinel}:password@db.example.com/signalframe`,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).not.toContain(sentinel);
    }
  });
});

describe("web development/test URL environment policy", () => {
  it.each(["localhost", "127.0.0.1", "127.12.34.56", "[::1]"])(
    "allows loopback HTTP for %s in explicit test mode",
    (host) => {
      const result = createWebEnvSchema("test").safeParse({
        ...BASE,
        APP_ORIGIN: `http://${host}:3000`,
        SUPABASE_URL: `http://${host}:54321/rest/v1?local=true`,
      });
      expect(result.success).toBe(true);
    },
  );

  it("does not generalize the development exception to remote HTTP", () => {
    expect(
      createWebEnvSchema("development").safeParse({
        ...BASE,
        APP_ORIGIN: "http://dev.example.com",
        SUPABASE_URL: "http://api.example.com",
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
      createWebEnvSchema("development").safeParse({
        ...BASE,
        APP_ORIGIN: `http://${host}:3000`,
      }).success,
    ).toBe(false);
  });

  it.each([undefined, "staging"])(
    "fails closed when the runtime is not explicit development/test: %s",
    (environment) => {
      expect(
        createWebEnvSchema(environment).safeParse({
          ...BASE,
          APP_ORIGIN: "http://127.0.0.1:3000",
          SUPABASE_URL: "http://127.0.0.1:54321",
        }).success,
      ).toBe(false);
    },
  );

  it("applies the same production HTTPS rule to the edge Supabase schema", () => {
    const schema = createSupabaseClientEnvSchema("production");
    expect(
      schema.safeParse({
        SUPABASE_URL: "http://127.0.0.1:54321",
        SUPABASE_ANON_KEY: "anon",
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_ANON_KEY: "anon",
      }).success,
    ).toBe(true);
  });

  it("fails fast, then returns validated and cached runtime env values", () => {
    vi.stubEnv("APP_ORIGIN", "not an absolute URL");
    vi.stubEnv("SUPABASE_URL", "not an absolute URL");
    vi.stubEnv("SUPABASE_ANON_KEY", "");

    expect(() => getEnv()).toThrowError("Invalid web environment");
    expect(() => getSupabaseClientEnv()).toThrowError(
      "Missing SUPABASE_URL / SUPABASE_ANON_KEY",
    );

    stubWebEnv();
    const env = getEnv();
    expect(env.APP_ORIGIN).toBe(BASE.APP_ORIGIN);
    expect(getEnv()).toBe(env);
    expect(getSupabaseClientEnv()).toEqual({
      SUPABASE_URL: BASE.SUPABASE_URL,
      SUPABASE_ANON_KEY: BASE.SUPABASE_ANON_KEY,
    });
  });
});
