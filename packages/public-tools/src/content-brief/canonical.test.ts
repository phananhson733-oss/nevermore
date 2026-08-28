import { describe, expect, it } from "vitest";

import {
  briefFingerprint,
  canonicalize,
  draftFingerprint,
  fingerprintCanonical,
  sha256Hex,
} from "./canonical.ts";
import {
  CONTENT_BRIEF_SCHEMA,
  DRAFT_RESULT_SCHEMA,
  type ContentBrief,
  type DraftResult,
  type Unavailable,
} from "./contract.ts";

/** RFC 6234 / FIPS 180-4 test vectors. */
const SHA256_EMPTY =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const SHA256_ABC =
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

const NOT_REQUESTED: Unavailable = {
  status: "unavailable",
  reason: "not_requested",
  attempted: null,
};

function makeBrief(): ContentBrief {
  return {
    schema: CONTENT_BRIEF_SCHEMA,
    run: {
      run_id: "run-1",
      collected_at: "2026-08-29T00:00:00.000Z",
      elapsed_ms: 1234,
      budget_ms: 45_000,
      mode: "degraded",
      reads: {
        serp: { status: "complete", requested: 10, returned: 10, unresolved: 0 },
        crawl: {
          status: "complete",
          attempted: 10,
          observed: 8,
          truncated: 0,
          failed: 1,
          skipped: 1,
        },
        gsc: NOT_REQUESTED,
        product_profile: NOT_REQUESTED,
        llm: {
          ...NOT_REQUESTED,
          reason: "not_configured",
          calls: 0,
          model_id: null,
          input_tokens: null,
          output_tokens: null,
        },
      },
      fingerprint: "to-be-replaced",
    },
    keyword: {
      primary: "crm software",
      supporting: ["crm tools"],
      market: "US",
      language: "en",
    },
    evidence: {
      serp: [
        {
          id: "S1",
          rank: 1,
          url: "https://example.com/blog/crm",
          domain: "example.com",
          title: "CRM guide",
          format: {
            value: "guide",
            method: "heuristic",
            rules_hit: ["path:blog"],
          },
        },
      ],
      crawl: { observed: [], failed: [], skipped: [] },
      profile: null,
      gsc_query_page: [],
      gsc_pages: [],
    },
    verdict: {
      action: "undecidable",
      reason: "no_gsc_property",
      provenance: null,
    },
    intent: NOT_REQUESTED,
    format: NOT_REQUESTED,
    length: NOT_REQUESTED,
    must_answer: { status: "available", items: [] },
    outline: NOT_REQUESTED,
    gap_angle: NOT_REQUESTED,
    internal_links: NOT_REQUESTED,
    do_not_cover: NOT_REQUESTED,
    draft_readiness: {
      writable: [],
      gaps: ["no_product_profile", "no_gsc", "llm_unavailable"],
    },
    budget: {
      outline_cap: 7,
      must_answer_cap: 8,
      must_answer_min_pages: 3,
      must_answer_candidates: 0,
      must_answer_shown: 0,
      must_answer_hidden: 0,
    },
  };
}

function makeDraft(): DraftResult {
  return {
    schema: DRAFT_RESULT_SCHEMA,
    run: {
      run_id: "draft-1",
      reran_from: null,
      collected_at: "2026-08-29T00:00:00.000Z",
      elapsed_ms: 999,
      budget_ms: 120_000,
      mode: "unavailable",
      reads: {
        sections: { requested: 0, ok: 0, failed: 0, skipped: 0 },
        llm_sections: {
          ...NOT_REQUESTED,
          reason: "not_configured",
          calls: 0,
          model_id: null,
          input_tokens: null,
          output_tokens: null,
          failed_reasons: [],
        },
        llm_coverage: {
          ...NOT_REQUESTED,
          reason: "not_configured",
          calls: 0,
          model_id: null,
          input_tokens: null,
          output_tokens: null,
        },
      },
      fingerprint: "to-be-replaced",
    },
    brief_ref: {
      schema: CONTENT_BRIEF_SCHEMA,
      run_id: "run-1",
      fingerprint: "abc",
      keyword: "crm software",
    },
    settings: {
      tone: "explanatory",
      person: "second",
      product_mention: "none",
    },
    sections: [],
    coverage: NOT_REQUESTED,
    verify_before_publish: [],
    totals: { word_count: 0 },
  };
}

