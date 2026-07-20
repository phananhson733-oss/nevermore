import { once } from "node:events";
import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { ArtifactPromptInput } from "../types.ts";
import { PROMPT_SET_VERSION } from "../types.ts";
import {
  MAX_EVIDENCE_CLAIM_CHARS,
  safePromptCurrentMetadata,
} from "./envelope.ts";
import {
  LLMError,
  MAX_OPENAI_RESPONSE_BODY_BYTES,
  createOpenAIClient,
} from "./openai-client.ts";

function makeInput(
  overrides: Partial<ArtifactPromptInput> = {},
): ArtifactPromptInput {
  return {
    artifactType: "content_brief",
    outputLocale: "en",
    operatorInstructions: null,
    icp: {
      productName: "Acme Analytics",
      oneLineDescription: "Product analytics for B2B SaaS teams.",
      offers: [],
      useCases: [],
      differentiators: [],
      primaryConversion: null,
      marketCodes: ["US"],
    },
    action: {
      templateId: "content.brief.v1",
      title: "Publish a comparison page",
      description: "Create a /compare page.",
      expectedOutcome: "Capture comparison intent.",
      effort: "medium",
      risk: "low",
    },
    finding: {
      ruleId: "content-gap",
      domain: "content",
      summary: "No comparison content.",
      severity: "high",
      confidence: "b",
      subjectRefs: ["url:/"],
    },
    currentMetadata: {
      url: null,
      currentTitle: null,
      currentDescription: null,
    },
    evidence: [
      {
        evidenceId: "ev-1",
        claim: "Organic sessions fell 45% quarter over quarter.",
        grade: "B",
        subjectRefs: ["url:/"],
        observedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
    requiresValidationRollback: false,
    ...overrides,
  };
}

function chatResponse(
  content: unknown,
  usage: { prompt_tokens: number; completion_tokens: number } = {
    prompt_tokens: 120,
    completion_tokens: 340,
  },
): Response {
  return new Response(chatResponseText(content, usage), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function chatResponseText(
  content: unknown,
  usage: { prompt_tokens: number; completion_tokens: number } = {
    prompt_tokens: 120,
    completion_tokens: 340,
  },
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    choices: [
      {
        message: {
          role: "assistant",
          content:
            typeof content === "string" ? content : JSON.stringify(content),
        },
      },
    ],
    usage,
    ...extra,
  });
}

const EXPECTED_RESPONSE_BODY_LIMIT_BYTES = MAX_OPENAI_RESPONSE_BODY_BYTES;

function streamFixture(input: {
  readonly status?: number;
  readonly contentLength?: string;
  readonly chunks?: readonly Uint8Array[];
  readonly readError?: Error;
  readonly legacyJson?: unknown;
}): {
  readonly response: Response;
  readonly bodyCancel: ReturnType<typeof vi.fn>;
  readonly readerCancel: ReturnType<typeof vi.fn>;
  readonly read: ReturnType<typeof vi.fn>;
} {
  const bodyCancel = vi.fn(async () => undefined);
  const readerCancel = vi.fn(async () => undefined);
  const releaseLock = vi.fn();
  const chunks = [...(input.chunks ?? [])];
  const read = vi.fn(async () => {
    if (input.readError) throw input.readError;
    const value = chunks.shift();
    return value ? { done: false, value } : { done: true, value: undefined };
  });
  const status = input.status ?? 200;
  const response = {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(
      input.contentLength
        ? { "content-length": input.contentLength }
        : undefined,
    ),
    body: {
      cancel: bodyCancel,
      getReader: () => ({ read, cancel: readerCancel, releaseLock }),
    },
    // This models the old unbounded path. Hardened code must never call it.
    json: vi.fn(async () => input.legacyJson),
  } as unknown as Response;
  return { response, bodyCancel, readerCancel, read };
}

const WATCHDOG_EXPIRED = Symbol("watchdog-expired");

function settleBeforeWatchdog(
  promise: Promise<unknown>,
  watchdogMs: number,
): Promise<unknown | typeof WATCHDOG_EXPIRED> {
  return new Promise((resolve) => {
    const watchdog = setTimeout(() => resolve(WATCHDOG_EXPIRED), watchdogMs);
    void promise.then(
      (value) => {
        clearTimeout(watchdog);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(watchdog);
        resolve(error);
      },
    );
  });
}

async function withRedirectServer(
  run: (
    baseUrl: string,
    hits: { readonly redirect: number; readonly followed: number },
  ) => Promise<void>,
): Promise<void> {
  const hits = { redirect: 0, followed: 0 };
  const server = createServer((request, response) => {
    if (request.url === "/redirect") {
      hits.redirect += 1;
      response.statusCode = 302;
      response.setHeader("location", "/followed");
      response.end();
      return;
    }
    if (request.url === "/followed") {
      hits.followed += 1;
      response.statusCode = 200;
      response.end(chatResponseText(VALID_MARKDOWN));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    throw new Error("redirect test server did not expose a TCP port");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl, hits);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

const VALID_MARKDOWN = {
  markdown:
    "Organic sessions fell 45% last quarter, so we should publish a comparison page.",
  evidenceRefs: ["ev-1"],
  citedNumbers: [{ value: "45%", evidenceId: "ev-1" }],
};

describe("OpenAIClient.generateArtifact (spec §10.2, §14.4)", () => {
  it("never hits the real network (fetch is injected)", async () => {
    const globalFetch = vi.spyOn(globalThis, "fetch");
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse(VALID_MARKDOWN));
    const client = createOpenAIClient({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetchImpl,
    });

    await client.generateArtifact(makeInput());

    expect(globalFetch).not.toHaveBeenCalled();
    globalFetch.mockRestore();
  });

  it("returns markdown content + a succeeded invocation with usage token counts", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse(VALID_MARKDOWN));
    const client = createOpenAIClient({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetchImpl,
    });

    const result = await client.generateArtifact(makeInput());

    expect(result.content.contentFormat).toBe("markdown");
    expect(result.content.content).toContain("comparison page");

    const inv = result.invocation;
    expect(inv.status).toBe("succeeded");
    expect(inv.task).toBe("artifact_generation");
    expect(inv.provider).toBe("openai");
    expect(inv.model).toBe("gpt-4o-mini");
    expect(inv.promptSetVersion).toBe(PROMPT_SET_VERSION);
    expect(inv.inputTokens).toBe(120);
    expect(inv.outputTokens).toBe(340);
    expect(inv.costUsd).toBeNull();
    expect(inv.errorCode).toBeNull();
    expect(inv.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(inv.outputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(inv.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("sends the OpenAI Chat Completions request with Bearer auth and a json_object response format", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse(VALID_MARKDOWN));
    const client = createOpenAIClient({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetchImpl,
    });

    await client.generateArtifact(makeInput());

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe("https://api.openai.com/v1/chat/completions");
    const headers = call[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
    expect(call[1].redirect).toBe("error");
    const sentBody = JSON.parse(call[1].body as string) as {
      model: string;
      temperature: number;
      response_format: { type: string };
      messages: ReadonlyArray<{ role: string }>;
    };
    expect(sentBody.model).toBe("gpt-4o-mini");
    expect(sentBody.response_format.type).toBe("json_object");
    expect(sentBody.temperature).toBeLessThanOrEqual(0.5);
    expect(sentBody.messages.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("AC-032 sends only bounded, secret-scrubbed allowlisted data in the real outgoing request", async () => {
    const oauthToken = `ya29.${"T".repeat(40)}`;
    const rawCsv = [
      "keyword,search_volume,customer_email",
      "private query,999,owner@foreign.example",
    ].join("\n");
    const foreignProjectSentinel = "FOREIGN_PROJECT_PRIVATE_CONTEXT";
    const nonAllowlistedEvidenceSentinel =
      "NON_ALLOWLISTED_EVIDENCE_LIMITATION";
    const claimTailSentinel = "CLAIM_MUST_BE_TRUNCATED_BEFORE_THIS_SENTINEL";
    const longClaim = `${oauthToken} observed claim ${"x".repeat(
      MAX_EVIDENCE_CLAIM_CHARS + 200,
    )}${claimTailSentinel}`;

    const pollutedInput = {
      ...makeInput({
        evidence: [
          {
            evidenceId: "ev-safe",
            claim: longClaim,
            grade: "B",
            subjectRefs: ["url:/pricing"],
            observedAt: "2026-07-01T00:00:00.000Z",
            limitation: nonAllowlistedEvidenceSentinel,
            rawCsv,
          },
        ] as unknown as ArtifactPromptInput["evidence"],
      }),
      accessToken: oauthToken,
      rawCsv,
      foreignProject: {
        projectId: "project-foreign",
        privateContext: foreignProjectSentinel,
      },
      nonAllowlistedEvidence: nonAllowlistedEvidenceSentinel,
    } as unknown as ArtifactPromptInput;
    const fetchImpl = vi.fn().mockResolvedValue(
      chatResponse({
        markdown: "Use the supplied evidence excerpt.",
        evidenceRefs: ["ev-safe"],
        citedNumbers: [],
      }),
    );
    const client = createOpenAIClient({
      apiKey: "outgoing-header-only-key",
      model: "gpt-4o-mini",
      fetchImpl,
    });

    await client.generateArtifact(pollutedInput);

    const call = fetchImpl.mock.calls[0] as [string, RequestInit];
    const outgoingBody = String(call[1].body);
    expect(outgoingBody).not.toContain(oauthToken);
    expect(outgoingBody).not.toContain(rawCsv);
    expect(outgoingBody).not.toContain(foreignProjectSentinel);
    expect(outgoingBody).not.toContain(nonAllowlistedEvidenceSentinel);
    expect(outgoingBody).not.toContain(claimTailSentinel);
    expect(outgoingBody).not.toContain("outgoing-header-only-key");
    expect(outgoingBody).toContain("[redacted]");

    const sentBody = JSON.parse(outgoingBody) as {
      messages: ReadonlyArray<{ role: string; content: string }>;
    };
    const user = sentBody.messages.find((message) => message.role === "user")
      ?.content;
    const renderedClaim = user
      ?.split("\n")
      .find((line) => line.startsWith("  claim: "))
      ?.slice("  claim: ".length);
    expect(renderedClaim).toBeDefined();
    expect(renderedClaim!.length).toBeLessThanOrEqual(
      MAX_EVIDENCE_CLAIM_CHARS,
    );
  });

  it("targets an Azure OpenAI deployment with the api-key header when authScheme=api-key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse(VALID_MARKDOWN));
    const azureUrl =
      "https://res.openai.azure.com/openai/deployments/gpt-4.1-mini/chat/completions?api-version=2025-03-01-preview";
    const client = createOpenAIClient({
      apiKey: "azure-key",
      model: "gpt-4.1-mini",
      baseUrl: azureUrl,
      authScheme: "api-key",
      fetchImpl,
    });

    const result = await client.generateArtifact(makeInput());

    const call = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe(azureUrl);
    const headers = call[1].headers as Record<string, string>;
    // Azure authenticates with the `api-key` header, NOT `Authorization: Bearer`.
    expect(headers["api-key"]).toBe("azure-key");
    expect(headers.Authorization).toBeUndefined();
    // Still the OpenAI provider — same models + API shape (spec §10.2).
    expect(result.invocation.provider).toBe("openai");
    expect(result.content.contentFormat).toBe("markdown");
  });

  it("fails on the first redirect hop and never follows an OpenAI credential-bearing request", async () => {
    await withRedirectServer(async (baseUrl, hits) => {
      const client = createOpenAIClient({
        apiKey: "test-key",
        model: "gpt-4o-mini",
        fetchImpl: (_input, init) => fetch(`${baseUrl}/redirect`, init),
      });

      await expect(client.generateArtifact(makeInput())).rejects.toMatchObject({
        code: "NETWORK_ERROR",
      });
      expect(hits).toEqual({ redirect: 1, followed: 0 });
    });
  });

  it("aborts an in-flight provider request when the worker signal is aborted", async () => {
    const shutdown = new AbortController();
    const fetchImpl = vi.fn((_input: string, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => {
            reject(
              signal.reason ?? new DOMException("worker aborted", "AbortError"),
            );
          },
          { once: true },
        );
      });
    });
    const client = createOpenAIClient({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetchImpl,
      signal: shutdown.signal,
    });

    const pending = client.generateArtifact(makeInput());
    shutdown.abort(new DOMException("worker shutting down", "AbortError"));

    await expect(pending).rejects.toMatchObject({
      code: "TIMEOUT",
      invocation: {
        status: "failed",
        errorCode: "TIMEOUT",
      },
    });
  });

  it("builds a metadata JSON object for metadata_rewrite", async () => {
    const validMeta = {
      url: "unknown",
      currentTitle: "unknown",
      currentDescription: "unknown",
      proposedTitle: "Acme Analytics vs Competitors",
      proposedDescription: "Compare Acme Analytics against alternatives.",
      targetQueries: ["acme vs competitor"],
      rationale: "Addresses the comparison content gap.",
      evidenceRefs: ["ev-1"],
      citedNumbers: [],
    };
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse(validMeta));
    const client = createOpenAIClient({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetchImpl,
    });

    const result = await client.generateArtifact(
      makeInput({ artifactType: "metadata_rewrite" }),
    );

    expect(result.content.contentFormat).toBe("json");
    const obj = result.content.content as Record<string, unknown>;
    expect(obj.proposedTitle).toBe("Acme Analytics vs Competitors");
    expect(obj.evidenceRefs).toEqual(["ev-1"]);
    expect(obj.url).toBeNull();
    expect(obj.currentTitle).toBeNull();
    expect(obj.currentDescription).toBeNull();
  });

  it("preserves literal placeholder-like metadata when it is the known frozen input", async () => {
    const frozenMetadata = {
      url: "https://acme.example/unknown",
      currentTitle: "Unknown",
      currentDescription:
        "N/A <script>api_key=customer-secret-current-metadata</script>",
    };
    const echoedMetadata = safePromptCurrentMetadata(frozenMetadata);
    const validMeta = {
      ...echoedMetadata,
      proposedTitle: "Clarify Acme plans",
      proposedDescription: "Choose the right Acme plan for your team.",
      targetQueries: ["acme pricing"],
      rationale: "Known current metadata must be preserved exactly.",
      evidenceRefs: [],
      citedNumbers: [],
    };
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse(validMeta));
    const client = createOpenAIClient({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetchImpl,
    });

    const result = await client.generateArtifact(
      makeInput({
        artifactType: "metadata_rewrite",
        evidence: [],
        currentMetadata: frozenMetadata,
      }),
    );

    expect(result.content.contentFormat).toBe("json");
    const obj = result.content.content as Record<string, unknown>;
    expect(obj.url).toBe("https://acme.example/unknown");
    expect(obj.currentTitle).toBe("Unknown");
    expect(obj.currentDescription).toBe(frozenMetadata.currentDescription);
  });

  it("rejects a model change to known frozen metadata with REFERENCE_INTEGRITY", async () => {
    const changedMeta = {
      url: "https://acme.example/other",
      currentTitle: "Invented current title",
      currentDescription: "Current plan comparison.",
      proposedTitle: "Compare Acme plans",
      proposedDescription: "Choose the Acme plan that fits your team.",
      targetQueries: ["acme pricing"],
      rationale: "Clarifies the page metadata.",
      evidenceRefs: [],
      citedNumbers: [],
    };
    const client = createOpenAIClient({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetchImpl: vi.fn().mockResolvedValue(chatResponse(changedMeta)),
    });

    const error = await client
      .generateArtifact(
        makeInput({
          artifactType: "metadata_rewrite",
          evidence: [],
          currentMetadata: {
            url: "https://acme.example/pricing",
            currentTitle: "Acme Pricing",
            currentDescription: "Current plan comparison.",
          },
        }),
      )
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "REFERENCE_INTEGRITY",
      invocation: {
        status: "rejected",
        errorCode: "REFERENCE_INTEGRITY",
      },
    });
  });

  it("rejects a fabricated-evidence envelope with REFERENCE_INTEGRITY (rejected invocation)", async () => {
    const fabricated = {
      markdown: "Organic sessions fell 80% last quarter.",
      evidenceRefs: ["ev-1"],
      citedNumbers: [{ value: "80%", evidenceId: "ev-1" }],
    };
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse(fabricated));
    const client = createOpenAIClient({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetchImpl,
    });

    const error = await client
      .generateArtifact(makeInput())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LLMError);
    const llmError = error as LLMError;
    expect(llmError.code).toBe("REFERENCE_INTEGRITY");
    expect(llmError.invocation?.status).toBe("rejected");
    expect(llmError.invocation?.errorCode).toBe("REFERENCE_INTEGRITY");
    expect(llmError.invocation?.outputHash).toBeNull();
  });

  it("maps a non-JSON model body to SCHEMA_INVALID", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(chatResponse("this is not json {"));
    const client = createOpenAIClient({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetchImpl,
    });

    const error = await client
      .generateArtifact(makeInput())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LLMError);
    expect((error as LLMError).code).toBe("SCHEMA_INVALID");
  });

  it("maps an HTTP 429 to RATE_LIMITED with a failed invocation and null tokens", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("rate limited", { status: 429 }));
    const client = createOpenAIClient({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetchImpl,
    });

    const error = await client
      .generateArtifact(makeInput())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LLMError);
    const llmError = error as LLMError;
    expect(llmError.code).toBe("RATE_LIMITED");
    expect(llmError.invocation?.status).toBe("failed");
    expect(llmError.invocation?.inputTokens).toBeNull();
  });

  it("cancels a non-2xx response body without reading it and preserves the HTTP error mapping", async () => {
    const secret = "NON_2XX_BODY_SECRET";
    const fixture = streamFixture({
      status: 429,
      chunks: [new TextEncoder().encode(secret)],
      legacyJson: { leaked: secret },
    });
    fixture.bodyCancel.mockImplementationOnce(() => {
      throw new Error("NON_2XX_CANCEL_FAILURE_SECRET");
    });
    const client = createOpenAIClient({
      apiKey: "http-error-api-secret",
      model: "gpt-4o-mini",
      fetchImpl: vi.fn().mockResolvedValue(fixture.response),
    });

    const error = await client
      .generateArtifact(makeInput())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LLMError);
    expect(error).toMatchObject({
      code: "RATE_LIMITED",
      invocation: {
        status: "failed",
        errorCode: "RATE_LIMITED",
        inputTokens: null,
        outputTokens: null,
      },
    });
    expect(fixture.bodyCancel).toHaveBeenCalledTimes(1);
    expect(fixture.read).not.toHaveBeenCalled();
    expect(String((error as Error).message)).not.toContain(secret);
    expect(String((error as Error).message)).not.toContain(
      "http-error-api-secret",
    );
    expect(String((error as Error).message)).not.toContain(
      "NON_2XX_CANCEL_FAILURE_SECRET",
    );
  });

  it("does not await a non-settling non-2xx body cancellation", async () => {
    vi.useFakeTimers();
    try {
      const fixture = streamFixture({ status: 429 });
      fixture.bodyCancel.mockImplementationOnce(
        () => new Promise<void>(() => undefined),
      );
      const client = createOpenAIClient({
        apiKey: "non-settling-http-cancel-key",
        model: "gpt-4o-mini",
        fetchImpl: vi.fn().mockResolvedValue(fixture.response),
      });

      const outcomePromise = settleBeforeWatchdog(
        client.generateArtifact(makeInput()),
        25,
      );
      await vi.advanceTimersByTimeAsync(25);
      const outcome = await outcomePromise;

      expect(outcome).not.toBe(WATCHDOG_EXPIRED);
      expect(outcome).toMatchObject({
        code: "RATE_LIMITED",
        invocation: { status: "failed", errorCode: "RATE_LIMITED" },
      });
      expect(fixture.bodyCancel).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects an oversized declared Content-Length before reading and cancels the body", async () => {
    const secret = "DECLARED_OVERSIZE_BODY_SECRET";
    const validText = chatResponseText(VALID_MARKDOWN, undefined, {
      padding: secret,
    });
    const fixture = streamFixture({
      contentLength: String(EXPECTED_RESPONSE_BODY_LIMIT_BYTES + 1),
      chunks: [new TextEncoder().encode(validText)],
      legacyJson: JSON.parse(validText),
    });
    const client = createOpenAIClient({
      apiKey: "declared-limit-api-secret",
      model: "gpt-4o-mini",
      fetchImpl: vi.fn().mockResolvedValue(fixture.response),
    });

    const error = await client
      .generateArtifact(makeInput())
      .catch((caught: unknown) => caught);

    expectInvalidResponse(error);
    expect(fixture.bodyCancel).toHaveBeenCalledTimes(1);
    expect(fixture.read).not.toHaveBeenCalled();
    expect(String((error as Error).message)).not.toContain(secret);
    expect(String((error as Error).message)).not.toContain(
      "declared-limit-api-secret",
    );
  });

  it("does not await a non-settling cancellation for a declared oversized body", async () => {
    vi.useFakeTimers();
    try {
      const fixture = streamFixture({
        contentLength: String(EXPECTED_RESPONSE_BODY_LIMIT_BYTES + 1),
      });
      fixture.bodyCancel.mockImplementationOnce(
        () => new Promise<void>(() => undefined),
      );
      const client = createOpenAIClient({
        apiKey: "non-settling-declared-cancel-key",
        model: "gpt-4o-mini",
        fetchImpl: vi.fn().mockResolvedValue(fixture.response),
      });

      const outcomePromise = settleBeforeWatchdog(
        client.generateArtifact(makeInput()),
        25,
      );
      await vi.advanceTimersByTimeAsync(25);
      const outcome = await outcomePromise;

      expect(outcome).not.toBe(WATCHDOG_EXPIRED);
      expectInvalidResponse(outcome);
      expect(fixture.bodyCancel).toHaveBeenCalledTimes(1);
      expect(fixture.read).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not trust a small Content-Length and cancels the decoded stream as soon as actual bytes exceed the cap", async () => {
    const secret = "STREAM_OVERSIZE_BODY_SECRET";
    const oversizedText = chatResponseText(VALID_MARKDOWN, undefined, {
      padding: `${secret}${"x".repeat(EXPECTED_RESPONSE_BODY_LIMIT_BYTES)}`,
    });
    const fixture = streamFixture({
      contentLength: "1",
      chunks: [new TextEncoder().encode(oversizedText)],
      legacyJson: JSON.parse(oversizedText),
    });
    const client = createOpenAIClient({
      apiKey: "stream-limit-api-secret",
      model: "gpt-4o-mini",
      fetchImpl: vi.fn().mockResolvedValue(fixture.response),
    });

    const error = await client
      .generateArtifact(makeInput())
      .catch((caught: unknown) => caught);

    expectInvalidResponse(error);
    expect(fixture.read).toHaveBeenCalledTimes(1);
    expect(fixture.readerCancel).toHaveBeenCalledTimes(1);
    expect(String((error as Error).message)).not.toContain(secret);
    expect(String((error as Error).message)).not.toContain(
      "stream-limit-api-secret",
    );
  });

  it("does not await a non-settling reader cancellation after actual bytes exceed the cap", async () => {
    vi.useFakeTimers();
    try {
      const fixture = streamFixture({
        contentLength: "1",
        chunks: [new Uint8Array(EXPECTED_RESPONSE_BODY_LIMIT_BYTES + 1)],
      });
      fixture.readerCancel.mockImplementationOnce(
        () => new Promise<void>(() => undefined),
      );
      const client = createOpenAIClient({
        apiKey: "non-settling-reader-cancel-key",
        model: "gpt-4o-mini",
        fetchImpl: vi.fn().mockResolvedValue(fixture.response),
      });

      const outcomePromise = settleBeforeWatchdog(
        client.generateArtifact(makeInput()),
        25,
      );
      await vi.advanceTimersByTimeAsync(25);
      const outcome = await outcomePromise;

      expect(outcome).not.toBe(WATCHDOG_EXPIRED);
      expectInvalidResponse(outcome);
      expect(fixture.read).toHaveBeenCalledTimes(1);
      expect(fixture.readerCancel).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts a valid streamed JSON response exactly at the decoded-byte cap", async () => {
    const emptyPadding = chatResponseText(VALID_MARKDOWN, undefined, {
      padding: "",
    });
    const paddingBytes =
      EXPECTED_RESPONSE_BODY_LIMIT_BYTES -
      new TextEncoder().encode(emptyPadding).byteLength;
    expect(paddingBytes).toBeGreaterThan(0);
    const boundaryText = chatResponseText(VALID_MARKDOWN, undefined, {
      padding: "x".repeat(paddingBytes),
    });
    const boundaryBytes = new TextEncoder().encode(boundaryText);
    expect(boundaryBytes.byteLength).toBe(
      EXPECTED_RESPONSE_BODY_LIMIT_BYTES,
    );
    const fixture = streamFixture({
      contentLength: String(EXPECTED_RESPONSE_BODY_LIMIT_BYTES),
      chunks: [boundaryBytes],
      legacyJson: JSON.parse(boundaryText),
    });
    const client = createOpenAIClient({
      apiKey: "boundary-key",
      model: "gpt-4o-mini",
      fetchImpl: vi.fn().mockResolvedValue(fixture.response),
    });

    const result = await client.generateArtifact(makeInput());

    expect(result.invocation.status).toBe("succeeded");
    expect(fixture.bodyCancel).not.toHaveBeenCalled();
    expect(fixture.readerCancel).not.toHaveBeenCalled();
  });

  it("streams a valid response when Content-Length is malformed instead of trusting the header", async () => {
    const body = chatResponseText(VALID_MARKDOWN);
    const fixture = streamFixture({
      contentLength: "not-a-number",
      chunks: [new TextEncoder().encode(body)],
      legacyJson: JSON.parse(body),
    });
    const client = createOpenAIClient({
      apiKey: "malformed-length-key",
      model: "gpt-4o-mini",
      fetchImpl: vi.fn().mockResolvedValue(fixture.response),
    });

    const result = await client.generateArtifact(makeInput());

    expect(result.invocation.status).toBe("succeeded");
    expect(fixture.read).toHaveBeenCalledTimes(2);
  });

  it("cancels and sanitizes failures while acquiring or consuming a response reader", async () => {
    const acquireCancel = vi.fn(async () => undefined);
    const acquireResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      body: {
        cancel: acquireCancel,
        getReader: () => {
          throw new Error("GET_READER_SECRET");
        },
      },
      json: vi.fn(async () => JSON.parse(chatResponseText(VALID_MARKDOWN))),
    } as unknown as Response;
    const invalidChunkCancel = vi.fn(async () => {
      throw new Error("CANCEL_READER_SECRET");
    });
    const invalidChunkResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      body: {
        cancel: vi.fn(async () => undefined),
        getReader: () => ({
          read: vi.fn(async () => ({
            done: false,
            value: "NON_BYTE_CHUNK_SECRET",
          })),
          cancel: invalidChunkCancel,
          releaseLock: () => {
            throw new Error("RELEASE_LOCK_SECRET");
          },
        }),
      },
      json: vi.fn(async () => JSON.parse(chatResponseText(VALID_MARKDOWN))),
    } as unknown as Response;

    for (const response of [acquireResponse, invalidChunkResponse]) {
      const client = createOpenAIClient({
        apiKey: "reader-failure-key",
        model: "gpt-4o-mini",
        fetchImpl: vi.fn().mockResolvedValue(response),
      });
      const error = await client
        .generateArtifact(makeInput())
        .catch((caught: unknown) => caught);
      expectInvalidResponse(error);
      expect(
        JSON.stringify({
          message: (error as Error).message,
          invocation: (error as LLMError).invocation,
        }),
      ).not.toMatch(
        /GET_READER_SECRET|CANCEL_READER_SECRET|NON_BYTE_CHUNK_SECRET|RELEASE_LOCK_SECRET|reader-failure-key/,
      );
    }
    expect(acquireCancel).toHaveBeenCalledTimes(1);
    expect(invalidChunkCancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: "missing body",
      response: {
        ok: true,
        status: 200,
        headers: new Headers(),
        body: null,
        json: vi.fn(async () => JSON.parse(chatResponseText(VALID_MARKDOWN))),
      } as unknown as Response,
    },
    {
      name: "invalid JSON",
      response: streamFixture({
        chunks: [new TextEncoder().encode('{"gateway":"broken"')],
      }).response,
    },
    {
      name: "stream error",
      response: streamFixture({
        readError: new Error("UPSTREAM_STREAM_SECRET"),
        legacyJson: JSON.parse(chatResponseText(VALID_MARKDOWN)),
      }).response,
    },
  ])("maps a $name success response to stable INVALID_RESPONSE", async ({ response }) => {
    const client = createOpenAIClient({
      apiKey: "malformed-body-api-secret",
      model: "gpt-4o-mini",
      fetchImpl: vi.fn().mockResolvedValue(response),
    });

    const error = await client
      .generateArtifact(makeInput())
      .catch((caught: unknown) => caught);

    expectInvalidResponse(error);
    const serialized = JSON.stringify({
      message: (error as Error).message,
      invocation: (error as LLMError).invocation,
    });
    expect(serialized).not.toContain("UPSTREAM_STREAM_SECRET");
    expect(serialized).not.toContain("malformed-body-api-secret");
  });

  it.each([
    [401, "AUTH_FAILED"],
    [403, "AUTH_FAILED"],
    [400, "BAD_REQUEST"],
    [500, "SERVER_ERROR"],
  ] as const)(
    "preserves HTTP %i -> %s mapping while cancelling the response body",
    async (status, code) => {
      const fixture = streamFixture({
        status,
        chunks: [new TextEncoder().encode("ignored provider body")],
      });
      const client = createOpenAIClient({
        apiKey: "http-map-key",
        model: "gpt-4o-mini",
        fetchImpl: vi.fn().mockResolvedValue(fixture.response),
      });

      const error = await client
        .generateArtifact(makeInput())
        .catch((caught: unknown) => caught);

      expect(error).toMatchObject({
        code,
        invocation: { status: "failed", errorCode: code },
      });
      expect(fixture.bodyCancel).toHaveBeenCalledTimes(1);
      expect(fixture.read).not.toHaveBeenCalled();
    },
  );

  it("keeps malformed usage fields null after bounded JSON decoding", async () => {
    const response = new Response(
      chatResponseText(VALID_MARKDOWN, undefined, {
        usage: { prompt_tokens: "secret", completion_tokens: null },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
    const client = createOpenAIClient({
      apiKey: "usage-key",
      model: "gpt-4o-mini",
      fetchImpl: vi.fn().mockResolvedValue(response),
    });

    const result = await client.generateArtifact(makeInput());

    expect(result.invocation.inputTokens).toBeNull();
    expect(result.invocation.outputTokens).toBeNull();
  });

  it("preserves abort timeout mapping while hardening body decoding", async () => {
    const fetchImpl = vi.fn(
      async (_url: string, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("timed out", "AbortError")),
            { once: true },
          );
        }),
    );
    const client = createOpenAIClient({
      apiKey: "timeout-api-secret",
      model: "gpt-4o-mini",
      fetchImpl,
      timeoutMs: 1,
    });

    const error = await client
      .generateArtifact(makeInput())
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "TIMEOUT",
      invocation: { status: "failed", errorCode: "TIMEOUT" },
    });
  });

  it("times out after headers when the decoded body never finishes", async () => {
    vi.useFakeTimers();
    let removeAbortListener: ReturnType<typeof vi.spyOn> | undefined;
    try {
      let markReadStarted: (() => void) | undefined;
      const readStarted = new Promise<void>((resolve) => {
        markReadStarted = resolve;
      });
      const read = vi.fn(() => {
        markReadStarted?.();
        return new Promise<{
          readonly done: boolean;
          readonly value: Uint8Array | undefined;
        }>(() => undefined);
      });
      const readerCancel = vi.fn(() => new Promise<void>(() => undefined));
      const releaseLock = vi.fn();
      const response = {
        ok: true,
        status: 200,
        headers: new Headers(),
        body: {
          cancel: vi.fn(() => new Promise<void>(() => undefined)),
          getReader: () => ({ read, cancel: readerCancel, releaseLock }),
        },
      } as unknown as Response;
      let requestSignal: AbortSignal | undefined;
      const fetchImpl = vi.fn(
        async (_url: string, init?: RequestInit): Promise<Response> => {
          requestSignal = init?.signal ?? undefined;
          if (requestSignal) {
            removeAbortListener = vi.spyOn(
              requestSignal,
              "removeEventListener",
            );
          }
          return response;
        },
      );
      const client = createOpenAIClient({
        apiKey: "body-timeout-api-secret",
        model: "gpt-4o-mini",
        fetchImpl,
        timeoutMs: 50,
      });

      const outcomePromise = settleBeforeWatchdog(
        client.generateArtifact(makeInput()),
        100,
      );
      await readStarted;
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(100);
      const outcome = await outcomePromise;

      expect(outcome).not.toBe(WATCHDOG_EXPIRED);
      expect(outcome).toMatchObject({
        code: "TIMEOUT",
        invocation: {
          status: "failed",
          errorCode: "TIMEOUT",
          inputTokens: null,
          outputTokens: null,
          outputHash: null,
        },
      });
      expect(requestSignal?.aborted).toBe(true);
      expect(readerCancel).toHaveBeenCalledTimes(1);
      expect(releaseLock).toHaveBeenCalledTimes(1);
      expect(removeAbortListener).toHaveBeenCalledWith(
        "abort",
        expect.any(Function),
      );
      expect(vi.getTimerCount()).toBe(0);
      expect(JSON.stringify(outcome)).not.toContain("body-timeout-api-secret");
    } finally {
      removeAbortListener?.mockRestore();
      vi.useRealTimers();
    }
  });

  it("maps a transport failure to NETWORK_ERROR", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("connection reset"));
    const client = createOpenAIClient({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetchImpl,
    });

    const error = await client
      .generateArtifact(makeInput())
      .catch((e: unknown) => e);
    expect((error as LLMError).code).toBe("NETWORK_ERROR");
  });

  it("throws CONFIG_INVALID when constructed without an apiKey", () => {
    expect(() =>
      createOpenAIClient({ apiKey: "", model: "gpt-4o-mini" }),
    ).toThrow(LLMError);
  });

  it("throws CONFIG_INVALID when constructed without a model", () => {
    expect(() => createOpenAIClient({ apiKey: "key", model: "" })).toThrow(
      LLMError,
    );
  });
});

function expectInvalidResponse(error: unknown): void {
  expect(error).toBeInstanceOf(LLMError);
  expect(error).toMatchObject({
    code: "INVALID_RESPONSE",
    invocation: {
      status: "failed",
      errorCode: "INVALID_RESPONSE",
      inputTokens: null,
      outputTokens: null,
      outputHash: null,
    },
  });
}
