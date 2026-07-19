import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BlobStoreConfigurationError,
  LocalFsBlobStore,
  SupabaseBlobStore,
} from "@sf/sources";
import type { DbHandle, PgBoss } from "@sf/db";
import type { Logger } from "@sf/observability";
import { buildWorkerContext, createWorkerBlobStore } from "./context.ts";
import { EnvSchema } from "./env.ts";

const ENV = {
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  RAW_IMPORT_BUCKET: "shared-raw",
  EXPORT_BUCKET: "shared-exports",
};

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("worker blob storage wiring", () => {
  it("constructs Supabase storage in production from the same bucket contract as web", async () => {
    let captured = "";
    const fetch: typeof globalThis.fetch = async (url) => {
      captured = String(url);
      return new Response(Uint8Array.from(Buffer.from("raw")), { status: 200 });
    };
    const store = createWorkerBlobStore(ENV, {
      environment: "production",
      fetch,
    });
    expect(store).toBeInstanceOf(SupabaseBlobStore);

    await store.get("raw-import/p1/r1/n1");
    expect(captured).toContain(
      "/storage/v1/object/shared-raw/raw-import/p1/r1/n1",
    );
  });

  it("requires the worker to receive the same explicit local path", async () => {
    expect(() =>
      createWorkerBlobStore(ENV, { environment: "development" }),
    ).toThrow(BlobStoreConfigurationError);

    const dir = await mkdtemp(join(tmpdir(), "sf-worker-blob-"));
    directories.push(dir);
    expect(
      createWorkerBlobStore(
        { ...ENV, SF_BLOB_DIR: dir },
        { environment: "development" },
      ),
    ).toBeInstanceOf(LocalFsBlobStore);
  });

  it("builds production context with Supabase storage and server-only OAuth credentials", () => {
    const env = EnvSchema.parse({
      APP_ORIGIN: "https://app.example.com",
      DATABASE_URL: "postgres://u@localhost/db",
      SUPABASE_URL: ENV.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY,
      CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
      GOOGLE_OAUTH_CLIENT_ID: "google-client",
      GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
      OPENAI_API_KEY: "sk-test",
      OPENAI_MODEL: "gpt-test",
      DATAFORSEO_ENABLED: "false",
      RAW_IMPORT_BUCKET: ENV.RAW_IMPORT_BUCKET,
      EXPORT_BUCKET: ENV.EXPORT_BUCKET,
    });
    const logger = {} as Logger;
    const db = { db: {} } as DbHandle;
    const boss = {} as PgBoss;

    const previousNodeEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      const context = buildWorkerContext({ db, boss, env, logger });
      expect(context.blobStore).toBeInstanceOf(SupabaseBlobStore);
      expect(context.googleOAuth).toEqual({
        clientId: "google-client",
        clientSecret: "google-secret",
      });
      expect(context.credentialKey.equals(Buffer.alloc(32, 1))).toBe(true);
    } finally {
      if (previousNodeEnv === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = previousNodeEnv;
    }
  });
});
