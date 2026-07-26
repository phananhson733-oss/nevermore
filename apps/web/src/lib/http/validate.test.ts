import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  isMultipartFormDataContentType,
  MAX_JSON_BODY_BYTES,
  parseJsonBody,
  parseMultipartFormDataWithinLimit,
  parseOptionalOutputLocale,
  parseOptionalQueryEnum,
  parseOptionalQueryInteger,
  parseQueryBoolean,
  parseQueryLimit,
  parseQueryValue,
  parseUuidParam,
  requireIdempotencyKey,
  zodToFieldErrors,
} from "./validate";

/**
 * This module is the boundary the spec's §11.1 status vocabulary is decided at:
 * malformed transport is 400, a schema violation is 422 with an RFC6901
 * pointer, an oversized body is 413 `IMPORT_TOO_LARGE` BEFORE anything is
 * parsed (AC-013, spec §14.2), and a malformed path id is 404 so the response
 * cannot be used to probe which ids exist. Every assertion below is about which
 * of those a given input earns, because getting the status wrong here is either
 * an information leak or an unparseable error for every client.
 */

type FakeRequestInit = {
  readonly chunks?: readonly unknown[];
  readonly headers?: Record<string, string>;
  readonly noBody?: boolean;
  readonly aborted?: boolean;
  readonly getReaderThrows?: boolean;
  readonly readRejects?: unknown;
};

const cancelled = { count: 0 };

function fakeRequest(init: FakeRequestInit = {}): NextRequest {
  cancelled.count = 0;
  const queue = [...(init.chunks ?? [])];
  const body = init.noBody
    ? null
    : {
        getReader() {
          if (init.getReaderThrows) throw new Error("no reader");
          return {
            read: async () => {
              if (init.readRejects !== undefined) throw init.readRejects;
              if (queue.length === 0) return { done: true, value: undefined };
              return { done: false, value: queue.shift() };
            },
            cancel: async () => {
              cancelled.count += 1;
            },
            releaseLock: () => undefined,
          };
        },
        cancel: async () => {
          cancelled.count += 1;
        },
      };
  return {
    url: "https://app.test/api/mvp/x",
    headers: new Headers(init.headers ?? {}),
    body,
    signal: { aborted: init.aborted ?? false, addEventListener: vi.fn(), removeEventListener: vi.fn() },
  } as unknown as NextRequest;
}

const jsonRequest = (
  value: unknown,
  headers: Record<string, string> = {},
): NextRequest =>
  fakeRequest({
    chunks: [new TextEncoder().encode(JSON.stringify(value))],
    headers,
  });

const problem = async (run: () => Promise<unknown> | unknown) => {
  try {
    await run();
  } catch (error) {
    return error as { code: string; status: number; fieldErrors?: unknown[] };
  }
  throw new Error("expected the call to reject");
};

describe("the JSON body cap is enforced before anything is parsed", () => {
  it("refuses a declared Content-Length over the cap and cancels the stream", async () => {
    const request = fakeRequest({
      headers: { "content-length": String(MAX_JSON_BODY_BYTES + 1) },
      chunks: [new TextEncoder().encode("{}")],
    });
    const error = await problem(() => parseJsonBody(request, z.object({})));
    expect(error.code).toBe("IMPORT_TOO_LARGE");
    expect(error.status).toBe(413);
    // The point of the header check is not reading the body at all.
    expect(cancelled.count).toBeGreaterThan(0);
  });

  it("still refuses a body that lies about its Content-Length", async () => {
    // A truthful small header with an oversized stream is the bypass the byte
    // counter exists for; trusting the header would buffer the whole payload.
    const request = fakeRequest({
      headers: { "content-length": "2" },
      chunks: [new Uint8Array(MAX_JSON_BODY_BYTES + 1)],
    });
    const error = await problem(() => parseJsonBody(request, z.object({})));
    expect(error.code).toBe("IMPORT_TOO_LARGE");
  });

  it("ignores a Content-Length that is not a plain decimal integer", async () => {
    for (const raw of ["not-a-number", "1e9", "-1", "999999999999999999999"]) {
      const request = fakeRequest({
        headers: { "content-length": raw },
        chunks: [new TextEncoder().encode('{"a":1}')],
      });
      await expect(
        parseJsonBody(request, z.object({ a: z.number() })),
      ).resolves.toEqual({ a: 1 });
    }
  });
});

