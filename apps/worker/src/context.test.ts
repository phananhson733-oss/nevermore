import { describe, expect, it, vi } from "vitest";
import type { DbHandle, PgBoss } from "@sf/db";
import type { Logger } from "@sf/observability";
import {
  buildWorkerContext,
  withRunContext,
  type WorkerContext,
} from "./context.ts";
import type { WorkerEnv } from "./env.ts";

describe("withRunContext", () => {
  it("binds only canonical correlation keys to a child logger", () => {
    const childLogger = {} as Logger;
    const child = vi.fn(() => childLogger);
    const logger = {
      context: { service: "worker", environment: "test" },
      child,
    } as unknown as Logger;
    const ctx = { logger } as WorkerContext;
    const payload = {
      runId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002",
      projectId: "00000000-0000-4000-8000-000000000003",
    };

    const scoped = withRunContext(ctx, payload);

    expect(scoped).not.toBe(ctx);
    expect(scoped.logger).toBe(childLogger);
    expect(child).toHaveBeenCalledOnce();
    expect(child).toHaveBeenCalledWith(payload);
  });
});

describe("buildWorkerContext", () => {
  it.each([
    ["true", true],
    ["false", false],
  ] as const)(
    "converts FINDING_SUMMARIES_ENABLED=%s to %s",
    (configured, expected) => {
      const env = {
        APP_ORIGIN: "http://127.0.0.1:3000",
        DATABASE_URL: "postgresql://test:test@127.0.0.1/test",
        DB_POOL_MAX: 1,
        SUPABASE_URL: "http://127.0.0.1:54321",
        SUPABASE_SERVICE_ROLE_KEY: "test",
        CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
        GOOGLE_OAUTH_CLIENT_ID: "test",
        GOOGLE_OAUTH_CLIENT_SECRET: "test",
        LLM_PROVIDER: "openai",
        OPENAI_API_KEY: "test",
        OPENAI_MODEL: "test",
        OPENAI_TEMPERATURE: 0.2,
        FINDING_SUMMARIES_ENABLED: configured,
        KEYWORD_AUTO_GOVERNANCE_ENABLED: "true",
        DATAFORSEO_ENABLED: "false",
        DATAFORSEO_BACKLINKS_ENABLED: "true",
        DATAFORSEO_MAX_KEYWORDS: 200,
        DATAFORSEO_MAX_COMPETITORS: 100,
        DATAFORSEO_MAX_BACKLINKS: 500,
        DATAFORSEO_MAX_REFERRING_DOMAINS: 100,
        DATAFORSEO_MAX_BACKLINK_PAGES: 500,
        DATAFORSEO_MAX_BACKLINK_SOURCE_VERIFICATIONS: 20,
        RAW_IMPORT_BUCKET: "raw-imports",
        EXPORT_BUCKET: "exports",
        SF_BLOB_BACKEND: "local",
        SF_BLOB_DIR: "/tmp/signalframe-worker-context-test",
        LOG_LEVEL: "info",
      } satisfies WorkerEnv;
      const logger = {} as Logger;
      const signal = new AbortController().signal;
      const context = buildWorkerContext({
        db: { db: {} } as DbHandle,
        boss: {} as PgBoss,
        env,
        logger,
        signal,
      });

      expect(context.findingSummariesEnabled).toBe(expected);
      expect(context.dataForSeo).toEqual({
        enabled: false,
        login: null,
        password: null,
        maxKeywords: 200,
        maxCompetitors: 100,
        backlinksEnabled: false,
        maxBacklinks: 500,
        maxReferringDomains: 100,
        maxBacklinkPages: 500,
        maxSourceVerifications: 20,
      });
      expect(context.signal).toBe(signal);
    },
  );
});