describe("canonicalize", () => {
  it("orders object keys by UTF-16 code unit and emits no whitespace", () => {
    expect(canonicalize({ b: 1, a: 2, B: 3, "": 4 })).toBe(
      '{"":4,"B":3,"a":2,"b":1}',
    );
  });

  it("is insensitive to the insertion order of keys", () => {
    expect(canonicalize({ z: 1, y: { d: 1, c: 2 } })).toBe(
      canonicalize({ y: { c: 2, d: 1 }, z: 1 }),
    );
  });

  it("skips undefined-valued keys but keeps null", () => {
    expect(canonicalize({ a: undefined, b: null, c: 1 })).toBe(
      '{"b":null,"c":1}',
    );
    expect(canonicalize({ a: undefined })).toBe("{}");
  });

  it("keeps array order and turns undefined elements into null like JSON", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalize([undefined, 1])).toBe("[null,1]");
  });

  it("serialises sparse-array holes at the head, middle and tail as null, never skipping them", () => {
    expect(canonicalize(Array(1))).toBe("[null]");
    expect(canonicalize(Array(3))).toBe("[null,null,null]");
    // eslint-disable-next-line no-sparse-arrays -- the hole is the point of the test
    expect(canonicalize([, 1])).toBe("[null,1]");
    // eslint-disable-next-line no-sparse-arrays -- the hole is the point of the test
    expect(canonicalize([1, , 2])).toBe("[1,null,2]");
    // eslint-disable-next-line no-sparse-arrays -- the hole is the point of the test
    expect(canonicalize([1, ,])).toBe("[1,null]");
    expect(canonicalize({ a: Array(2) })).toBe(JSON.stringify({ a: Array(2) }));
  });

  it("gives a sparse array a different fingerprint from the empty array", async () => {
    expect(await fingerprintCanonical(Array(1))).not.toBe(
      await fingerprintCanonical([]),
    );
    expect(await fingerprintCanonical({ a: Array(1) })).not.toBe(
      await fingerprintCanonical({ a: [] }),
    );
  });

  it("serialises nested structures recursively", () => {
    expect(canonicalize({ b: [{ y: 1, x: [true, false] }], a: "s" })).toBe(
      '{"a":"s","b":[{"x":[true,false],"y":1}]}',
    );
  });

  it("formats numbers exactly like JSON.stringify", () => {
    expect(canonicalize(1.5)).toBe("1.5");
    expect(canonicalize(-0)).toBe("0");
    expect(canonicalize(1e21)).toBe("1e+21");
    expect(canonicalize(Number.NaN)).toBe("null");
    expect(canonicalize(Number.POSITIVE_INFINITY)).toBe("null");
  });

  it("escapes strings exactly like JSON.stringify", () => {
    expect(canonicalize('a"b\\c\né')).toBe(JSON.stringify('a"b\\c\né'));
    expect(canonicalize({ 'k"ey': "v" })).toBe('{"k\\"ey":"v"}');
  });

  it("handles scalars and null at the top level", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize("x")).toBe('"x"');
  });

  it("refuses non-plain objects instead of silently emitting {}", () => {
    expect(() => canonicalize(new Date(0))).toThrow(TypeError);
    expect(() => canonicalize(new Map())).toThrow(TypeError);
    expect(() => canonicalize({ a: 1n })).toThrow(TypeError);
    expect(canonicalize(Object.create(null))).toBe("{}");
  });

  it("does not mutate its input", () => {
    const input = { b: [1, { d: undefined, c: 2 }], a: 1 };
    const snapshot = JSON.stringify(input);
    canonicalize(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("sha256Hex", () => {
  it("matches the reference vectors through WebCrypto", async () => {
    expect(await sha256Hex("", globalThis.crypto.subtle)).toBe(SHA256_EMPTY);
    expect(await sha256Hex("abc", globalThis.crypto.subtle)).toBe(SHA256_ABC);
  });

  it("matches the reference vectors through the node:crypto fallback", async () => {
    expect(await sha256Hex("", null)).toBe(SHA256_EMPTY);
    expect(await sha256Hex("abc", null)).toBe(SHA256_ABC);
  });

  it("hashes UTF-8 bytes, not UTF-16 code units, on both paths", async () => {
    const viaSubtle = await sha256Hex("é😀", globalThis.crypto.subtle);
    const viaNode = await sha256Hex("é😀", null);
    expect(viaSubtle).toBe(viaNode);
    expect(viaSubtle).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("fingerprintCanonical", () => {
  it("is sha256 of the canonical form", async () => {
    expect(await fingerprintCanonical({ b: 1, a: "abc" })).toBe(
      await sha256Hex('{"a":"abc","b":1}', null),
    );
  });

  it("gives the same digest for key-permuted inputs", async () => {
    expect(await fingerprintCanonical({ a: 1, b: 2 })).toBe(
      await fingerprintCanonical({ b: 2, a: 1 }),
    );
  });
});

describe("briefFingerprint", () => {
  it("ignores run.fingerprint and run.elapsed_ms", async () => {
    const base = makeBrief();
    const variant: ContentBrief = {
      ...base,
      run: {
        ...base.run,
        fingerprint: "something-else",
        elapsed_ms: base.run.elapsed_ms + 1,
      },
    };
    expect(await briefFingerprint(variant)).toBe(await briefFingerprint(base));
  });

  it("changes when any other field changes", async () => {
    const base = makeBrief();
    const fp = await briefFingerprint(base);
    const changedKeyword: ContentBrief = {
      ...base,
      keyword: { ...base.keyword, primary: "crm softwar" },
    };
    const changedRun: ContentBrief = {
      ...base,
      run: { ...base.run, run_id: "run-2" },
    };
    const changedNested: ContentBrief = {
      ...base,
      evidence: {
        ...base.evidence,
        serp: [
          {
            ...base.evidence.serp[0]!,
            format: { ...base.evidence.serp[0]!.format, rules_hit: [] },
          },
        ],
      },
    };
    expect(await briefFingerprint(changedKeyword)).not.toBe(fp);
    expect(await briefFingerprint(changedRun)).not.toBe(fp);
    expect(await briefFingerprint(changedNested)).not.toBe(fp);
  });

  it("equals sha256(canonicalize(brief without the two volatile run fields))", async () => {
    const brief = makeBrief();
    const {
      fingerprint: _fingerprint,
      elapsed_ms: _elapsed,
      ...run
    } = brief.run;
    expect(await briefFingerprint(brief)).toBe(
      await fingerprintCanonical({ ...brief, run }),
    );
  });

  it("does not mutate the brief", async () => {
    const brief = makeBrief();
    const snapshot = JSON.stringify(brief);
    await briefFingerprint(brief);
    expect(JSON.stringify(brief)).toBe(snapshot);
    expect(brief.run.fingerprint).toBe("to-be-replaced");
    expect(brief.run.elapsed_ms).toBe(1234);
  });
});

describe("draftFingerprint", () => {
  it("ignores run.fingerprint and run.elapsed_ms but not other fields", async () => {
    const base = makeDraft();
    const fp = await draftFingerprint(base);
    const volatile: DraftResult = {
      ...base,
      run: { ...base.run, fingerprint: "x", elapsed_ms: 1 },
    };
    const changed: DraftResult = { ...base, totals: { word_count: 1 } };
    expect(await draftFingerprint(volatile)).toBe(fp);
    expect(await draftFingerprint(changed)).not.toBe(fp);
  });

  it("does not mutate the draft", async () => {
    const draft = makeDraft();
    const snapshot = JSON.stringify(draft);
    await draftFingerprint(draft);
    expect(JSON.stringify(draft)).toBe(snapshot);
  });
});
