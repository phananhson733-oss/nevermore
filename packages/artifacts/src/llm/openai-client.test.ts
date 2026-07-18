import { describe, expect, it, vi } from "vitest";
import type { ArtifactPromptInput } from "../types.ts";
import { PROMPT_SET_VERSION } from "../types.ts";
import { LLMError, createOpenAIClient } from "./openai-client.ts";

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
  const body = {
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
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
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

  it("builds a metadata JSON object for metadata_rewrite", async () => {
    const validMeta = {
      url: "https://acme.example/",
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
});
