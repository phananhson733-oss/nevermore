import { describe, expect, it, vi } from "vitest";
import { ANALYSIS_INVOCATION_TASKS } from "../types.ts";
import { LLMError } from "./openai-client.ts";
import {
  MAX_TOPIC_MODEL_CHILDREN,
  MAX_TOPIC_MODEL_GROUPS,
  MAX_TOPIC_MODEL_LABEL_CHARS,
  MAX_TOPIC_MODEL_REPRESENTATIVE_KEYWORDS,
  TOPIC_MODEL_PROMPT_SET_VERSION,
  createOpenAITopicModelClient,
  prepareTopicModelGeneration,
  type TopicModelGenerationInput,
  type TopicModelTransport,
} from "./topic-model-client.ts";

const USAGE = { inputTokens: 41, outputTokens: 23 } as const;

const VALID_OUTPUT = {
  root: {
    topicKey: "growth",
    label: "Growth",
    description: "The product's complete organic-growth surface.",
    children: [
      {
        topicKey: "analytics",
        label: "Analytics",
        description: "Measure and explain product usage.",
      },
      {
        topicKey: "automation",
        label: "Automation",
        description: "Automate lifecycle work.",
      },
    ],
  },
  assignments: [
    {
      groupKey: "group-analytics",
      topicKey: "analytics",
      intent: "informational",
    },
    {
      groupKey: "group-automation",
      topicKey: "automation",
      intent: "commercial",
    },
  ],
} as const;

function input(
  overrides: Partial<TopicModelGenerationInput> = {},
): TopicModelGenerationInput {
  return {
    market: "US",
    language: "en",
    productProfile: {
      productName: "RelayOps",
      oneLiner: "Lifecycle automation for product-led teams.",
      category: "Customer lifecycle automation",
      valueProposition: "Turn product signals into timely customer actions.",
      coreFeatures: ["Journey analytics", "Lifecycle automation"],
    },
    icp: {
      targetCompanyOrAudience: "B2B SaaS product teams",
      buyerRoles: ["VP Product"],
      userRoles: ["Product manager", "Lifecycle marketer"],
      useCases: ["Find activation gaps", "Automate customer follow-up"],
      pains: ["Fragmented product signals"],
      outcomes: ["Higher activation and retention"],
    },
    groups: [
      {
        groupKey: "group-automation",
        representativeKeywords: [
          "product lifecycle automation",
          "customer follow-up automation",
        ],
        keywordCount: 4,
        aggregateSearchVolume: 900,
        providerIntentDistribution: {
          informational: 0,
          navigational: 0,
          commercial: 2,
          transactional: 0,
        },
        urls: ["https://relayops.example/automation"],
      },
      {
        groupKey: "group-analytics",
        representativeKeywords: [
          "product journey analytics",
          "user journey reporting",
        ],
        keywordCount: 3,
        aggregateSearchVolume: 1_200,
        providerIntentDistribution: {
          informational: 1,
          navigational: 0,
          commercial: 0,
          transactional: 0,
        },
        urls: ["https://relayops.example/analytics"],
      },
    ],
    ...overrides,
  };
}

function fakeTransport(
  output: unknown = VALID_OUTPUT,
): TopicModelTransport & {
  readonly complete: ReturnType<typeof vi.fn>;
} {
  return {
    complete: vi.fn().mockResolvedValue({
      content: typeof output === "string" ? output : JSON.stringify(output),
      usage: USAGE,
    }),
  };
}

function client(transport: TopicModelTransport) {
  return createOpenAITopicModelClient({
    apiKey: "fake-client-option-secret",
    model: "gpt-4.1-mini",
    transport,
  });
}

function sentContext(transport: ReturnType<typeof fakeTransport>): unknown {
  const call = transport.complete.mock.calls[0] as [
    { readonly system: string; readonly user: string },
  ];
  const serialized = call[0].user
    .split("<UNTRUSTED_TOPIC_MODEL_DATA>\n")[1]!
    .split("\n</UNTRUSTED_TOPIC_MODEL_DATA>")[0]!;
  return JSON.parse(serialized);
}

