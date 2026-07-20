import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  ImportPreviewsRepository,
  ProjectsRepository,
  SitesRepository,
} from "@sf/db";
import {
  BlobObjectAlreadyExistsError,
  SourceError,
  SupabaseStorageError,
} from "@sf/sources";
import {
  CollectionShutdownError,
  collectionAdapterContext,
  collectionFailureDecision,
  collectionFailureForSignal,
  runCollection,
  type CollectionWorkerContext,
} from "./run-collection.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("collection shutdown cancellation", () => {
  it("threads the worker lifecycle signal into the adapter context", () => {
    const signal = new AbortController().signal;

    expect(
      collectionAdapterContext(
        { signal },
        { id: "run-1" },
        { id: "site-1" },
        { workspaceId: "workspace-1", projectId: "project-1" },
      ),
    ).toEqual({
      workspaceId: "workspace-1",
      projectId: "project-1",
      siteId: "site-1",
      runId: "run-1",
      signal,
    });
  });

  it("omits the adapter signal when the worker context has none", () => {
    expect(
      collectionAdapterContext(
        {},
        { id: "run-1" },
        { id: "site-1" },
        { workspaceId: "workspace-1", projectId: "project-1" },
      ),
    ).toEqual({
      workspaceId: "workspace-1",
      projectId: "project-1",
      siteId: "site-1",
      runId: "run-1",
    });
  });

  it("maps an aborted lifecycle to a fixed retryable error without reading raw reasons", () => {
    const controller = new AbortController();
    const secret = "customer-secret-abort-reason";
    const hostileReason = new Proxy(new Error(secret), {
      get() {
        throw new Error("abort reason must not be read");
      },
    });
    controller.abort(hostileReason);

    const failure = collectionFailureForSignal(
      new Error("raw-provider-customer-secret"),
      controller.signal,
    );

    expect(failure).toBeInstanceOf(CollectionShutdownError);
    expect(failure).toMatchObject({ code: "UNAVAILABLE" });
    expect(JSON.stringify(failure)).not.toContain(secret);
    expect(String((failure as Error).message)).not.toContain("raw-provider");

    const decision = collectionFailureDecision(
      new Error("second-raw-provider-secret"),
      controller.signal,
    );
    expect(decision.failure).toBeInstanceOf(CollectionShutdownError);
    expect(decision.transient).toEqual({
      code: "UNAVAILABLE",
      summary:
        "Collection was interrupted by worker shutdown; automatic retry is scheduled.",
    });
  });

  it("preserves a non-shutdown failure", () => {
    const failure = new Error("ordinary failure");
    expect(
      collectionFailureForSignal(
        failure,
        new AbortController().signal,
      ),
    ).toBe(failure);
  });

  it.each([
    ["RATE_LIMITED", "Provider rate limit reached; automatic retry is scheduled."],
    ["TIMEOUT", "Provider request timed out; automatic retry is scheduled."],
    ["UNAVAILABLE", "Provider is temporarily unavailable; automatic retry is scheduled."],
    ["NETWORK_ERROR", "Provider network request failed; automatic retry is scheduled."],
  ] as const)(
    "maps transient source error %s to the correct retry summary",
    (code, summary) => {
      const decision = collectionFailureDecision(
        new SourceError(code, `source-${code.toLowerCase()}`),
        undefined,
      );

      expect(decision.failure).toBeInstanceOf(SourceError);
      expect(decision.transient).toEqual({ code, summary });
    },
  );

  it.each([
    [undefined, { code: "NETWORK_ERROR", summary: "Storage network request failed; automatic retry is scheduled." }],
    [408, { code: "TIMEOUT", summary: "Storage request timed out; automatic retry is scheduled." }],
    [429, { code: "RATE_LIMITED", summary: "Storage rate limit reached; automatic retry is scheduled." }],
    [503, { code: "UNAVAILABLE", summary: "Storage is temporarily unavailable; automatic retry is scheduled." }],
    [403, null],
  ] as const)(
    "maps storage status %s to %j",
    (status, expected) => {
      const decision = collectionFailureDecision(
        new SupabaseStorageError("get", "export/p/r/object", {
          ...(status === undefined ? {} : { status }),
        }),
        undefined,
      );

      expect(decision.transient).toEqual(expected);
    },
  );

  it.each(["55P03", "57014"])(
    "retries bounded database timeout %s as infrastructure unavailability",
    (code) => {
      const decision = collectionFailureDecision(
        Object.assign(new Error("database timeout customer-secret"), { code }),
        undefined,
      );

      expect(decision.transient).toEqual({
        code: "UNAVAILABLE",
        summary:
          "Database or runtime infrastructure is temporarily unavailable; automatic retry is scheduled.",
      });
    },
  );

  it("keeps append-only snapshot collisions on the permanent failure path", () => {
    const collision = new BlobObjectAlreadyExistsError(
      "snapshot-raw/project/run/object",
    );

    const decision = collectionFailureDecision(collision, undefined);

    expect(decision.failure).toBe(collision);
    expect(decision.transient).toBeNull();
  });

  it("skips when the run cannot be claimed", async () => {
    const claim = vi
      .spyOn(AsyncRunsRepository.prototype, "claim")
      .mockResolvedValue(null);
    const findCollection = vi.spyOn(CollectionRunsRepository.prototype, "findById");
    const ctx = {
      db: { transaction: vi.fn() },
      blobStore: {},
      credentialKey: Buffer.alloc(32),
      googleOAuth: { clientId: "id", clientSecret: "secret" },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as unknown as CollectionWorkerContext;

    await expect(
      runCollection(ctx, {
        runId: "run-claim-miss",
        workspaceId: "workspace-1",
        projectId: "project-1",
      }),
    ).resolves.toBeUndefined();

    expect(claim).toHaveBeenCalledWith(
      { workspaceId: "workspace-1", projectId: "project-1" },
      "run-claim-miss",
    );
    expect(findCollection).not.toHaveBeenCalled();
  });

  it("terminalizes when the collection run or site is missing", async () => {
    const claimed = {
      id: "run-missing",
      workspace_id: "workspace-1",
      project_id: "project-1",
      attempt_count: 1,
      initiated_by: "actor-1",
    };
    vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(
      claimed as never,
    );
    vi.spyOn(CollectionRunsRepository.prototype, "findById").mockResolvedValue(
      null,
    );
    vi.spyOn(SitesRepository.prototype, "findPrimary").mockResolvedValue(
      null,
    );
    const setTerminal = vi
      .spyOn(AsyncRunsRepository.prototype, "setTerminal")
      .mockResolvedValue(true);
    const ctx = {
      db: { transaction: vi.fn() },
      blobStore: {},
      credentialKey: Buffer.alloc(32),
      googleOAuth: { clientId: "id", clientSecret: "secret" },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as unknown as CollectionWorkerContext;

    await expect(
      runCollection(ctx, {
        runId: "run-missing",
        workspaceId: "workspace-1",
        projectId: "project-1",
      }),
    ).resolves.toBeUndefined();

    expect(setTerminal).toHaveBeenCalledWith(
      {
        workspaceId: "workspace-1",
        projectId: "project-1",
        runId: "run-missing",
        attemptCount: 1,
      },
      {
        status: "failed",
        lastErrorCode: "NOT_FOUND",
        lastErrorSummary: "collection run or site missing",
      },
    );
  });

  it("terminalizes when the loaded run scope does not match the payload", async () => {
    const claimed = {
      id: "run-mismatch",
      workspace_id: "workspace-1",
      project_id: "project-1",
      attempt_count: 1,
      initiated_by: "actor-1",
    };
    vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(
      claimed as never,
    );
    vi.spyOn(CollectionRunsRepository.prototype, "findById").mockResolvedValue({
      id: "run-mismatch",
      workspace_id: "workspace-1",
      project_id: "project-2",
      site_id: "site-1",
      provider: "crawl",
      method_version: "crawl.site_graph.v1",
      source_connection_id: null,
    } as never);
    vi.spyOn(SitesRepository.prototype, "findPrimary").mockResolvedValue({
      id: "site-1",
      origin: "https://example.com",
      host: "example.com",
    } as never);
    const setTerminal = vi
      .spyOn(AsyncRunsRepository.prototype, "setTerminal")
      .mockResolvedValue(true);
    const ctx = {
      db: { transaction: vi.fn() },
      blobStore: {},
      credentialKey: Buffer.alloc(32),
      googleOAuth: { clientId: "id", clientSecret: "secret" },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as unknown as CollectionWorkerContext;

    await expect(
      runCollection(ctx, {
        runId: "run-mismatch",
        workspaceId: "workspace-1",
        projectId: "project-1",
      }),
    ).resolves.toBeUndefined();

    expect(setTerminal).toHaveBeenCalledWith(
      {
        workspaceId: "workspace-1",
        projectId: "project-1",
        runId: "run-mismatch",
        attemptCount: 1,
      },
      {
        status: "failed",
        lastErrorCode: "INVALID_CONFIGURATION",
        lastErrorSummary: "collection run scope mismatch",
      },
    );
  });

  it("requeues an aborted crawl without persisting or terminalizing it", async () => {
    const controller = new AbortController();
    controller.abort(new Error("raw-shutdown-reason-secret"));
    const claimed = {
      id: "run-1",
      workspace_id: "workspace-1",
      project_id: "project-1",
      attempt_count: 1,
      initiated_by: "actor-1",
    };
    const resetToQueued = vi
      .spyOn(AsyncRunsRepository.prototype, "resetToQueued")
      .mockResolvedValue(true);
    vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(
      claimed as never,
    );
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "lockAttemptForUpdate",
    ).mockResolvedValue(claimed as never);
    const setTerminal = vi.spyOn(
      AsyncRunsRepository.prototype,
      "setTerminal",
    );
    vi.spyOn(CollectionRunsRepository.prototype, "findById").mockResolvedValue({
      id: "run-1",
      workspace_id: "workspace-1",
      project_id: "project-1",
      site_id: "site-1",
      provider: "crawl",
      method_version: "crawl.site_graph.v1",
      source_connection_id: null,
    } as never);
    vi.spyOn(SitesRepository.prototype, "findPrimary").mockResolvedValue({
      id: "site-1",
      origin: "https://example.com",
      host: "example.com",
    } as never);
    vi.spyOn(
      ProjectsRepository.prototype,
      "findByIdForUpdate",
    ).mockResolvedValue({ archived_at: null } as never);

    const put = vi.fn();
    const fetch = vi.fn(async () => {
      throw new Error("crawl transport must not start after shutdown");
    });
    const transaction = vi.fn(
      async (callback: (tx: object) => Promise<unknown>) => callback({}),
    );
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const ctx = {
      db: { transaction },
      blobStore: { put },
      credentialKey: Buffer.alloc(32),
      googleOAuth: { clientId: "id", clientSecret: "secret" },
      crawl: { fetcher: { fetch } },
      logger,
      signal: controller.signal,
    } as unknown as CollectionWorkerContext;

    const failure = await runCollection(ctx, {
      runId: "run-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CollectionShutdownError);
    expect(failure).toMatchObject({ code: "UNAVAILABLE" });
    expect(resetToQueued).toHaveBeenCalledWith(
      {
        workspaceId: "workspace-1",
        projectId: "project-1",
        runId: "run-1",
        attemptCount: 1,
      },
      {
        code: "UNAVAILABLE",
        summary:
          "Collection was interrupted by worker shutdown; automatic retry is scheduled.",
      },
    );
    expect(setTerminal).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(
      JSON.stringify([
        ...logger.info.mock.calls,
        ...logger.warn.mock.calls,
        ...logger.error.mock.calls,
      ]),
    ).not.toContain("raw-shutdown-reason-secret");
  });

  it("passes lifecycle cancellation to an active CSV download and requeues safely", async () => {
    const controller = new AbortController();
    const claimed = {
      id: "run-2",
      workspace_id: "workspace-1",
      project_id: "project-1",
      attempt_count: 1,
      initiated_by: "actor-1",
    };
    const resetToQueued = vi
      .spyOn(AsyncRunsRepository.prototype, "resetToQueued")
      .mockResolvedValue(true);
    vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(
      claimed as never,
    );
    vi.spyOn(
      AsyncRunsRepository.prototype,
      "lockAttemptForUpdate",
    ).mockResolvedValue(claimed as never);
    const setTerminal = vi.spyOn(
      AsyncRunsRepository.prototype,
      "setTerminal",
    );
    vi.spyOn(CollectionRunsRepository.prototype, "findById").mockResolvedValue({
      id: "run-2",
      workspace_id: "workspace-1",
      project_id: "project-1",
      site_id: "site-1",
      provider: "csv",
      method_version: "csv.keyword_gap.v1",
      source_connection_id: null,
      import_preview_id: "preview-1",
    } as never);
    vi.spyOn(SitesRepository.prototype, "findPrimary").mockResolvedValue({
      id: "site-1",
      origin: "https://example.com",
      host: "example.com",
    } as never);
    vi.spyOn(
      ProjectsRepository.prototype,
      "findByIdForUpdate",
    ).mockResolvedValue({ archived_at: null } as never);
    vi.spyOn(
      ImportPreviewsRepository.prototype,
      "findById",
    ).mockResolvedValue({
      raw_object_key: "raw-import/project-1/run-2/import.csv",
      detected_columns: ["keyword"],
    } as never);

    const get = vi.fn(
      (
        _key: string,
        options?: { readonly signal?: AbortSignal },
      ): Promise<Buffer | null> =>
        new Promise((_resolve, reject) => {
          const signal = options?.signal ?? controller.signal;
          const rejectFromAbort = (): void =>
            reject(new Error("raw-csv-download-abort-secret"));
          if (signal.aborted) rejectFromAbort();
          else signal.addEventListener("abort", rejectFromAbort, { once: true });
        }),
    );
    const transaction = vi.fn(
      async (callback: (tx: object) => Promise<unknown>) => callback({}),
    );
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const ctx = {
      db: { transaction },
      blobStore: { get },
      credentialKey: Buffer.alloc(32),
      googleOAuth: { clientId: "id", clientSecret: "secret" },
      logger,
      signal: controller.signal,
    } as unknown as CollectionWorkerContext;

    const collecting = runCollection(ctx, {
      runId: "run-2",
      workspaceId: "workspace-1",
      projectId: "project-1",
    });
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    controller.abort(new Error("hostile-csv-shutdown-reason"));
    const failure = await collecting.catch((error: unknown) => error);

    expect(get).toHaveBeenCalledWith(
      "raw-import/project-1/run-2/import.csv",
      { signal: controller.signal },
    );
    expect(failure).toBeInstanceOf(CollectionShutdownError);
    expect(resetToQueued).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-2", attemptCount: 1 }),
      {
        code: "UNAVAILABLE",
        summary:
          "Collection was interrupted by worker shutdown; automatic retry is scheduled.",
      },
    );
    expect(setTerminal).not.toHaveBeenCalled();
    expect(
      JSON.stringify([
        ...logger.info.mock.calls,
        ...logger.warn.mock.calls,
        ...logger.error.mock.calls,
      ]),
    ).not.toMatch(/raw-csv-download-abort-secret|hostile-csv-shutdown-reason/);
  });
});
