import { describe, expect, it, vi } from "vitest";

import { GEO_MAX_MENTION_SNIPPET_CODE_POINTS } from "../agents/geo-alias-match.ts";
import { codePointLength } from "../agents/geo-canonical.ts";
import {
  GeoProviderError,
  type GeoProviderCitationAnnotation,
  type GeoProviderClient,
  type GeoProviderFailureReason,
  type GeoProviderObservation,
} from "../agents/geo-provider.ts";
import type { GeoKbCompetitor } from "./kb-contract.ts";
import type { GeoQuestion } from "./kb-questions.ts";
import {
  VISIBILITY_MAX_SAMPLE_CITATION_URLS,
  type VisibilitySample,
  type VisibilitySampleStatus,
} from "./visibility-contract.ts";
import {
  observeVisibilitySample,
  type VisibilitySampleInput,
} from "./visibility-sampling.ts";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const QUESTION: GeoQuestion = {
  id: "q-1",
  text: "What are the best analytics tools right now?",
  layer: "discovery",
  mode: "retrieval",
  roleId: null,
  requiredEntities: [],
  templateId: "geo.retrieval.category_top",
  calibrated: true,
};

function makeInput(
  overrides: Partial<VisibilitySampleInput> = {},
): VisibilitySampleInput {
  return {
    question: QUESTION,
    sampleIndex: 1,
    targetHost: "acme.com",
    officialName: "Acme",
    aliases: [],
    competitors: [],
    ...overrides,
  };
}

function citation(url: string, ordinal = 0): GeoProviderCitationAnnotation {
  return {
    url,
    title: null,
    annotationText: null,
    providerOutputItemIndex: 0,
    sectionIndex: 0,
    annotationOrdinal: ordinal,
    startIndex: null,
    endIndex: null,
    spanBasis: "provider_message_section_text",
  };
}

function makeObservation(
  overrides: Partial<GeoProviderObservation> = {},
): GeoProviderObservation {
  return {
    observedAt: "2026-08-29T10:00:00.000Z",
    webSearchPerformed: true,
    answerText: "Acme is one of the options people bring up in this category.",
    citations: [],
    citationsComplete: true,
    costUsd: 0.0457,
    model: "gpt-5-2025-08-07",
    ...overrides,
  };
}

/**
 * A provider whose calls are counted.
 *
 * The count is the point of most of this file: the only way to see a retry is
 * to see a second call, and the only way to see a retry that was removed on
 * purpose is to pin the count at one.
 */
function stubProvider(impl: () => Promise<GeoProviderObservation>) {
  const observe = vi.fn(impl);
  const client: GeoProviderClient = { observe: async () => observe() };
  return { client, observe };
}

async function observeOnce(
  impl: () => Promise<GeoProviderObservation>,
  input: VisibilitySampleInput = makeInput(),
): Promise<{
  readonly sample: VisibilitySample;
  readonly calls: number;
}> {
  const { client, observe } = stubProvider(impl);
  const sample = await observeVisibilitySample(input, {
    model: "gpt-5-2025-08-07",
    marketCode: "US",
    provider: client,
  });
  return { sample, calls: observe.mock.calls.length };
}

async function judge(
  observation: GeoProviderObservation,
  input: VisibilitySampleInput = makeInput(),
): Promise<VisibilitySample> {
  const { sample } = await observeOnce(async () => observation, input);
  return sample;
}

/* ------------------------------------------------------------------ */
/* Retries: the one that costs money                                   */
/* ------------------------------------------------------------------ */

