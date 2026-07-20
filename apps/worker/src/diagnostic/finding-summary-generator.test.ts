import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LLMError,
  type AnalysisInvocationRecord,
  type FindingSummaryClient,
  type FindingSummaryClientOptions,
} from "@sf/artifacts";
import { AnalysisInvocationsRepository, type ProjectScope } from "@sf/db";
import type { FindingSummaryGenerationInput } from "@sf/engine";
import type { Logger } from "@sf/observability";
import type { WorkerContext } from "../context.ts";
import {
  FINDING_SUMMARY_REQUEST_TIMEOUT_MS,
  MAX_FINDING_SUMMARY_INVOCATIONS_PER_RUN,
  createFindingSummaryGenerator,
  createFindingSummaryGeneratorForRun,
} from "./run-diagnostic.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const SCOPE: ProjectScope = {
  workspaceId: "workspace-1",
  projectId: "project-1",
};
const RUN_ID = "run-1";
const INVOCATION_ID = "00000000-0000-4000-8000-000000000099";

function makeLogger(): Logger {
  const logger: Logger = {
    context: { service: "worker", environment: "test" },
    child: () => logger,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return logger;
}

function makeContext(
  logger = makeLogger(),
  signal: AbortSignal = new AbortController().signal,
): WorkerContext {
  return {
    db: {} as WorkerContext["db"],
    openai: {
      apiKey: "test-key",
      model: "gpt-4.1-mini",
      baseUrl: "https://openai.example.test/chat/completions",
      authScheme: "api-key",
    },
    findingSummariesEnabled: true,
    logger,
    signal,
  } as WorkerContext;
}

function makeInput(
  outputLocale = "fr-FR",
): FindingSummaryGenerationInput {
  return {
    projectId: SCOPE.projectId,
    findingKey: "finding-key",
    ruleId: "TECH-HTTP-001",
    subjectRefs: ["http_status:404"],
    titleArgs: { count: 3, status: 404 },
    evidence: [],
    outputLocale,
    fallbackSummary: "3 pages return HTTP 404.",
    fallbackLocale: "en",
  };
}

function invocation(
  overrides: Partial<AnalysisInvocationRecord> = {},
): AnalysisInvocationRecord {
  return {
    task: "finding_summary",
    provider: "openai",
    model: "gpt-4.1-mini",
    promptSetVersion: "mvp.prompts.0.2.0",
    inputHash: "a".repeat(64),
    outputHash: "b".repeat(64),
    status: "succeeded",
    inputTokens: 20,
    outputTokens: 10,
    costUsd: null,
    latencyMs: 25,
    errorCode: null,
    ...overrides,
  };
}

describe("diagnostic finding-summary generator", () => {
  beforeEach(() => {
    vi.spyOn(
      AnalysisInvocationsRepository.prototype,
      "countByAsyncRunTask",
    ).mockResolvedValue(0);
  });

  it("persists a succeeded invocation before returning its real UUID to the engine", async () => {
    const events: string[] = [];
    const client: FindingSummaryClient = {
      generateSummary: vi.fn(async () => {
        events.push("model");
        return {
          summary: "Plusieurs pages sont indisponibles.",
          summaryLocale: "fr-FR",
          invocation: invocation(),
        };
      }),
    };
    const createClient = vi.fn(() => client);
    const insert = vi
      .spyOn(AnalysisInvocationsRepository.prototype, "insert")
      .mockImplementation(async () => {
        events.push("persist");
        return INVOCATION_ID;
      });
    const ctx = makeContext();
    const generator = createFindingSummaryGenerator(ctx, SCOPE, RUN_ID, {
      createClient,
    });

    await expect(generator(makeInput())).resolves.toEqual({
      summary: "Plusieurs pages sont indisponibles.",
      summaryLocale: "fr-FR",
      invocationId: INVOCATION_ID,
    });

    expect(events).toEqual(["model", "persist"]);
    expect(createClient).toHaveBeenCalledWith({
      apiKey: "test-key",
      model: "gpt-4.1-mini",
      baseUrl: "https://openai.example.test/chat/completions",
      authScheme: "api-key",
      timeoutMs: FINDING_SUMMARY_REQUEST_TIMEOUT_MS,
      signal: ctx.signal,
    });
    expect(insert).toHaveBeenCalledWith({
      workspaceId: SCOPE.workspaceId,
      projectId: SCOPE.projectId,
      asyncRunId: RUN_ID,
      task: "finding_summary",
      provider: "openai",
      model: "gpt-4.1-mini",
      promptSetVersion: "mvp.prompts.0.2.0",
      inputHash: "a".repeat(64),
      outputHash: "b".repeat(64),
      status: "succeeded",
      inputTokens: 20,
      outputTokens: 10,
      costUsd: null,
      latencyMs: 25,
      errorCode: null,
    });
  });

  it.each(["en", "en-US", "zh-CN"])(
    "does not construct a client or persist an invocation for deterministic locale %s",
    async (locale) => {
      const createClient = vi.fn<() => FindingSummaryClient>();
      const insert = vi.spyOn(
        AnalysisInvocationsRepository.prototype,
        "insert",
      );
      const generator = createFindingSummaryGenerator(
        makeContext(),
        SCOPE,
        RUN_ID,
        { createClient },
      );

      await expect(generator(makeInput(locale))).resolves.toBeNull();
      expect(createClient).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    },
  );

  it("omits the generator entirely when finding summaries are disabled", () => {
    const createClient = vi.fn<() => FindingSummaryClient>();
    const ctx = {
      ...makeContext(),
      findingSummariesEnabled: false,
    };

    expect(
      createFindingSummaryGeneratorForRun(ctx, SCOPE, RUN_ID, {
        createClient,
      }),
    ).toBeUndefined();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("caps one diagnostic run at eight real summary attempts", async () => {
    const generateSummary = vi.fn(async () => ({
      summary: "Résumé localisé.",
      summaryLocale: "fr-FR",
      invocation: invocation(),
    }));
    const client: FindingSummaryClient = { generateSummary };
    const createClient = vi.fn(() => client);
    const insert = vi
      .spyOn(AnalysisInvocationsRepository.prototype, "insert")
      .mockResolvedValue(INVOCATION_ID);
    const generator = createFindingSummaryGenerator(
      makeContext(),
      SCOPE,
      RUN_ID,
      { createClient },
    );

    // Deterministic locales do not consume the model-call budget.
    await expect(generator(makeInput("en-US"))).resolves.toBeNull();
    for (let index = 0; index < MAX_FINDING_SUMMARY_INVOCATIONS_PER_RUN; index += 1) {
      await expect(generator(makeInput())).resolves.toMatchObject({
        summaryLocale: "fr-FR",
      });
    }
    await expect(generator(makeInput())).resolves.toBeNull();

    expect(createClient).toHaveBeenCalledOnce();
    expect(generateSummary).toHaveBeenCalledTimes(
      MAX_FINDING_SUMMARY_INVOCATIONS_PER_RUN,
    );
    expect(insert).toHaveBeenCalledTimes(
      MAX_FINDING_SUMMARY_INVOCATIONS_PER_RUN,
    );
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs: FINDING_SUMMARY_REQUEST_TIMEOUT_MS,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("subtracts persisted attempts across retries before making any new calls", async () => {
    const count = vi.spyOn(
      AnalysisInvocationsRepository.prototype,
      "countByAsyncRunTask",
    );
    const generateSummary = vi.fn(async () => ({
      summary: "Résumé localisé.",
      summaryLocale: "fr-FR",
      invocation: invocation(),
    }));
    const createClient = vi.fn((): FindingSummaryClient => ({
      generateSummary,
    }));
    vi.spyOn(
      AnalysisInvocationsRepository.prototype,
      "insert",
    ).mockResolvedValue(INVOCATION_ID);

    count.mockResolvedValueOnce(7);
    const retryWithSeven = createFindingSummaryGenerator(
      makeContext(),
      SCOPE,
      RUN_ID,
      { createClient },
    );
    await expect(retryWithSeven(makeInput())).resolves.toMatchObject({
      summaryLocale: "fr-FR",
    });
    await expect(retryWithSeven(makeInput())).resolves.toBeNull();
    expect(count).toHaveBeenCalledTimes(1);
    expect(generateSummary).toHaveBeenCalledOnce();

    count.mockResolvedValueOnce(8);
    const retryWithEight = createFindingSummaryGenerator(
      makeContext(),
      SCOPE,
      RUN_ID,
      { createClient },
    );
    await expect(retryWithEight(makeInput())).resolves.toBeNull();
    await expect(retryWithEight(makeInput())).resolves.toBeNull();
    expect(count).toHaveBeenCalledTimes(2);
    expect(count).toHaveBeenLastCalledWith(
      SCOPE,
      RUN_ID,
      "finding_summary",
    );
    expect(generateSummary).toHaveBeenCalledOnce();
    expect(createClient).toHaveBeenCalledOnce();
  });

  it("latches a historical-count failure and exposes it through stage health", async () => {
    const countSecret = "repository-count-secret";
    const countError = new Error(countSecret);
    vi.spyOn(
      AnalysisInvocationsRepository.prototype,
      "countByAsyncRunTask",
    ).mockRejectedValue(countError);
    const logger = makeLogger();
    const createClient = vi.fn<() => FindingSummaryClient>();
    const generator = createFindingSummaryGenerator(
      makeContext(logger),
      SCOPE,
      RUN_ID,
      { createClient },
    );

    await expect(generator(makeInput())).resolves.toBeNull();
    await expect(generator(makeInput())).resolves.toBeNull();
    expect(() => generator.assertHealthy()).toThrow(countError);
    expect(createClient).not.toHaveBeenCalled();
    expect(JSON.stringify([logger.info, logger.warn, logger.error])).not.toContain(
      countSecret,
    );
  });

  it("does no count, client construction, or model work when already aborted", async () => {
    const controller = new AbortController();
    controller.abort("shutdown-secret");
    const count = vi.spyOn(
      AnalysisInvocationsRepository.prototype,
      "countByAsyncRunTask",
    );
    const createClient = vi.fn<() => FindingSummaryClient>();
    const generator = createFindingSummaryGenerator(
      makeContext(makeLogger(), controller.signal),
      SCOPE,
      RUN_ID,
      { createClient },
    );

    await expect(generator(makeInput())).resolves.toBeNull();
    expect(count).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("aborts an in-flight call, persists its real failure, and starts no later call", async () => {
    const controller = new AbortController();
    const abortSecret = "shutdown-reason-secret";
    const logger = makeLogger();
    const insert = vi
      .spyOn(AnalysisInvocationsRepository.prototype, "insert")
      .mockResolvedValue(INVOCATION_ID);
    const generateSummary = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener(
            "abort",
            () =>
              reject(
                new LLMError(
                  "TIMEOUT",
                  "request aborted",
                  invocation({
                    status: "failed",
                    outputHash: null,
                    errorCode: "TIMEOUT",
                  }),
                ),
              ),
            { once: true },
          );
        }),
    );
    const createClient = vi.fn(
      (options: FindingSummaryClientOptions): FindingSummaryClient => {
        expect(options.signal).toBe(controller.signal);
        return { generateSummary };
      },
    );
    const generator = createFindingSummaryGenerator(
      makeContext(logger, controller.signal),
      SCOPE,
      RUN_ID,
      { createClient },
    );

    const pending = generator(makeInput());
    await vi.waitFor(() => expect(generateSummary).toHaveBeenCalledOnce());
    controller.abort(abortSecret);
    await expect(pending).resolves.toBeNull();
    await expect(generator(makeInput())).resolves.toBeNull();

    expect(generateSummary).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", errorCode: "TIMEOUT" }),
    );
    expect(JSON.stringify([logger.info, logger.warn, logger.error])).not.toContain(
      abortSecret,
    );
  });

  it("starts no second call when shutdown follows one successful call", async () => {
    const controller = new AbortController();
    const generateSummary = vi.fn(async () => ({
      summary: "Résumé localisé.",
      summaryLocale: "fr-FR",
      invocation: invocation(),
    }));
    vi.spyOn(
      AnalysisInvocationsRepository.prototype,
      "insert",
    ).mockResolvedValue(INVOCATION_ID);
    const generator = createFindingSummaryGenerator(
      makeContext(makeLogger(), controller.signal),
      SCOPE,
      RUN_ID,
      { createClient: () => ({ generateSummary }) },
    );

    await expect(generator(makeInput())).resolves.toMatchObject({
      summaryLocale: "fr-FR",
    });
    controller.abort("shutdown-secret");
    await expect(generator(makeInput())).resolves.toBeNull();
    expect(generateSummary).toHaveBeenCalledOnce();
  });

  it("persists failed and rejected real calls, then returns the English fallback signal", async () => {
    const providerSecret = "raw-provider-error-secret";
    const logger = makeLogger();
    const insert = vi
      .spyOn(AnalysisInvocationsRepository.prototype, "insert")
      .mockResolvedValue(INVOCATION_ID);

    for (const failureInvocation of [
      invocation({
        status: "failed",
        outputHash: null,
        errorCode: "SERVER_ERROR",
      }),
      invocation({
        status: "rejected",
        outputHash: null,
        errorCode: "SCHEMA_INVALID",
      }),
    ]) {
      const client: FindingSummaryClient = {
        generateSummary: vi.fn().mockRejectedValue(
          new LLMError(
            failureInvocation.errorCode as "SERVER_ERROR" | "SCHEMA_INVALID",
            providerSecret,
            failureInvocation,
          ),
        ),
      };
      const generator = createFindingSummaryGenerator(
        makeContext(logger),
        SCOPE,
        RUN_ID,
        { createClient: () => client },
      );

      await expect(generator(makeInput())).resolves.toBeNull();
    }

    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls.map(([values]) => values.status)).toEqual([
      "failed",
      "rejected",
    ]);
    expect(JSON.stringify([logger.info, logger.warn, logger.error])).not.toContain(
      providerSecret,
    );
  });

  it("latches invocation persistence failure and fails the stage health check", async () => {
    const persistenceSecret = "database-provider-secret";
    const logger = makeLogger();
    const client: FindingSummaryClient = {
      generateSummary: vi.fn().mockResolvedValue({
        summary: "Résumé localisé.",
        summaryLocale: "fr-FR",
        invocation: invocation(),
      }),
    };
    const insert = vi.spyOn(
      AnalysisInvocationsRepository.prototype,
      "insert",
    );
    const generator = createFindingSummaryGenerator(
      makeContext(logger),
      SCOPE,
      RUN_ID,
      { createClient: () => client },
    );

    const persistenceError = new Error(persistenceSecret);
    insert.mockRejectedValueOnce(persistenceError);
    await expect(generator(makeInput())).resolves.toBeNull();
    expect(() => generator.assertHealthy()).toThrow(persistenceError);

    // Once audit persistence is unhealthy, no later model call is attempted.
    await expect(generator(makeInput())).resolves.toBeNull();
    expect(client.generateSummary).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledOnce();

    expect(JSON.stringify([logger.info, logger.warn, logger.error])).not.toContain(
      persistenceSecret,
    );
  });

  it("falls back for a non-UUID repository result without fabricating an invocation id", async () => {
    const client: FindingSummaryClient = {
      generateSummary: vi.fn().mockResolvedValue({
        summary: "Résumé localisé.",
        summaryLocale: "fr-FR",
        invocation: invocation(),
      }),
    };
    vi.spyOn(AnalysisInvocationsRepository.prototype, "insert").mockResolvedValue(
      "not-a-real-invocation-id",
    );
    const generator = createFindingSummaryGenerator(
      makeContext(),
      SCOPE,
      RUN_ID,
      { createClient: () => client },
    );

    await expect(generator(makeInput())).resolves.toBeNull();
    expect(() => generator.assertHealthy()).not.toThrow();
  });

  it("contains client construction/model failures without writing a fabricated invocation", async () => {
    const insert = vi.spyOn(
      AnalysisInvocationsRepository.prototype,
      "insert",
    );
    const createClient = vi.fn((): FindingSummaryClient => {
      throw new LLMError("CONFIG_INVALID", "model config unavailable");
    });
    const generator = createFindingSummaryGenerator(
      makeContext(),
      SCOPE,
      RUN_ID,
      { createClient },
    );

    await expect(generator(makeInput())).resolves.toBeNull();
    await expect(generator(makeInput())).resolves.toBeNull();
    expect(createClient).toHaveBeenCalledOnce();
    expect(insert).not.toHaveBeenCalled();
  });
});
