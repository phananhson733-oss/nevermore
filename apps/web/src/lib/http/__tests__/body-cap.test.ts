import type { NextRequest } from "next/server";
import { ProblemError } from "@sf/observability";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { MAX_JSON_BODY_BYTES, parseJsonBody } from "@/lib/http/validate";

/**
 * AC-013 (spec §14.2): request-body hardening. An oversized or
 * decompression-bomb-style JSON payload must be rejected by a body-size cap
 * (413 `IMPORT_TOO_LARGE` — the frozen registry's only "payload too large" code)
 * BEFORE any JSON parsing or schema validation runs.
 *
 * The shared `parseJsonBody` helper previously had no size cap (a real gap for
 * every JSON API route — Next App Router route handlers impose no body limit).
 * A minimal guard was added to `apps/web/src/lib/http/validate.ts`; this pins it.
 * Pure — no database.
 */

const schema = z.object({ ok: z.boolean() });

/** A real Request (undici sets Content-Length from the string body). */
function realRequest(body: string): NextRequest {
  return new Request("http://localhost/api/mvp/anything", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  }) as unknown as NextRequest;
}

/**
 * A request whose declared Content-Length UNDER-reports its actual body — the
 * decompression-bomb shape: a small compressed envelope inflating past the cap
 * once decoded. Only `.headers.get()` and `.text()` are used by `parseJsonBody`.
 */
function bombRequest(text: string, declaredContentLength: number): NextRequest {
  return {
    headers: new Headers({ "content-length": String(declaredContentLength) }),
    text: async () => text,
  } as unknown as NextRequest;
}

describe("AC-013 — parseJsonBody body-size cap", () => {
  it("accepts a normal small body (guard does not break the happy path)", async () => {
    const parsed = await parseJsonBody(realRequest(JSON.stringify({ ok: true })), schema);
    expect(parsed.ok).toBe(true);
  });

  it("rejects an oversized body via the declared Content-Length (413 IMPORT_TOO_LARGE)", async () => {
    const huge = JSON.stringify({ blob: "x".repeat(MAX_JSON_BODY_BYTES + 1024) });
    let caught: unknown;
    try {
      await parseJsonBody(realRequest(huge), schema);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProblemError);
    expect((caught as ProblemError).code).toBe("IMPORT_TOO_LARGE");
    expect((caught as ProblemError).status).toBe(413);
  });

  it("rejects a decompression-bomb-style body whose Content-Length under-reports its size", async () => {
    const huge = "y".repeat(MAX_JSON_BODY_BYTES + 1);
    // Declared length is a tiny lie; the post-read byte-length guard must still fire.
    let caught: unknown;
    try {
      await parseJsonBody(bombRequest(huge, 32), schema);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProblemError);
    expect((caught as ProblemError).code).toBe("IMPORT_TOO_LARGE");
    expect((caught as ProblemError).status).toBe(413);
  });

  it("caps BEFORE deep processing — schema validation never runs on an oversized body", async () => {
    const spy = vi.spyOn(schema, "safeParse");
    const huge = "z".repeat(MAX_JSON_BODY_BYTES + 1);
    await expect(parseJsonBody(bombRequest(huge, 32), schema)).rejects.toMatchObject({
      code: "IMPORT_TOO_LARGE",
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("still maps malformed JSON to 400 BAD_REQUEST (existing behavior preserved)", async () => {
    await expect(parseJsonBody(realRequest("{ not json"), schema)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      status: 400,
    });
  });
});
