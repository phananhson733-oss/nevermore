import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiGet, apiSend } from "./client";

const problem = {
  type: "https://signalframe.test/problems/validation",
  title: "Validation failed",
  status: 422,
  code: "VALIDATION_ERROR",
  detail: "The request contains invalid fields.",
  requestId: "req-problem",
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("API client", () => {
  it("sends a same-origin GET and returns a JSON success envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { projectId: "project-1" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiGet("/projects/project-1")).resolves.toEqual({
      data: { projectId: "project-1" },
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/mvp/projects/project-1", {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  });

  it("serializes a mutation body and forwards the idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { accepted: true } }), {
        status: 202,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiSend("POST", "/exports", {
        body: { bundleType: "client_bundle" },
        idempotencyKey: "idem-1",
      }),
    ).resolves.toEqual({ data: { accepted: true } });
    expect(fetchMock).toHaveBeenCalledWith("/api/mvp/exports", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": "idem-1",
      },
      body: JSON.stringify({ bundleType: "client_bundle" }),
    });
  });

  it.each([
    ["an empty response", ""],
    ["malformed JSON", "not-json"],
  ])("returns undefined for %s on a successful request", async (_label, body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
    );

    await expect(
      apiSend("DELETE", "/projects/project-1", { idempotencyKey: "" }),
    ).resolves.toBeUndefined();
  });

  it("throws the provider problem and exposes its field errors", async () => {
    const errors = [{ field: "siteUrl", message: "Must be an HTTPS URL" }];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ...problem, detail: "", errors }), {
          status: 422,
        }),
      ),
    );

    const thrown = await apiGet("/projects").catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown).toMatchObject({
      name: "ApiError",
      message: "Validation failed",
      code: "VALIDATION_ERROR",
      status: 422,
    });
    expect((thrown as ApiError).fieldErrors()).toEqual(errors);
  });

  it("uses a problem detail as the error message and defaults field errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(problem), { status: problem.status }),
      ),
    );

    const thrown = await apiGet("/projects").catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown).toHaveProperty("message", problem.detail);
    expect((thrown as ApiError).fieldErrors()).toEqual([]);
  });

  it("rejects structurally invalid problem bodies and synthesizes a safe fallback", async () => {
    const invalidBodies: readonly unknown[] = [
      null,
      "failure",
      {},
      { ...problem, type: 1 },
      { ...problem, title: 1 },
      { ...problem, status: "422" },
      { ...problem, code: 1 },
      { ...problem, detail: 1 },
    ];
    const fetchMock = vi.fn();
    for (const body of invalidBodies) {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(body), {
          status: 418,
          statusText: "Teapot",
          headers: { "X-Request-Id": "req-fallback" },
        }),
      );
    }
    vi.stubGlobal("fetch", fetchMock);

    for (const _body of invalidBodies) {
      const thrown = await apiGet("/failure").catch(
        (error: unknown) => error,
      );
      expect(thrown).toBeInstanceOf(ApiError);
      expect(thrown).toMatchObject({
        message: "Request failed with status 418.",
        code: "UNKNOWN",
        status: 418,
        problem: {
          type: "about:blank",
          title: "Teapot",
          requestId: "req-fallback",
        },
      });
    }
  });

  it("uses safe defaults when the upstream status text and request id are absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("null", { status: 500, statusText: "" }),
      ),
    );

    const thrown = await apiGet("/failure").catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown).toMatchObject({
      message: "Request failed with status 500.",
      problem: { title: "Request failed", requestId: "" },
    });
  });
});