describe("transport problems are 400, never a schema error", () => {
  it("treats a missing body as a missing body", async () => {
    const error = await problem(() =>
      parseJsonBody(fakeRequest({ noBody: true }), z.object({})),
    );
    expect(error.code).toBe("BAD_REQUEST");
  });

  it("treats an empty body as a missing body", async () => {
    const error = await problem(() =>
      parseJsonBody(fakeRequest({ chunks: [] }), z.object({})),
    );
    expect(error.code).toBe("BAD_REQUEST");
  });

  it("rejects a stream chunk that is not bytes", async () => {
    const error = await problem(() =>
      parseJsonBody(fakeRequest({ chunks: ["{}"] }), z.object({})),
    );
    expect(error.code).toBe("BAD_REQUEST");
  });

  it("keeps 400 when the transport rejects with a misleading ProblemError", async () => {
    // A rejection value is untrusted input like any other; adopting its code
    // would let a transport failure choose the response status.
    const error = await problem(() =>
      parseJsonBody(
        fakeRequest({ readRejects: { code: "IMPORT_TOO_LARGE", status: 413 } }),
        z.object({}),
      ),
    );
    expect(error.code).toBe("BAD_REQUEST");
  });

  it("fails an already-aborted request instead of waiting on it", async () => {
    const error = await problem(() =>
      parseJsonBody(
        fakeRequest({
          aborted: true,
          chunks: [new TextEncoder().encode("{}")],
        }),
        z.object({}),
      ),
    );
    expect(error.code).toBe("BAD_REQUEST");
  });

  it("rejects a reader that cannot be acquired", async () => {
    const error = await problem(() =>
      parseJsonBody(fakeRequest({ getReaderThrows: true }), z.object({})),
    );
    expect(error.code).toBe("BAD_REQUEST");
  });

  it("rejects bytes that are not valid UTF-8, and invalid JSON, as 400", async () => {
    const notUtf8 = await problem(() =>
      parseJsonBody(
        fakeRequest({ chunks: [new Uint8Array([0xff, 0xfe, 0xfd])] }),
        z.object({}),
      ),
    );
    expect(notUtf8.code).toBe("BAD_REQUEST");
    const notJson = await problem(() =>
      parseJsonBody(
        fakeRequest({ chunks: [new TextEncoder().encode("{oops")] }),
        z.object({}),
      ),
    );
    expect(notJson.code).toBe("BAD_REQUEST");
  });

  it("assembles a body split across chunks, skipping empty ones", async () => {
    const encoder = new TextEncoder();
    const request = fakeRequest({
      chunks: [
        encoder.encode('{"a":'),
        new Uint8Array(0),
        encoder.encode("1}"),
      ],
    });
    await expect(
      parseJsonBody(request, z.object({ a: z.number() })),
    ).resolves.toEqual({ a: 1 });
  });
});

describe("a schema violation is 422 with a JSON pointer", () => {
  it("points at the failing field rather than at the request", async () => {
    const error = await problem(() =>
      parseJsonBody(
        jsonRequest({ profile: { personas: [{ name: 1 }] } }),
        z.object({
          profile: z.object({
            personas: z.array(z.object({ name: z.string() })),
          }),
        }),
      ),
    );
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.status).toBe(422);
    expect(error.fieldErrors?.[0]).toMatchObject({
      pointer: "/profile/personas/0/name",
    });
  });

  it("escapes `~` and `/` in a pointer segment per RFC6901", () => {
    const parsed = z
      .object({ "a/b~c": z.string() })
      .safeParse({ "a/b~c": 1 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(zodToFieldErrors(parsed.error)[0]?.pointer).toBe("/a~1b~0c");
    }
  });
});

