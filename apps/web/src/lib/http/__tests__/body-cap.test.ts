import type { NextRequest } from "next/server";
import { ProblemError } from "@sf/observability";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  MAX_JSON_BODY_BYTES,
  parseJsonBody,
  parseMultipartFormDataWithinLimit,
} from "@/lib/http/validate";

/**
 * AC-013 (spec §14.2): request-body hardening. An oversized or
 * decompression-bomb-style JSON payload must be rejected by a body-size cap
 * (413 `IMPORT_TOO_LARGE` — the frozen registry's only "payload too large" code)
 * BEFORE any JSON parsing or schema validation runs.
 *
 * The cap is enforced while reading the decoded Fetch stream; Content-Length is
 * only a fast-reject hint and cannot replace the streamed byte count. Pure — no
 * database.
 */

const schema = z.object({ ok: z.boolean() });
const textSchema = z.object({ value: z.string() });
const encoder = new TextEncoder();

function jsonStreamRequest(
  chunks: readonly Uint8Array[],
  options?: {
    headers?: HeadersInit;
    keepOpen?: boolean;
    streamError?: Error;
  },
): { request: NextRequest; cancel: ReturnType<typeof vi.fn> } {
  let index = 0;
  let streamError = options?.streamError;
  const cancel = vi.fn(async () => undefined);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (streamError) {
        const error = streamError;
        streamError = undefined;
        controller.error(error);
        return;
      }
      const chunk = chunks[index];
      if (chunk) {
        index += 1;
        controller.enqueue(chunk);
        return;
      }
      if (!options?.keepOpen) controller.close();
    },
    cancel,
  });
  return {
    request: {
      url: "http://localhost/api/mvp/anything",
      method: "POST",
      headers: new Headers({
        "content-type": "application/json",
        ...options?.headers,
      }),
      body,
    } as unknown as NextRequest,
    cancel,
  };
}

function jsonRequest(text: string): NextRequest {
  return jsonStreamRequest([encoder.encode(text)]).request;
}