describe("transport failures are never retried", () => {
  it("bills and records a timeout after exactly one call", async () => {
    const { sample, calls } = await observeOnce(async () => {
      throw new GeoProviderError("timeout", "deadline", 0.0457);
    });

    expect(calls).toBe(1);
    expect(sample.status).toBe("timeout");
    expect(sample.costUsd).toBe(0.0457);
    // Nothing was read, so neither of these may be asserted as an observation.
    expect(sample.webSearchPerformed).toBeNull();
    expect(sample.cited).toBeNull();
  });

  it("records a network error after exactly one call", async () => {
    const { sample, calls } = await observeOnce(async () => {
      throw new GeoProviderError("network_error", "socket", 0.0457);
    });

    expect(calls).toBe(1);
    expect(sample.status).toBe("error");
    expect(sample.costUsd).toBe(0.0457);
  });

  it("does not send a second request that would have succeeded", async () => {
    // The exact scenario a retry constant above zero is added for. A rejected
    // fetch cannot tell "never sent" from "sent, billed, response lost", so the
    // run reports one fewer answer rather than buying a second charge.
    let attempts = 0;
    const { sample, calls } = await observeOnce(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new GeoProviderError("network_error", "socket", 0.0457);
      }
      return makeObservation();
    });

    expect(calls).toBe(1);
    expect(sample.status).toBe("error");
  });

  it("asks once when the call succeeds", async () => {
    const { sample, calls } = await observeOnce(async () => makeObservation());

    expect(calls).toBe(1);
    expect(sample.status).toBe("ok");
    expect(sample.costUsd).toBe(0.0457);
    expect(sample.observedAt).toBe("2026-08-29T10:00:00.000Z");
  });
});

/* ------------------------------------------------------------------ */
/* Failure classes                                                     */
/* ------------------------------------------------------------------ */