async function rejection(
  output: unknown,
  generationInput: TopicModelGenerationInput = input(),
): Promise<LLMError> {
  const error = await client(fakeTransport(output))
    .generateTopicModel(generationInput)
    .catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(LLMError);
  return error as LLMError;
}

describe("bounded Topic Model structured client", () => {
  it("uses the dedicated invocation discriminator", () => {
    expect(ANALYSIS_INVOCATION_TASKS).toContain("topic_model_generation");
  });

  it("sends only canonical bounded groups, URLs, market/language, and authorized facts", async () => {
    const transport = fakeTransport();
    const dirty = input({
      productProfile: {
        ...input().productProfile!,
        valueProposition:
          "Turn signals into actions. password=topic-context-secret",
        coreFeatures: ["Lifecycle automation", "Journey analytics"],
      },
      groups: [...input().groups].reverse().map((group) => ({
        ...group,
        representativeKeywords: [...group.representativeKeywords].reverse(),
        urls:
          group.groupKey === "group-analytics"
            ? [
                "https://relayops.example/analytics?Password\u200B=url-secret#private",
              ]
            : group.urls,
      })),
    });

    await client(transport).generateTopicModel(dirty);

    expect(sentContext(transport)).toEqual({
      market: "US",
      language: "en",
      productProfile: {
        productName: "RelayOps",
        oneLiner: "Lifecycle automation for product-led teams.",
        category: "Customer lifecycle automation",
        valueProposition: "Turn signals into actions. password=[redacted]",
        coreFeatures: ["Journey analytics", "Lifecycle automation"],
      },
      icp: {
        targetCompanyOrAudience: "B2B SaaS product teams",
        buyerRoles: ["VP Product"],
        userRoles: ["Lifecycle marketer", "Product manager"],
        useCases: ["Automate customer follow-up", "Find activation gaps"],
        pains: ["Fragmented product signals"],
        outcomes: ["Higher activation and retention"],
      },
      groups: [
        {
          groupKey: "group-analytics",
          representativeKeywords: [
            "product journey analytics",
            "user journey reporting",
          ],
          keywordCount: 3,
          aggregateSearchVolume: 1_200,
          providerIntentDistribution: {
            informational: 1,
            navigational: 0,
            commercial: 0,
            transactional: 0,
          },
          urls: [
            expect.stringContaining("https://relayops.example/analytics"),
          ],
        },
        {
          ...input().groups[0],
          representativeKeywords: [
            "customer follow-up automation",
            "product lifecycle automation",
          ],
        },
      ],
    });
    const messages = transport.complete.mock.calls[0]![0] as {
      readonly system: string;
      readonly user: string;
    };
    expect(`${messages.system}\n${messages.user}`).not.toContain(
      "fake-client-option-secret",
    );
    expect(messages.user).not.toContain("topic-context-secret");
    expect(messages.user).not.toContain("url-secret");
    expect(messages.user).not.toContain("#private");
  });

  it.each([
    ["raw provider response", { rawProviderResponse: { private: true } }],
    ["credential", { credentials: { apiKey: "must-not-leak" } }],
    ["review body", { reviewBody: "private review" }],
    ["page content", { pageContent: "arbitrary page body" }],
    ["actor ID", { actorId: "00000000-0000-4000-8000-000000000001" }],
    ["timestamp", { createdAt: "2026-08-09T00:00:00.000Z" }],
    ["revision", { topicModelRevision: 7 }],
    ["UUID", { topicNodeId: "00000000-0000-4000-8000-000000000002" }],
    ["hash", { inputHash: "a".repeat(64) }],
  ])("rejects a client input carrying %s before transport", async (_label, extra) => {
    const transport = fakeTransport();
    const unsafe = { ...input(), ...extra } as TopicModelGenerationInput;

    const error = await client(transport)
      .generateTopicModel(unsafe)
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "CONFIG_INVALID", invocation: null });
    expect(transport.complete).not.toHaveBeenCalled();
  });

  it("canonicalizes semantically equal input and exposes only its hash in preflight", () => {
    const first = prepareTopicModelGeneration(input());
    const reordered = input({
      groups: [...input().groups]
        .reverse()
        .map((group) => ({
          ...group,
          representativeKeywords: [...group.representativeKeywords].reverse(),
          urls: [...group.urls].reverse(),
        })),
      productProfile: {
        ...input().productProfile!,
        coreFeatures: [...input().productProfile!.coreFeatures].reverse(),
      },
      icp: {
        ...input().icp!,
        userRoles: [...input().icp!.userRoles].reverse(),
        useCases: [...input().icp!.useCases].reverse(),
      },
    });

    expect(prepareTopicModelGeneration(reordered)).toEqual(first);
    expect(first).toEqual({
      inputHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(Object.keys(first)).toEqual(["inputHash"]);
    expect(
      prepareTopicModelGeneration(
        input({ market: "CA" }),
      ).inputHash,
    ).not.toBe(first.inputHash);
  });

  it.each([
    [
      "too many groups",
      input({
        groups: Array.from({ length: MAX_TOPIC_MODEL_GROUPS + 1 }, (_, index) => ({
          ...input().groups[0]!,
          groupKey: `group-${index + 1}`,
        })),
      }),
    ],
    [
      "too many representative keywords",
      input({
        groups: [
          {
            ...input().groups[0]!,
            keywordCount: MAX_TOPIC_MODEL_REPRESENTATIVE_KEYWORDS + 1,
            representativeKeywords: Array.from(
              { length: MAX_TOPIC_MODEL_REPRESENTATIVE_KEYWORDS + 1 },
              (_, index) => `keyword ${index + 1}`,
            ),
          },
        ],
      }),
    ],
  ])("rejects bounded-input overflow: %s", async (_label, value) => {
    const transport = fakeTransport();
    const error = await client(transport)
      .generateTopicModel(value)
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "CONFIG_INVALID", invocation: null });
    expect(transport.complete).not.toHaveBeenCalled();
  });

  it("compiles one root plus children and assignments without persistent IDs", async () => {
    const result = await client(fakeTransport()).generateTopicModel(input());

    expect(result).toEqual({
      rootIntent: {
        kind: "create_root",
        topicKey: "growth",
        label: "Growth",
        description: "The product's complete organic-growth surface.",
        intentEnvelope: [],
      },
      childIntents: [
        {
          kind: "create_child",
          topicKey: "analytics",
          parentTopicKey: "growth",
          label: "Analytics",
          description: "Measure and explain product usage.",
          intentEnvelope: ["informational"],
        },
        {
          kind: "create_child",
          topicKey: "automation",
          parentTopicKey: "growth",
          label: "Automation",
          description: "Automate lifecycle work.",
          intentEnvelope: ["commercial"],
        },
      ],
      groupAssignments: [
        {
          groupKey: "group-analytics",
          topicKey: "analytics",
          generatedIntent: "informational",
        },
        {
          groupKey: "group-automation",
          topicKey: "automation",
          generatedIntent: "commercial",
        },
      ],
      unassignedGroupKeys: [],
      invocation: {
        task: "topic_model_generation",
        provider: "openai",
        model: "gpt-4.1-mini",
        promptSetVersion: TOPIC_MODEL_PROMPT_SET_VERSION,
        inputHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
        outputHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
        status: "succeeded",
        inputTokens: 41,
        outputTokens: 23,
        costUsd: null,
        latencyMs: expect.any(Number),
        errorCode: null,
      },
    });
    expect(JSON.stringify(result)).not.toContain(JSON.stringify(VALID_OUTPUT));
    expect(JSON.stringify(result)).not.toMatch(
      /topicNodeId|revision|actorId|createdAt|confirmedAt|inputHash.*inputHash/iu,
    );
  });

  it("canonicalizes output before compiling and hashing it", async () => {
    const reordered = {
      assignments: [...VALID_OUTPUT.assignments].reverse(),
      root: {
        ...VALID_OUTPUT.root,
        children: [...VALID_OUTPUT.root.children].reverse(),
      },
    };
    const first = await client(fakeTransport()).generateTopicModel(input());
    const second = await client(fakeTransport(reordered)).generateTopicModel(
      input(),
    );

    expect(second.rootIntent).toEqual(first.rootIntent);
    expect(second.childIntents).toEqual(first.childIntents);
    expect(second.groupAssignments).toEqual(first.groupAssignments);
    expect(second.invocation.outputHash).toBe(first.invocation.outputHash);
  });

  it.each([
    ["empty root", { ...VALID_OUTPUT, root: null }],
    [
      "multiple roots",
      { roots: [VALID_OUTPUT.root, VALID_OUTPUT.root], assignments: [] },
    ],
    [
      "duplicate topic key",
      {
        ...VALID_OUTPUT,
        root: {
          ...VALID_OUTPUT.root,
          children: [
            VALID_OUTPUT.root.children[0],
            { ...VALID_OUTPUT.root.children[1], topicKey: "analytics" },
          ],
        },
      },
    ],
    [
      "duplicate normalized label",
      {
        ...VALID_OUTPUT,
        root: {
          ...VALID_OUTPUT.root,
          children: [
            VALID_OUTPUT.root.children[0],
            { ...VALID_OUTPUT.root.children[1], label: " analytics " },
          ],
        },
      },
    ],
    [
      "third level",
      {
        ...VALID_OUTPUT,
        root: {
          ...VALID_OUTPUT.root,
          children: [
            {
              ...VALID_OUTPUT.root.children[0],
              children: [VALID_OUTPUT.root.children[1]],
            },
          ],
        },
      },
    ],
    [
      "too many nodes",
      {
        ...VALID_OUTPUT,
        root: {
          ...VALID_OUTPUT.root,
          children: Array.from(
            { length: MAX_TOPIC_MODEL_CHILDREN + 1 },
            (_, index) => ({
              topicKey: `topic-${index + 1}`,
              label: `Topic ${index + 1}`,
              description: null,
            }),
          ),
        },
        assignments: [],
      },
    ],
    [
      "too many assignments",
      {
        ...VALID_OUTPUT,
        assignments: Array.from(
          { length: MAX_TOPIC_MODEL_GROUPS + 1 },
          (_, index) => ({
            groupKey: `group-${index + 1}`,
            topicKey: "analytics",
            intent: "commercial",
          }),
        ),
      },
    ],
    [
      "overlong label",
      {
        ...VALID_OUTPUT,
        root: { ...VALID_OUTPUT.root, label: "x".repeat(MAX_TOPIC_MODEL_LABEL_CHARS + 1) },
      },
    ],
    [
      "unknown intent",
      {
        ...VALID_OUTPUT,
        assignments: [
          { ...VALID_OUTPUT.assignments[0], intent: "researching" },
        ],
      },
    ],
  ])("rejects malformed structured output: %s", async (_label, output) => {
    const error = await rejection(output);

    expect(error).toMatchObject({
      code: "SCHEMA_INVALID",
      invocation: {
        task: "topic_model_generation",
        status: "rejected",
        outputHash: null,
      },
    });
  });

  it.each([
    ["unknown group", [{ ...VALID_OUTPUT.assignments[0], groupKey: "missing" }]],
    [
      "duplicate group assignment",
      [VALID_OUTPUT.assignments[0], VALID_OUTPUT.assignments[0]],
    ],
    ["unknown topic", [{ ...VALID_OUTPUT.assignments[0], topicKey: "missing" }]],
  ])("rejects assignment reference failure: %s", async (_label, assignments) => {
    const error = await rejection({ ...VALID_OUTPUT, assignments });

    expect(error).toMatchObject({
      code: "REFERENCE_INTEGRITY",
      invocation: { status: "rejected", outputHash: null },
    });
  });

  it.each([
    ["topicNodeId", "00000000-0000-4000-8000-000000000003"],
    ["revision", 3],
    ["actorId", "00000000-0000-4000-8000-000000000004"],
    ["createdAt", "2026-08-09T00:00:00.000Z"],
    ["confirmed", true],
    ["contentHash", "b".repeat(64)],
  ])("rejects model-authored server fact %s", async (field, value) => {
    const canary = "model-output-canary";
    const output = {
      ...VALID_OUTPUT,
      root: { ...VALID_OUTPUT.root, [field]: value, canary },
    };

    const error = await rejection(output);

    expect(error).toMatchObject({
      code: "SCHEMA_INVALID",
      invocation: { status: "rejected", outputHash: null },
    });
    expect(error.detail).not.toContain(canary);
  });

  it.each([
    ["HTML", "<script>alert(1)</script>"],
    ["credential", "Password=model-output-canary"],
    ["API key assignment", "apiKey=model-output-canary"],
    ["token assignment", "token=model-output-canary"],
    [
      "authorization header",
      `Authorization: Bearer ${"model-output-canary".repeat(2)}`,
    ],
    [
      "raw provider envelope",
      '{"choices":[{"message":{"content":"provider-output-canary"}}]}',
    ],
    ["raw provider marker", "RAW_PROVIDER_RESPONSE: provider-output-canary"],
    ["durable UUID", "00000000-0000-4000-8000-000000000005"],
    ["server hash", `sha256:${"c".repeat(64)}`],
    ["timestamp", "2026-08-09T00:00:00.000Z"],
    ["active URI", "javascript:alert(1)"],
  ])("rejects unsafe %s hidden inside an allowed semantic field", async (_label, value) => {
    const output = {
      ...VALID_OUTPUT,
      root: { ...VALID_OUTPUT.root, description: value },
    };

    const error = await rejection(output);

    expect(error).toMatchObject({
      code: "SAFETY_VIOLATION",
      invocation: {
        task: "topic_model_generation",
        status: "rejected",
        outputHash: null,
      },
    });
    expect(error.detail).not.toContain(value);
    expect(JSON.stringify(error)).not.toContain(value);
  });

  it("keeps ordinary data and JavaScript topic prose usable", async () => {
    const description =
      "Customer data: activation metrics. JavaScript: SDK integrations.";
    const result = await client(
      fakeTransport({
        ...VALID_OUTPUT,
        root: { ...VALID_OUTPUT.root, description },
      }),
    ).generateTopicModel(input());

    expect(result.rootIntent.description).toBe(description);
    expect(result.invocation.status).toBe("succeeded");
  });

  it("keeps omitted groups explicitly unassigned", async () => {
    const result = await client(
      fakeTransport({
        ...VALID_OUTPUT,
        assignments: [VALID_OUTPUT.assignments[0]],
      }),
    ).generateTopicModel(input());

    expect(result.unassignedGroupKeys).toEqual(["group-automation"]);
  });

  it("distinguishes invalid structured responses from transport failures", async () => {
    const invalid = await rejection("not-json");
    const providerCanary = "private-provider-error-body";
    const transport: TopicModelTransport = {
      complete: vi.fn().mockRejectedValue(new Error(providerCanary)),
    };
    const failed = await client(transport)
      .generateTopicModel(input())
      .catch((caught: unknown) => caught);

    expect(invalid).toMatchObject({
      code: "SCHEMA_INVALID",
      invocation: { status: "rejected" },
    });
    expect(failed).toBeInstanceOf(LLMError);
    expect(failed).toMatchObject({
      code: "NETWORK_ERROR",
      invocation: {
        task: "topic_model_generation",
        status: "failed",
        outputHash: null,
      },
    });
    expect(JSON.stringify(failed)).not.toContain(providerCanary);
  });

  it("fails closed when the transport returns no structured content", async () => {
    const transport: TopicModelTransport = {
      complete: vi.fn().mockResolvedValue({ content: null, usage: USAGE }),
    };
    const error = await client(transport)
      .generateTopicModel(input())
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "INVALID_RESPONSE",
      invocation: { status: "failed", outputHash: null },
    });
  });
});
