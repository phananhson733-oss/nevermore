import { describe, expect, it } from "vitest";

import type {
  BoundedJsonTransport,
  ProviderResponse,
} from "./http";
import {
  normalizeCanonicalUrl,
  verifyLiveCanonical,
} from "./live";

function transportFor(
  response: ProviderResponse<string>,
): BoundedJsonTransport {
  return {
    request: async () => {
      throw new Error("JSON request not expected");
    },
    requestText: async () => response,
  };
}

function htmlResponse(
  body: string,
  headers: Record<string, string> = {},
): ProviderResponse<string> {
  return {
    status: 200,
    body,
    headers: new Headers({
      "content-type": "text/html",
      ...headers,
    }),
    providerRequestId: "live-request-1",
    observedAt: "2026-07-27T08:00:00.000Z",
  };
}

describe("live canonical verification", () => {
  it("supports canonical attributes in either order and verifies revision header", async () => {
    await expect(
      verifyLiveCanonical({
        transport: transportFor(
          htmlResponse(
            "<html><head><link href='https://www.example.com/page/?a=1&amp;b=2' rel='alternate canonical'></head></html>",
            { "x-deploy-revision": "merge-sha-1" },
          ),
        ),
        provider: "github",
        operation: "verify_live",
        liveUrl: "https://www.example.com/page/?a=1&b=2",
        expectedCanonicalUrl: "https://www.example.com/page/?a=1&b=2",
        expectedRevision: "merge-sha-1",
        revisionHeader: "x-deploy-revision",
      }),
    ).resolves.toEqual({
      canonicalUrl: "https://www.example.com/page/?a=1&b=2",
      providerRequestId: "live-request-1",
    });
  });

  it.each([
    {
      name: "origin mismatch",
      input: {
        liveUrl: "https://other.example.com/page/",
        expectedCanonicalUrl: "https://www.example.com/page/",
      },
      response: htmlResponse(
        '<link rel="canonical" href="https://www.example.com/page/">',
      ),
      reason: "origin_mismatch",
    },
    {
      name: "non-html response",
      input: {
        liveUrl: "https://www.example.com/page/",
        expectedCanonicalUrl: "https://www.example.com/page/",
      },
      response: {
        ...htmlResponse("plain"),
        headers: new Headers({ "content-type": "text/plain" }),
      },
      reason: "content_type_mismatch",
    },
    {
      name: "missing canonical",
      input: {
        liveUrl: "https://www.example.com/page/",
        expectedCanonicalUrl: "https://www.example.com/page/",
      },
      response: htmlResponse("<html><head></head></html>"),
      reason: "canonical_mismatch",
    },
    {
      name: "revision mismatch",
      input: {
        liveUrl: "https://www.example.com/page/",
        expectedCanonicalUrl: "https://www.example.com/page/",
        expectedRevision: "merge-sha-expected",
        revisionHeader: "x-deploy-revision",
      },
      response: htmlResponse(
        '<link rel="canonical" href="https://www.example.com/page/">',
        { "x-deploy-revision": "merge-sha-other" },
      ),
      reason: "revision_mismatch",
    },
  ])("rejects $name", async ({ input, response, reason }) => {
    await expect(
      verifyLiveCanonical({
        transport: transportFor(response),
        provider: "github",
        operation: "verify_live",
        ...input,
      }),
    ).rejects.toMatchObject({
      code: "LIVE_VERIFICATION_FAILED",
      safeDetails: { reason },
    });
  });

  it.each([
    "not a url",
    "http://www.example.com/page/",
    "https://user:pass@www.example.com/page/",
    "https://www.example.com/page/#fragment",
  ])("rejects invalid canonical URL %s", (value) => {
    expect(() =>
      normalizeCanonicalUrl(value, "wordpress", "canonical"),
    ).toThrowError(
      expect.objectContaining({
        code: "LIVE_VERIFICATION_FAILED",
        safeDetails: { reason: "invalid_url" },
      }),
    );
  });
});