describe("a scalar query parameter may appear at most once", () => {
  it("refuses a duplicate rather than picking a winner", () => {
    // Whichever value the app picked, a proxy or cache in front of it could
    // pick the other; the disagreement is the bug, not the value.
    const params = new URLSearchParams("limit=10&limit=100");
    const error = { code: "", fieldErrors: [] as unknown[] };
    try {
      parseQueryLimit(params);
    } catch (thrown) {
      Object.assign(error, thrown);
    }
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.fieldErrors[0]).toMatchObject({
      pointer: "/limit",
      code: "duplicate_query_parameter",
    });
  });

  it("applies the same rule to every scalar reader", () => {
    const dup = new URLSearchParams("x=1&x=2");
    expect(() => parseQueryValue(dup, "x", z.string())).toThrow();
    expect(() => parseOptionalQueryEnum(dup, "x", ["1", "2"])).toThrow();
    expect(() => parseQueryBoolean(dup, "x", false)).toThrow();
    expect(() =>
      parseOptionalQueryInteger(dup, "x", { minimum: 0 }),
    ).toThrow();
  });
});

describe("query scalars accept only their canonical spelling", () => {
  it("reads booleans as `true`/`false` and nothing else", () => {
    expect(parseQueryBoolean(new URLSearchParams("f=true"), "f", false)).toBe(
      true,
    );
    expect(parseQueryBoolean(new URLSearchParams("f=false"), "f", true)).toBe(
      false,
    );
    expect(parseQueryBoolean(new URLSearchParams(""), "f", true)).toBe(true);
    for (const raw of ["TRUE", "1", "yes", ""]) {
      expect(() =>
        parseQueryBoolean(new URLSearchParams(`f=${raw}`), "f", false),
      ).toThrow();
    }
  });

  it("keeps `limit` an integer in 1..100 and defaults only when absent", () => {
    expect(parseQueryLimit(new URLSearchParams(""), 25)).toBe(25);
    expect(parseQueryLimit(new URLSearchParams("limit=1"))).toBe(1);
    expect(parseQueryLimit(new URLSearchParams("limit=100"))).toBe(100);
    for (const raw of ["0", "101", "050", "+5", "5.0", " 5", ""]) {
      expect(() =>
        parseQueryLimit(new URLSearchParams(`limit=${raw}`)),
      ).toThrow();
    }
  });

  it("keeps an optional integer inside its declared bounds", () => {
    const read = (raw: string) =>
      parseOptionalQueryInteger(new URLSearchParams(`n=${raw}`), "n", {
        minimum: 2,
        maximum: 9,
      });
    expect(read("2")).toBe(2);
    expect(read("9")).toBe(9);
    expect(
      parseOptionalQueryInteger(new URLSearchParams(""), "n", { minimum: 0 }),
    ).toBeNull();
    for (const raw of ["1", "10", "007", "-1", "1.5"]) {
      expect(() => read(raw)).toThrow();
    }
  });

  it("defaults an omitted maximum to the safe-integer ceiling", () => {
    const params = new URLSearchParams("n=9007199254740991");
    expect(parseOptionalQueryInteger(params, "n", { minimum: 0 })).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("refuses an enum value it was not given, without echoing it back", () => {
    const params = new URLSearchParams("kind=<script>");
    const error = { fieldErrors: [] as { message?: string }[] };
    try {
      parseOptionalQueryEnum(params, "kind", ["a", "b"]);
    } catch (thrown) {
      Object.assign(error, thrown);
    }
    expect(error.fieldErrors[0]?.message).not.toContain("script");
    expect(parseOptionalQueryEnum(new URLSearchParams("kind=b"), "kind", ["a", "b"])).toBe("b");
    expect(parseOptionalQueryEnum(new URLSearchParams(""), "kind", ["a"])).toBeNull();
  });

  it("refuses an unsupported outputLocale instead of falling back silently", () => {
    expect(parseOptionalOutputLocale(new URLSearchParams(""))).toBeNull();
    expect(
      parseOptionalOutputLocale(new URLSearchParams("outputLocale=en")),
    ).toBe("en");
    const error = { code: "", fieldErrors: [] as unknown[] };
    try {
      // Underscore is the POSIX spelling, not the BCP-47 one; accepting it
      // would silently produce a locale no downstream renderer resolves.
      parseOptionalOutputLocale(new URLSearchParams("outputLocale=en_US"));
    } catch (thrown) {
      Object.assign(error, thrown);
    }
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.fieldErrors[0]).toMatchObject({ pointer: "/outputLocale" });
  });
});

describe("caller mistakes in this module's own arguments are programmer errors", () => {
  it("refuses a nonsense body cap rather than disabling the cap", async () => {
    for (const cap of [0, -1, 1.5, Number.NaN]) {
      await expect(
        parseMultipartFormDataWithinLimit(
          fakeRequest({ headers: { "content-type": "multipart/form-data; boundary=x" } }),
          cap,
        ),
      ).rejects.toBeInstanceOf(RangeError);
    }
  });

  it("refuses a default limit outside the contract's own 1..100 range", () => {
    for (const bad of [0, 101, 1.5]) {
      expect(() => parseQueryLimit(new URLSearchParams(""), bad)).toThrow(
        RangeError,
      );
    }
  });

  it("refuses integer bounds that are negative or inverted", () => {
    const params = new URLSearchParams("n=1");
    expect(() =>
      parseOptionalQueryInteger(params, "n", { minimum: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      parseOptionalQueryInteger(params, "n", { minimum: 5, maximum: 4 }),
    ).toThrow(RangeError);
  });
});

describe("multipart bodies are recognised by media type, not by guesswork", () => {
  it("matches the base type case-insensitively and only with a parameter break", () => {
    expect(isMultipartFormDataContentType("multipart/form-data")).toBe(true);
    expect(
      isMultipartFormDataContentType("MULTIPART/Form-Data; boundary=abc"),
    ).toBe(true);
    expect(isMultipartFormDataContentType("multipart/form-dataX")).toBe(false);
    expect(isMultipartFormDataContentType("application/json")).toBe(false);
    expect(isMultipartFormDataContentType("")).toBe(false);
  });

  it("refuses a request with no Content-Type at all", async () => {
    const error = await problem(() =>
      parseMultipartFormDataWithinLimit(fakeRequest({}), 1024),
    );
    expect(error.code).toBe("BAD_REQUEST");
  });
});

describe("identity and idempotency headers", () => {
  it("treats a malformed path id as absent, so 404 never confirms existence", () => {
    const error = { code: "", status: 0 };
    try {
      parseUuidParam("not-a-uuid");
    } catch (thrown) {
      Object.assign(error, thrown);
    }
    expect(error.code).toBe("NOT_FOUND");
    expect(error.status).toBe(404);
    const valid = "00000000-0000-4000-8000-000000000042";
    expect(parseUuidParam(valid)).toBe(valid);
  });

  it("requires an Idempotency-Key header before any work is attempted", () => {
    expect(() => requireIdempotencyKey(fakeRequest({}))).toThrow();
    expect(() =>
      requireIdempotencyKey(
        fakeRequest({ headers: { "idempotency-key": "" } }),
      ),
    ).toThrow();
    expect(
      requireIdempotencyKey(
        fakeRequest({ headers: { "idempotency-key": "abc-123" } }),
      ),
    ).toBe("abc-123");
  });
});