describe("failure reason to sample status", () => {
  const table: readonly (readonly [
    GeoProviderFailureReason,
    VisibilitySampleStatus,
  ])[] = [
    ["not_configured", "blocked"],
    ["auth_failed", "blocked"],
    ["rate_limited", "blocked"],
    ["timeout", "timeout"],
    ["network_error", "error"],
    ["server_error", "error"],
    ["bad_request", "error"],
    ["invalid_response", "error"],
  ];

  it.each(table)("maps %s to %s", async (reason, status) => {
    const { sample } = await observeOnce(async () => {
      throw new GeoProviderError(reason, "failed", null);
    });

    expect(sample.status).toBe(status);
  });

  it("records a non-provider throw as an error rather than letting it escape", async () => {
    const { sample } = await observeOnce(async () => {
      throw new TypeError("something else entirely");
    });

    expect(sample.status).toBe("error");
    expect(sample.costUsd).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Unreadable citation lists                                           */
/* ------------------------------------------------------------------ */

describe("an unreadable citation list keeps the mention", () => {
  it("keeps the answer when the provider marked the list incomplete", async () => {
    const sample = await judge(
      makeObservation({
        citationsComplete: false,
        citations: [citation("https://acme.com/guide")],
      }),
    );

    expect(sample.status).toBe("ok");
    expect(sample.mentioned).toBe(true);
    expect(sample.cited).toBeNull();
    expect(sample.citedDomains).toEqual([]);
    expect(sample.citedUrls).toEqual([]);
    expect(sample.costUsd).toBe(0.0457);
  });

  it("keeps the answer when one citation URL will not canonicalize", async () => {
    const sample = await judge(
      makeObservation({
        citations: [
          citation("https://acme.com/guide"),
          citation("ftp://x/", 1),
        ],
      }),
    );

    expect(sample.status).toBe("ok");
    expect(sample.mentioned).toBe(true);
    expect(sample.cited).toBeNull();
    expect(sample.citedDomains).toEqual([]);
    expect(sample.citedUrls).toEqual([]);
    expect(sample.costUsd).toBe(0.0457);
  });
});

/* ------------------------------------------------------------------ */
/* Own-site citation                                                   */
/* ------------------------------------------------------------------ */

describe("citations of the site under test", () => {
  const CITATIONS = [
    citation("https://www.acme.com/p", 0),
    citation("https://blog.acme.com/p", 1),
    citation("https://ACME.com/p", 2),
  ];

  it("counts www and mixed case as the same host, and a subdomain as another", async () => {
    const sample = await judge(makeObservation({ citations: CITATIONS }));

    expect(sample.cited).toBe(true);
    // Deduplicated by canonical host, in first-cited order. `blog.` is a
    // different site, not a spelling of the same one.
    expect(sample.citedDomains).toEqual(["acme.com", "blog.acme.com"]);
    expect(sample.citedUrls).toEqual([
      "https://www.acme.com/p",
      "https://blog.acme.com/p",
      "https://acme.com/p",
    ]);
  });

  it("does not treat somebody else's subdomain as the site", async () => {
    // `blog.acme.test` may be a hosted platform and `status.acme.test` a
    // vendor's page. Counting a subdomain as owned turns another company's page
    // into evidence that this customer was cited.
    const sample = await judge(
      makeObservation({ citations: [citation("https://blog.acme.com/p")] }),
    );

    expect(sample.cited).toBe(false);
    expect(sample.citedDomains).toEqual(["blog.acme.com"]);
  });

  it("cannot recognize the site when the caller passes an unnormalized host", async () => {
    // Not a wish: this is why the orchestrator runs `normalizeGeoHost` before
    // it builds the run context. A `www.` target host silently matches nothing
    // and the run publishes a permanent zero citation rate.
    const sample = await judge(
      makeObservation({ citations: CITATIONS }),
      makeInput({ targetHost: "www.acme.com" }),
    );

    expect(sample.cited).toBe(false);
    expect(sample.citedDomains).toEqual(["acme.com", "blog.acme.com"]);
  });
});

/* ------------------------------------------------------------------ */
/* Cited URL list                                                      */
/* ------------------------------------------------------------------ */

describe("cited URLs", () => {
  it("keeps one copy of a URL the answer cited three times", async () => {
    const sample = await judge(
      makeObservation({
        citations: [
          citation("https://ref.test/a", 0),
          citation("https://ref.test/a", 1),
          citation("https://ref.test/a", 2),
          citation("https://ref.test/b", 3),
        ],
      }),
    );

    expect(sample.citedUrls).toEqual([
      "https://ref.test/a",
      "https://ref.test/b",
    ]);
    expect(sample.citedDomains).toEqual(["ref.test"]);
  });

  it("stops at the per-sample bound without losing the domains or the target", async () => {
    const overflow = VISIBILITY_MAX_SAMPLE_CITATION_URLS + 3;
    const citations = [
      ...Array.from({ length: overflow }, (_unused, index) =>
        citation(`https://ref${index}.test/p`, index),
      ),
      // Past the bound on purpose: the target citation must still be seen.
      citation("https://acme.com/p", overflow),
    ];

    const sample = await judge(makeObservation({ citations }));

    expect(sample.citedUrls).toHaveLength(VISIBILITY_MAX_SAMPLE_CITATION_URLS);
    expect(sample.citedUrls).toEqual(
      Array.from(
        { length: VISIBILITY_MAX_SAMPLE_CITATION_URLS },
        (_unused, index) => `https://ref${index}.test/p`,
      ),
    );
    // The domain table counts answers per domain and is not bounded here.
    expect(sample.citedDomains).toHaveLength(overflow + 1);
    expect(sample.cited).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Competitors                                                         */
/* ------------------------------------------------------------------ */

describe("competitors named in the answer", () => {
  it("reports only confirmed, distinct, matchable names", async () => {
    const competitors: readonly GeoKbCompetitor[] = [
      { domain: "rival.test", brandName: "Rival", confirmed: true },
      { domain: "ghost.test", brandName: "Ghost", confirmed: false },
      { domain: "rival2.test", brandName: "rival", confirmed: true },
      { domain: "blank.test", brandName: "   ", confirmed: true },
      { domain: "ai.test", brandName: "AI", confirmed: true },
    ];

    const sample = await judge(
      makeObservation({
        answerText:
          "Ghost and Rival are the usual picks, and AI features matter to buyers.",
      }),
      makeInput({ competitors }),
    );

    // One assertion, four rules: unconfirmed names are guesses, names that
    // normalize alike are one rival, a blank name is not a name, and a
    // two-letter name matches every acronym so the matcher never looks for it.
    expect(sample.competitorsMentioned).toEqual(["Rival"]);
  });
});

/* ------------------------------------------------------------------ */
/* Mention versus citation                                             */
/* ------------------------------------------------------------------ */

describe("a mention is read from the prose", () => {
  it("does not let a link to the site manufacture a mention", async () => {
    const named: GeoProviderCitationAnnotation = {
      ...citation("https://ref.test/Acme-review", 1),
      title: "Acme review",
      annotationText: "Acme, reviewed",
    };
    const sample = await judge(
      makeObservation({
        // The brand is absent from the prose and present in every part of the
        // citation record. One of these says the model knows the name; the
        // other says it found a page, and folding them together lets a single
        // link report a mention that never happened.
        answerText:
          "Several established products cover this; the linked guide compares them.",
        citations: [citation("https://acme.com/guide"), named],
      }),
    );

    expect(sample.mentioned).toBe(false);
    expect(sample.excerpt).toBeNull();
    expect(sample.cited).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Cost                                                                */
/* ------------------------------------------------------------------ */

describe("a poisoned price never reaches the run total", () => {
  const poisons: readonly (readonly [string, number])[] = [
    ["NaN", Number.NaN],
    ["negative", -1],
    ["infinite", Number.POSITIVE_INFINITY],
  ];

  it.each(poisons)(
    "drops a %s price from an answered sample",
    async (_label, cost) => {
      const sample = await judge(makeObservation({ costUsd: cost }));

      expect(sample.status).toBe("ok");
      // Null, not the poisoned number and not a zero: one NaN makes the run's
      // total NaN, which serializes to null and reads as "this run was free".
      expect(sample.costUsd).toBeNull();
    },
  );

  it.each(poisons)(
    "drops a %s price from a failed sample",
    async (_label, cost) => {
      const { sample } = await observeOnce(async () => {
        throw new GeoProviderError("server_error", "upstream", cost);
      });

      expect(sample.costUsd).toBeNull();
    },
  );

  it("keeps a genuine zero apart from an unpriced call", async () => {
    const priced = await judge(makeObservation({ costUsd: 0 }));
    const unpriced = await judge(makeObservation({ costUsd: null }));

    expect(priced.costUsd).toBe(0);
    expect(unpriced.costUsd).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Excerpt                                                             */
/* ------------------------------------------------------------------ */

describe("the mention excerpt", () => {
  const LONG_TAIL = "The category has a long tail of similar products. ".repeat(
    50,
  );

  function longAnswer(middle: string): string {
    return `${LONG_TAIL}${middle}${LONG_TAIL}`;
  }

  it("is bounded and centred on the name inside a long answer", async () => {
    const answer = longAnswer("Acme is named here. ");
    expect(codePointLength(answer)).toBeGreaterThan(5_000);

    const sample = await judge(makeObservation({ answerText: answer }));

    expect(sample.mentioned).toBe(true);
    const excerpt = sample.excerpt;
    expect(excerpt).not.toBeNull();
    expect(excerpt).toContain("Acme is named here");
    expect(codePointLength(excerpt ?? "")).toBeLessThanOrEqual(
      GEO_MAX_MENTION_SNIPPET_CODE_POINTS,
    );
  });

  it("is dropped, and the mention kept, when the window carries a lone surrogate", async () => {
    const answer = longAnswer("Acme\uD800 is named here. ");

    const sample = await judge(makeObservation({ answerText: answer }));

    // The observation survives; only the quotation is refused. A lone surrogate
    // hashes and serializes differently on each side of the wire, and repairing
    // it would print text the model never wrote.
    expect(sample.mentioned).toBe(true);
    expect(sample.excerpt).toBeNull();
  });
});