describe("AC-013 — parseJsonBody body-size cap", () => {
  it("accepts a normal small body (guard does not break the happy path)", async () => {
    const parsed = await parseJsonBody(jsonRequest(JSON.stringify({ ok: true })), schema);
    expect(parsed.ok).toBe(true);
  });

  it("fast-rejects an oversized declared Content-Length and cancels the body", async () => {
    const { request, cancel } = jsonStreamRequest([], {
      headers: { "content-length": String(MAX_JSON_BODY_BYTES + 1) },
      keepOpen: true,
    });

    await expect(parseJsonBody(request, schema)).rejects.toMatchObject({
      code: "IMPORT_TOO_LARGE",
      status: 413,
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rejects and cancels a decoded chunked body that crosses an under-reported Content-Length", async () => {
    const { request, cancel } = jsonStreamRequest(
      [
        new Uint8Array(MAX_JSON_BODY_BYTES),
        new Uint8Array([0x7b]),
      ],
      { headers: { "content-length": "32" }, keepOpen: true },
    );

    await expect(parseJsonBody(request, schema)).rejects.toMatchObject({
      code: "IMPORT_TOO_LARGE",
      status: 413,
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("caps BEFORE deep processing — schema validation never runs on an oversized body", async () => {
    const spy = vi.spyOn(schema, "safeParse");
    const { request } = jsonStreamRequest(
      [new Uint8Array(MAX_JSON_BODY_BYTES + 1)],
      { headers: { "content-length": "1" }, keepOpen: true },
    );
    await expect(parseJsonBody(request, schema)).rejects.toMatchObject({
      code: "IMPORT_TOO_LARGE",
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("decodes UTF-8 correctly when a multi-byte code point spans chunks", async () => {
    const encoded = encoder.encode(JSON.stringify({ value: "汉字" }));
    const firstMultibyteByte = encoded.findIndex((byte) => byte > 0x7f);
    const request = jsonStreamRequest([
      encoded.slice(0, firstMultibyteByte + 1),
      encoded.slice(firstMultibyteByte + 1),
    ]).request;

    await expect(parseJsonBody(request, textSchema)).resolves.toEqual({
      value: "汉字",
    });
  });

  it("rejects invalid UTF-8 instead of silently inserting replacement characters", async () => {
    const prefix = encoder.encode('{"value":"');
    const suffix = encoder.encode('"}');
    const invalid = new Uint8Array(prefix.byteLength + 2 + suffix.byteLength);
    invalid.set(prefix, 0);
    invalid.set([0xc3, 0x28], prefix.byteLength);
    invalid.set(suffix, prefix.byteLength + 2);

    await expect(
      parseJsonBody(jsonStreamRequest([invalid]).request, textSchema),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
  });

  it("maps an empty decoded stream to BAD_REQUEST", async () => {
    await expect(
      parseJsonBody(jsonStreamRequest([]).request, schema),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
  });

  it("maps stream failures to a generic BAD_REQUEST without reflecting transport data", async () => {
    const request = jsonStreamRequest([], {
      streamError: new ProblemError(
        "DEPENDENCY_UNAVAILABLE",
        "secret-json-request-body",
      ),
    }).request;
    let caught: unknown;
    try {
      await parseJsonBody(request, schema);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProblemError);
    expect(caught).toMatchObject({ code: "BAD_REQUEST", status: 400 });
    expect((caught as Error).message).not.toContain("secret-json");
  });

  it("still maps malformed JSON to 400 BAD_REQUEST (existing behavior preserved)", async () => {
    await expect(parseJsonBody(jsonRequest("{ not json"), schema)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      status: 400,
    });
  });
});

function requestWithReader(
  reader: {
    read: () => Promise<ReadableStreamReadResult<Uint8Array>>;
    cancel: (reason?: unknown) => Promise<void>;
    releaseLock: () => void;
  },
  headers?: HeadersInit,
): NextRequest {
  return {
    url: "http://localhost/api/mvp/projects/project/sources/csv/import",
    method: "POST",
    headers: new Headers({
      "content-type": "multipart/form-data; boundary=bounded-test",
      ...headers,
    }),
    body: { getReader: () => reader },
  } as unknown as NextRequest;
}

describe("multipart body-size cap", () => {
  it("parses form data only from the bounded byte copy", async () => {
    const outbound = new FormData();
    outbound.set("templateId", "keyword_gap_v1");
    outbound.set(
      "file",
      new File(["keyword,volume\nshoes,12\n"], "keywords.csv", {
        type: "text/csv",
      }),
    );
    const request = new Request("http://localhost/import", {
      method: "POST",
      body: outbound,
    }) as unknown as NextRequest;

    const parsed = await parseMultipartFormDataWithinLimit(request, 64 * 1024);

    expect(parsed.get("templateId")).toBe("keyword_gap_v1");
    const file = parsed.get("file");
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe("keywords.csv");
    await expect((file as File).text()).resolves.toContain("shoes,12");
    expect(request.bodyUsed).toBe(true);
  });

  it("accepts the case-insensitive multipart media type defined by HTTP", async () => {
    const outbound = new FormData();
    outbound.set("file", new File(["keyword\nshoes\n"], "keywords.csv"));
    const request = new Request("http://localhost/import", {
      method: "POST",
      body: outbound,
    }) as unknown as NextRequest;
    const contentType = request.headers.get("content-type");
    request.headers.set(
      "content-type",
      contentType?.replace("multipart/form-data", "Multipart/Form-Data") ?? "",
    );

    const parsed = await parseMultipartFormDataWithinLimit(request, 64 * 1024);

    expect(parsed.get("file")).toBeInstanceOf(File);
  });

  it("does not trust an under-reported Content-Length and cancels at the first over-limit chunk", async () => {
    const read = vi
      .fn<() => Promise<ReadableStreamReadResult<Uint8Array>>>()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(17) })
      .mockRejectedValueOnce(new Error("must not read another chunk"));
    const cancel = vi.fn(async () => undefined);
    const releaseLock = vi.fn();
    const request = requestWithReader(
      { read, cancel, releaseLock },
      { "content-length": "1" },
    );

    await expect(
      parseMultipartFormDataWithinLimit(request, 16),
    ).rejects.toMatchObject({ code: "IMPORT_TOO_LARGE", status: 413 });

    expect(read).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it("does not wait for a stuck transport cancellation before returning the 413", async () => {
    const neverSettles = new Promise<void>(() => undefined);
    const request = requestWithReader({
      read: async () => ({ done: false, value: new Uint8Array(17) }),
      cancel: vi.fn(() => neverSettles),
      releaseLock: () => undefined,
    });

    const outcome = await Promise.race([
      parseMultipartFormDataWithinLimit(request, 16).catch((error: unknown) => error),
      new Promise<string>((resolve) => setTimeout(() => resolve("timed-out"), 0)),
    ]);

    expect(outcome).not.toBe("timed-out");
    expect(outcome).toMatchObject({ code: "IMPORT_TOO_LARGE", status: 413 });
  });

  it("fast-rejects an over-limit Content-Length and cancels the unread body", async () => {
    const cancel = vi.fn(async () => undefined);
    const body = {
      cancel,
      getReader: vi.fn(() => {
        throw new Error("the stream must not be read");
      }),
    };
    const request = {
      url: "http://localhost/import",
      method: "POST",
      headers: new Headers({
        "content-type": "multipart/form-data; boundary=bounded-test",
        "content-length": "17",
      }),
      body,
    } as unknown as NextRequest;

    await expect(
      parseMultipartFormDataWithinLimit(request, 16),
    ).rejects.toMatchObject({ code: "IMPORT_TOO_LARGE", status: 413 });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.getReader).not.toHaveBeenCalled();
  });

  it("maps an absent or empty body to a stable BAD_REQUEST problem", async () => {
    const absent = {
      url: "http://localhost/import",
      method: "POST",
      headers: new Headers({
        "content-type": "multipart/form-data; boundary=bounded-test",
      }),
      body: null,
    } as unknown as NextRequest;
    const empty = requestWithReader({
      read: async () => ({ done: true, value: undefined }),
      cancel: async () => undefined,
      releaseLock: () => undefined,
    });

    await expect(
      parseMultipartFormDataWithinLimit(absent, 16),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
    await expect(
      parseMultipartFormDataWithinLimit(empty, 16),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
  });

  it("maps stream failures to a stable generic BAD_REQUEST without reflecting body data", async () => {
    const releaseLock = vi.fn();
    const request = requestWithReader({
      read: async () => {
        throw new Error("secret,row,from,request-body");
      },
      cancel: async () => undefined,
      releaseLock,
    });

    let caught: unknown;
    try {
      await parseMultipartFormDataWithinLimit(request, 16);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProblemError);
    expect(caught).toMatchObject({ code: "BAD_REQUEST", status: 400 });
    expect((caught as Error).message).not.toContain("secret,row");
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it("maps malformed multipart bytes to BAD_REQUEST", async () => {
    const request = new Request("http://localhost/import", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=bounded-test",
      },
      body: "not-a-valid-multipart-body",
    }) as unknown as NextRequest;

    await expect(
      parseMultipartFormDataWithinLimit(request, 1024),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
  });
});
