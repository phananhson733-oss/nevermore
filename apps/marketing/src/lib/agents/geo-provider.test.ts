// @input  -- recorded DataForSEO ChatGPT payloads and injected transport faults
// @output -- proof the collector reads answers and citations the way the provider writes them
// @pos    -- focused tests for the GEO Agent's only provider transport

import { describe, expect, it, vi } from "vitest";
import {
  createGeoProviderClient,
  DATAFORSEO_CHAT_GPT_LLM_RESPONSES_LIVE_URL,
  GEO_MAX_OUTPUT_TOKENS,
  GeoProviderError,
  normalizeProviderTimestamp,
  type GeoProviderFetch,
} from "./geo-provider.ts";

const REQUEST = {
  prompt: "Which tools show whether my brand appears in AI search answers?",
  model: "gpt-5-2025-08-07",
  marketCode: "US",
} as const;

/**
 * Shaped exactly like a recorded response.
 *
 * The `reasoning` item before the `message` one is not padding: every real
 * response carries one or more, and a collector that flattens all items would
 * read the model's scratchpad as its answer.
 */
function payload(
  overrides: {
    readonly items?: unknown;
    readonly webSearch?: boolean;
    readonly datetime?: unknown;
    readonly taskStatus?: number;
    readonly cost?: number;
  } = {},
): unknown {
  return {
    status_code: 20_000,
    cost: overrides.cost ?? 0.045_458,
    tasks: [
      {
        id: "08170921-1234-0664-0000-abcdef012345",
        status_code: overrides.taskStatus ?? 20_000,
        cost: overrides.cost ?? 0.045_458,
        result_count: 1,
        result: [
          {
            datetime: overrides.datetime ?? "2026-08-17 09:21:39 +00:00",
            model_name: "gpt-5-2025-08-07",
            web_search: overrides.webSearch ?? true,
            input_tokens: 8_694,
            output_tokens: 1_003,
            reasoning_tokens: 448,
            items: overrides.items ?? [
              {
                type: "reasoning",
                sections: [
                  {
                    type: "summary_text",
                    text: "The user is asking about Acme and rival tools.",
                  },
                ],
              },
              {
                type: "message",
                sections: [
                  {
                    type: "text",
                    text: "Several tools cover this, including Acme.",
                    annotations: [
                      {
                        title: "Acme pricing",
                        url: "https://acme.test/pricing?utm_source=openai",
                        start_index: 12,
                        end_index: 40,
                        text: "([acme.test](https://acme.test/pricing))",
                      },
                      {
                        title: "Rival overview",
                        url: "https://www.rival.test/overview",
                        start_index: 41,
                        end_index: 60,
                        text: "([rival.test](https://www.rival.test/overview))",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function respondWith(
  value: unknown,
  init: ResponseInit = {},
): GeoProviderFetch {
  return vi.fn(async () =>
    Promise.resolve(
      new Response(JSON.stringify(value), {
        status: 200,
        headers: { "content-type": "application/json" },
        ...init,
      }),
    ),
  );
}

function client(fetchImpl: GeoProviderFetch) {
  return createGeoProviderClient({
    login: "test-login",
    password: "test-password",
    fetchImpl,
  });
}

describe("createGeoProviderClient", () => {
  it("reads the answer, its citations, the search flag and the cost", async () => {
    const observation = await client(respondWith(payload())).observe(REQUEST);

    expect(observation.answerText).toBe(
      "Several tools cover this, including Acme.",
    );
    expect(observation.citedUrls).toEqual([
      "https://acme.test/pricing?utm_source=openai",
      "https://www.rival.test/overview",
    ]);
    expect(observation.webSearchPerformed).toBe(true);
    expect(observation.costUsd).toBeCloseTo(0.045_458, 6);
    expect(observation.observedAt).toBe("2026-08-17T09:21:39.000Z");
    expect(observation.model).toBe("gpt-5-2025-08-07");
  });

  it("never reads a reasoning item as the answer", async () => {
    const observation = await client(respondWith(payload())).observe(REQUEST);

    expect(observation.answerText).not.toContain("The user is asking");
  });

  it("ignores citations that live on a reasoning item", async () => {
    const fetchImpl = respondWith(
      payload({
        items: [
          {
            type: "reasoning",
            sections: [
              {
                type: "summary_text",
                text: "Considering sources.",
                annotations: [
                  { title: "Ghost", url: "https://ghost.test/considered" },
                ],
              },
            ],
          },
          {
            type: "message",
            sections: [{ type: "text", text: "An answer.", annotations: [] }],
          },
        ],
      }),
    );

    const observation = await client(fetchImpl).observe(REQUEST);

    expect(observation.citedUrls).toEqual([]);
  });

  it("counts an annotation that carries no type key at all", async () => {
    // Every annotation in the recorded calibration was this shape. A parser
    // that requires type === "url_citation" finds nothing and reports a site
    // as uncited when it was cited.
    const fetchImpl = respondWith(
      payload({
        items: [
          {
            type: "message",
            sections: [
              {
                type: "text",
                text: "An answer.",
                annotations: [
                  { title: "Acme", url: "https://acme.test/", start_index: 0 },
                ],
              },
            ],
          },
        ],
      }),
    );

    const observation = await client(fetchImpl).observe(REQUEST);

    expect(observation.citedUrls).toEqual(["https://acme.test/"]);
  });

  it("ignores a bare url object with none of a citation's other fields", async () => {
    // A missing `type` is how every real citation arrives, so it cannot be
    // rejected on its own — but neither is it sufficient evidence.
    const fetchImpl = respondWith(
      payload({
        items: [
          {
            type: "message",
            sections: [
              {
                type: "text",
                text: "No source is cited in this sentence.",
                annotations: [{ url: "https://injected.test/article" }],
              },
            ],
          },
        ],
      }),
    );

    const observation = await client(fetchImpl).observe(REQUEST);

    expect(observation.citedUrls).toEqual([]);
  });

  it.each([
    ["url_citation", ["https://acme.test/"]],
    ["file_citation", []],
  ] as const)("handles an explicit %s annotation", async (type, expected) => {
    const fetchImpl = respondWith(
      payload({
        items: [
          {
            type: "message",
            sections: [
              {
                type: "text",
                text: "An answer.",
                annotations: [
                  { type, url: "https://acme.test/", title: "Acme" },
                ],
              },
            ],
          },
        ],
      }),
    );

    const observation = await client(fetchImpl).observe(REQUEST);

    expect(observation.citedUrls).toEqual(expected);
  });

  it("records that the provider skipped the web search", async () => {
    const fetchImpl = respondWith(payload({ webSearch: false }));

    const observation = await client(fetchImpl).observe(REQUEST);

    expect(observation.webSearchPerformed).toBe(false);
  });

  it("fails a call whose reasoning consumed the whole output budget", async () => {
    // Three of eight calibration calls looked exactly like this at a 1024
    // ceiling: billed, successful, and carrying no message item.
    const fetchImpl = respondWith(
      payload({
        items: [
          {
            type: "reasoning",
            sections: [{ type: "summary_text", text: "Thinking." }],
          },
          { type: "reasoning", sections: [] },
        ],
      }),
    );

    await expect(client(fetchImpl).observe(REQUEST)).rejects.toMatchObject({
      reason: "invalid_response",
      costUsd: 0.045_458,
    });
  });

  it("asks for the full output ceiling and pins web search on", async () => {
    const fetchImpl = respondWith(payload());
    await client(fetchImpl).observe(REQUEST);

    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe(DATAFORSEO_CHAT_GPT_LLM_RESPONSES_LIVE_URL);
    expect(init.redirect).toBe("error");
    const sent = JSON.parse(String(init.body)) as ReadonlyArray<
      Record<string, unknown>
    >;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      user_prompt: REQUEST.prompt,
      model_name: REQUEST.model,
      max_output_tokens: GEO_MAX_OUTPUT_TOKENS,
      web_search: true,
      web_search_country_iso_code: "US",
    });
  });

  it.each([
    [401, "auth_failed"],
    [403, "auth_failed"],
    [429, "rate_limited"],
    [500, "server_error"],
    [400, "bad_request"],
  ] as const)("maps HTTP %i to %s", async (status, reason) => {
    const fetchImpl: GeoProviderFetch = vi.fn(async () =>
      Promise.resolve(new Response("", { status })),
    );

    await expect(client(fetchImpl).observe(REQUEST)).rejects.toMatchObject({
      reason,
    });
  });

  it("reports a failed provider task and still books its cost", async () => {
    const fetchImpl = respondWith(payload({ taskStatus: 40_501, cost: 0.01 }));

    await expect(client(fetchImpl).observe(REQUEST)).rejects.toMatchObject({
      reason: "bad_request",
      costUsd: 0.01,
    });
  });

  it("refuses a prompt longer than the provider accepts", async () => {
    const fetchImpl = respondWith(payload());

    await expect(
      client(fetchImpl).observe({ ...REQUEST, prompt: "a".repeat(501) }),
    ).rejects.toMatchObject({ reason: "bad_request" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an unmapped market code before paying for the answer", async () => {
    const fetchImpl = respondWith(payload());

    await expect(
      client(fetchImpl).observe({ ...REQUEST, marketCode: "usa" }),
    ).rejects.toMatchObject({ reason: "bad_request" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses to call the provider without credentials", async () => {
    const fetchImpl = respondWith(payload());
    const unconfigured = createGeoProviderClient({
      login: "",
      password: "",
      fetchImpl,
    });

    await expect(unconfigured.observe(REQUEST)).rejects.toMatchObject({
      reason: "not_configured",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never puts the credentials or the provider prose in the error", async () => {
    const fetchImpl: GeoProviderFetch = vi.fn(async () =>
      Promise.resolve(
        new Response("upstream said something quotable", { status: 500 }),
      ),
    );

    let caught: unknown;
    try {
      await client(fetchImpl).observe(REQUEST);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GeoProviderError);
    const { message } = caught as GeoProviderError;
    expect(message).not.toContain("test-password");
    expect(message).not.toContain("test-login");
    expect(message).not.toContain("quotable");
  });

  it("times out rather than waiting on a hanging provider", async () => {
    const fetchImpl: GeoProviderFetch = vi.fn(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    const impatient = createGeoProviderClient({
      login: "l",
      password: "p",
      fetchImpl,
      timeoutMs: 5,
    });

    await expect(impatient.observe(REQUEST)).rejects.toMatchObject({
      reason: "timeout",
    });
  });

  it.each([
    ["not an object", 42],
    ["no tasks", { status_code: 20_000, cost: 0 }],
    ["two tasks", { status_code: 20_000, cost: 0, tasks: [{}, {}] }],
  ] as const)("fails closed on a response with %s", async (_label, value) => {
    const fetchImpl = respondWith(value);

    await expect(client(fetchImpl).observe(REQUEST)).rejects.toMatchObject({
      reason: "invalid_response",
    });
  });

  it("fails closed on an unusable observation time", async () => {
    const fetchImpl = respondWith(payload({ datetime: "last Tuesday" }));

    await expect(client(fetchImpl).observe(REQUEST)).rejects.toMatchObject({
      reason: "invalid_response",
    });
  });
});

describe("normalizeProviderTimestamp", () => {
  it.each([
    ["2026-08-17 09:21:39 +00:00", "2026-08-17T09:21:39.000Z"],
    ["2026-08-17 09:21:39 +0000", "2026-08-17T09:21:39.000Z"],
    ["2026-08-17T09:21:39Z", "2026-08-17T09:21:39.000Z"],
    ["2026-08-17 11:21:39 +02:00", "2026-08-17T09:21:39.000Z"],
    ["2026-08-17 09:21:39.500 +00:00", "2026-08-17T09:21:39.000Z"],
  ] as const)("normalizes %s", (input, expected) => {
    expect(normalizeProviderTimestamp(input)).toBe(expected);
  });

  it.each([null, undefined, 42, "", "last Tuesday", "2026-08-17"])(
    "rejects %s",
    (value) => {
      expect(normalizeProviderTimestamp(value)).toBeNull();
    },
  );
});
