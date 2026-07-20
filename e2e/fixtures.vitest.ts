import type { APIRequestContext } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import { publicFixtureOrigin, seedProject } from "./fixtures.ts";

function requestWithResponse(response: object): {
  request: APIRequestContext;
  post: ReturnType<typeof vi.fn>;
} {
  const post = vi.fn().mockResolvedValue(response);
  return {
    request: { post } as unknown as APIRequestContext,
    post,
  };
}

describe("publicFixtureOrigin", () => {
  it("maps arbitrary deterministic seeds to stable, distinct public literals", () => {
    const first = publicFixtureOrigin("isolation-a");
    const second = publicFixtureOrigin("isolation-b");

    expect(first).toBe(publicFixtureOrigin("isolation-a"));
    expect(second).toBe(publicFixtureOrigin("isolation-b"));
    expect(first).not.toBe(second);
  });

  it("keeps every generated host octet inside the fixture boundary", () => {
    for (const seed of ["", "not-hex", "000000", "ffffff", "项目隔离"] as const) {
      const url = new URL(publicFixtureOrigin(seed));
      const octets = url.hostname.split(".").map(Number);

      expect(octets).toHaveLength(4);
      expect(octets[0]).toBe(11);
      expect(octets.slice(1).every((octet) => octet >= 1 && octet <= 254)).toBe(
        true,
      );
    }
  });

  it("seeds explicit project values through the public API", async () => {
    const { request, post } = requestWithResponse({
      ok: () => true,
      json: async () => ({ data: { id: "project-explicit" } }),
    });

    await expect(
      seedProject(request, {
        clientName: "Client A",
        projectName: "Project A",
        siteUrl: "https://11.1.2.3",
      }),
    ).resolves.toEqual({
      projectId: "project-explicit",
      siteUrl: "https://11.1.2.3",
    });
    expect(post).toHaveBeenCalledWith("/api/mvp/projects", {
      headers: {
        "Idempotency-Key": expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      },
      data: {
        clientName: "Client A",
        projectName: "Project A",
        siteUrl: "https://11.1.2.3",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
    });
  });

  it("supplies isolated defaults when callers omit project values", async () => {
    const { request, post } = requestWithResponse({
      ok: () => true,
      json: async () => ({ data: { id: "project-default" } }),
    });

    const result = await seedProject(request);

    expect(result).toEqual({
      projectId: "project-default",
      siteUrl: expect.stringMatching(/^https:\/\/11(?:\.\d{1,3}){3}$/),
    });
    expect(post).toHaveBeenCalledWith(
      "/api/mvp/projects",
      expect.objectContaining({
        data: expect.objectContaining({
          clientName: expect.stringMatching(/^E2E Client [0-9a-f]{8}$/),
          projectName: expect.stringMatching(/^E2E Project [0-9a-f]{8}$/),
          siteUrl: result.siteUrl,
        }),
      }),
    );
  });

  it("surfaces a failed seed response with its status and response body", async () => {
    const { request } = requestWithResponse({
      ok: () => false,
      status: () => 422,
      text: async () => "fixture rejected",
    });

    await expect(
      seedProject(request, { siteUrl: "https://11.4.5.6" }),
    ).rejects.toThrow("seedProject failed: 422 fixture rejected");
  });
});
