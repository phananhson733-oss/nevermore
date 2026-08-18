// @input  -- recorded DataForSEO ChatGPT payloads and injected transport faults
// @output -- proof the collector reads answers and citations the way the provider writes them
// @pos    -- focused tests for the GEO Agent's only provider transport

import { describe, expect, it, vi } from "vitest";
import {
  createGeoProviderClient,
  DATAFORSEO_CHAT_GPT_LLM_RESPONSES_LIVE_URL,
  GEO_MAX_ANNOTATION_TEXT_CODE_POINTS,
  GEO_MAX_ANNOTATION_TITLE_CODE_POINTS,
  GEO_MAX_CITATIONS_PER_SAMPLE,
  GEO_MAX_OUTPUT_TOKENS,
  GeoProviderError,
  normalizeProviderTimestamp,
  type GeoProviderFetch,
} from "./geo-provider.ts";

/** One message item wrapping the given sections, at output-item index 0. */
function messageItems(sections: readonly unknown[]): readonly unknown[] {
  return [{ type: "message", sections }];
}

function citedUrls(observation: {
  readonly citations: readonly { readonly url: string }[];
}): readonly string[] {
  return observation.citations.map((citation) => citation.url);
}

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
    expect(citedUrls(observation)).toEqual([
      "https://acme.test/pricing?utm_source=openai",
      "https://www.rival.test/overview",
    ]);
    expect(observation.citationsComplete).toBe(true);
    expect(observation.webSearchPerformed).toBe(true);
    expect(observation.costUsd).toBeCloseTo(0.045_458, 6);
    expect(observation.observedAt).toBe("2026-08-17T09:21:39.000Z");
    expect(observation.model).toBe("gpt-5-2025-08-07");
  });

  it("keeps the title, anchor text, span and location of each annotation", async () => {
    // The old collector returned bare URLs. Everything the report now renders
    // as exact evidence — the link text a reader saw, where in the answer it
    // sat, which output item and section it belonged to — was thrown away here.
    const observation = await client(respondWith(payload())).observe(REQUEST);

    expect(observation.citations[0]).toEqual({
      url: "https://acme.test/pricing?utm_source=openai",
      title: "Acme pricing",
      annotationText: "([acme.test](https://acme.test/pricing))",
      providerOutputItemIndex: 1,
      sectionIndex: 0,
      annotationOrdinal: 0,
      startIndex: 12,
      endIndex: 40,
      spanBasis: "provider_message_section_text",
    });
  });

  it("numbers the output item as the provider does, reasoning items included", async () => {
    // Not an ordinal among message items: the provider's own indices are what
    // a later payload comparison has to line up against.
    const observation = await client(respondWith(payload())).observe(REQUEST);

    for (const citation of observation.citations) {
      expect(citation.providerOutputItemIndex).toBe(1);
    }
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

    expect(observation.citations).toEqual([]);
    expect(observation.citationsComplete).toBe(true);
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

    expect(citedUrls(observation)).toEqual(["https://acme.test/"]);
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

    expect(observation.citations).toEqual([]);
    // A rejected non-citation shape does not make extraction incomplete: if it
    // did, one injected object could push every sample to `unavailable`.
    expect(observation.citationsComplete).toBe(true);
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

    expect(citedUrls(observation)).toEqual(expected);
  });

  it("keeps two different paths on one host as two citations", async () => {
    const fetchImpl = respondWith(
      payload({
        items: messageItems([
          {
            type: "text",
            text: "Acme covers both cases.",
            annotations: [
              { title: "Pricing", url: "https://acme.test/pricing" },
              { title: "Docs", url: "https://acme.test/docs" },
            ],
          },
        ]),
      }),
    );

    const observation = await client(fetchImpl).observe(REQUEST);

    expect(citedUrls(observation)).toEqual([
      "https://acme.test/pricing",
      "https://acme.test/docs",
    ]);
  });

  it("keeps the same URL cited at two answer spans as two citations", async () => {
    const fetchImpl = respondWith(
      payload({
        items: messageItems([
          {
            type: "text",
            text: "Acme is one option. Acme also does this.",
            annotations: [
              {
                title: "Acme",
                url: "https://acme.test/",
                start_index: 0,
                end_index: 4,
              },
              {
                title: "Acme",
                url: "https://acme.test/",
                start_index: 20,
                end_index: 24,
              },
            ],
          },
        ]),
      }),
    );

    const observation = await client(fetchImpl).observe(REQUEST);

    expect(observation.citations).toHaveLength(2);
    expect(observation.citations.map((c) => [c.startIndex, c.endIndex])).toEqual(
      [
        [0, 4],
        [20, 24],
      ],
    );
  });

  it("keeps two same-URL span-less annotations apart by their ordinal", async () => {
    // Without the ordinal in the key these collapse into one, and an answer
    // that cited a page twice reads as an answer that cited it once.
    const fetchImpl = respondWith(
      payload({
        items: messageItems([
          {
            type: "text",
            text: "Acme appears twice.",
            annotations: [
              { title: "Acme", url: "https://acme.test/" },
              { title: "Acme", url: "https://acme.test/" },
            ],
          },
        ]),
      }),
    );

    const observation = await client(fetchImpl).observe(REQUEST);

    expect(observation.citations).toHaveLength(2);
    expect(observation.citations.map((c) => c.annotationOrdinal)).toEqual([
      0, 1,
    ]);
  });

  it("collapses a genuine duplicate at the same location and span", async () => {
    const fetchImpl = respondWith(
      payload({
        items: messageItems([
          {
            type: "text",
            text: "Acme appears once.",
            annotations: [
              {
                title: "Acme",
                url: "https://acme.test/",
                start_index: 0,
                end_index: 4,
              },
              {
                title: "Acme",
                url: "https://ACME.test/",
                start_index: 0,
                end_index: 4,
              },
            ],
          },
        ]),
      }),
    );

    const observation = await client(fetchImpl).observe(REQUEST);

    expect(observation.citations).toHaveLength(1);
  });

  it.each([
    ["a malformed URL", "not a url"],
    ["a non-http scheme", "ftp://acme.test/x"],
    ["credentials in the URL", "https://user:pw@acme.test/x"],
  ] as const)(
    "marks extraction incomplete when a citation carries %s",
    async (_label, url) => {
      // The answer cited something the parser cannot represent. Reporting the
      // remaining list as whole would let "cited nobody" describe an answer
      // whose citations were unreadable.
      const fetchImpl = respondWith(
        payload({
          items: messageItems([
            {
              type: "text",
              text: "An answer.",
              annotations: [
                { title: "Good", url: "https://acme.test/ok" },
                { title: "Broken", url },
              ],
            },
          ]),
        }),
      );

      const observation = await client(fetchImpl).observe(REQUEST);

      expect(citedUrls(observation)).toEqual(["https://acme.test/ok"]);
      expect(observation.citationsComplete).toBe(false);
    },
  );

  it("marks extraction incomplete when the annotation collection is not a list", async () => {
    const fetchImpl = respondWith(
      payload({
        items: messageItems([
          { type: "text", text: "An answer.", annotations: "nope" },
        ]),
      }),
    );

    const observation = await client(fetchImpl).observe(REQUEST);

    expect(observation.citations).toEqual([]);
    expect(observation.citationsComplete).toBe(false);
  });

  it("treats a section with no annotations key as an answer that cited nobody", async () => {
    const fetchImpl = respondWith(
      payload({ items: messageItems([{ type: "text", text: "An answer." }]) }),
    );

    const observation = await client(fetchImpl).observe(REQUEST);

    expect(observation.citations).toEqual([]);
    expect(observation.citationsComplete).toBe(true);
  });

  it.each([
    ["a reversed pair", { start_index: 9, end_index: 2 }],
    ["a negative start", { start_index: -1, end_index: 4 }],
    ["an end past the section text", { start_index: 0, end_index: 999 }],
    ["a fractional index", { start_index: 0.5, end_index: 4 }],
    ["a string index", { start_index: "0", end_index: "4" }],
    ["only a start", { start_index: 0 }],
  ] as const)("nulls both ends of %s rather than repairing it", async (_label, span) => {
    const fetchImpl = respondWith(
      payload({
        items: messageItems([
          {
            type: "text",
            text: "Acme is here.",
            annotations: [{ title: "Acme", url: "https://acme.test/", ...span }],
          },
        ]),
      }),
    );

    const observation = await client(fetchImpl).observe(REQUEST);

    expect(observation.citations[0]!.startIndex).toBeNull();
    expect(observation.citations[0]!.endIndex).toBeNull();
    expect(observation.citationsComplete).toBe(true);
  });

  it("accepts a span that ends exactly at the end of the section text", async () => {
    // End-exclusive and measured in UTF-16 code units, which is what
    // `String.prototype.length` counts and what the provider indexes with.
    const text = "Acme";
    const fetchImpl = respondWith(
      payload({
        items: messageItems([
          {
            type: "text",
            text,
            annotations: [
              {
                title: "Acme",
                url: "https://acme.test/",
                start_index: 0,
                end_index: text.length,
              },
            ],
          },
        ]),
      }),
    );

    const observation = await client(fetchImpl).observe(REQUEST);

    expect(observation.citations[0]!.endIndex).toBe(4);
  });

  it("indexes the span in UTF-16 code units, not code points", async () => {
    const text = "\u{1f680} Acme";
    const fetchImpl = respondWith(
      payload({
        items: messageItems([
          {
            type: "text",
            text,
            annotations: [
              {
                title: "Acme",
                url: "https://acme.test/",
                start_index: 3,
                end_index: 7,
              },
            ],
          },
        ]),
      }),
    );

    const observation = await client(fetchImpl).observe(REQUEST);
    const { startIndex, endIndex } = observation.citations[0]!;

    expect(text.slice(startIndex!, endIndex!)).toBe("Acme");
  });

  it("drops an over-long title or anchor text rather than shortening it", async () => {
    // The report calls these values exact. A silently shortened one would make
    // that sentence false for the record that carries it, so the field becomes
    // absent instead — the URL and the location stay exact either way.
    const fetchImpl = respondWith(
      payload({
        items: messageItems([
          {
            type: "text",
            text: "An answer.",
            annotations: [
              {
                title: "t".repeat(GEO_MAX_ANNOTATION_TITLE_CODE_POINTS + 1),
                text: "x".repeat(GEO_MAX_ANNOTATION_TEXT_CODE_POINTS + 1),
                url: "https://acme.test/",
              },
            ],
          },
        ]),
      }),
    );

    const observation = await client(fetchImpl).observe(REQUEST);

    expect(observation.citations).toHaveLength(1);
    expect(observation.citations[0]!.title).toBeNull();
    expect(observation.citations[0]!.annotationText).toBeNull();
  });

  it("bounds how many citations one sample may carry and says it truncated", async () => {
    const annotations = Array.from(
      { length: GEO_MAX_CITATIONS_PER_SAMPLE + 5 },
      (_unused, index) => ({
        title: `Source ${index}`,
        url: `https://source-${index}.test/`,
      }),
    );
    const fetchImpl = respondWith(
      payload({
        items: messageItems([
          { type: "text", text: "A wide answer.", annotations },
        ]),
      }),
    );

    const observation = await client(fetchImpl).observe(REQUEST);

    expect(observation.citations).toHaveLength(GEO_MAX_CITATIONS_PER_SAMPLE);
    expect(observation.citationsComplete).toBe(false);
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
