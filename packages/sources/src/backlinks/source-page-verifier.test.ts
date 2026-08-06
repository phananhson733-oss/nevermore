import { describe, expect, it } from "vitest";
import * as sourceModule from "../index.ts";
import type {
  PublicResourceFetchOptions,
  PublicResourceResult,
} from "../public-http/index.ts";

type VerificationStatus =
  | "verified"
  | "absent"
  | "blocked"
  | "inconclusive";

interface VerifyBacklinkSourcePageInput {
  readonly sourceUrl: string;
  readonly targetUrl: string;
}

type BacklinkPublicResourceFetch = (
  url: string,
  options: PublicResourceFetchOptions,
) => Promise<PublicResourceResult>;

interface VerifyBacklinkSourcePageOptions {
  readonly fetchPublicResource?: BacklinkPublicResourceFetch;
}

interface BacklinkSourcePageVerification {
  readonly status: VerificationStatus;
  readonly checkedAt: string;
  readonly finalUrl: string | null;
  readonly httpStatus: number | null;
  readonly anchorText: string | null;
  readonly rel: string | null;
  readonly limitation: string | null;
}

type VerifyBacklinkSourcePage = (
  input: VerifyBacklinkSourcePageInput,
  options?: VerifyBacklinkSourcePageOptions,
) => Promise<BacklinkSourcePageVerification>;

function loadVerifier(): VerifyBacklinkSourcePage {
  // Assert the stable package surface while keeping module transformation out
  // of individual test timeouts under parallel Vitest execution.
  const moduleExports: object = sourceModule;
  const candidate: unknown = Reflect.get(
    moduleExports,
    "verifyBacklinkSourcePage",
  );

  expect(
    typeof candidate,
    "@sf/sources must export verifyBacklinkSourcePage",
  ).toBe("function");
  if (typeof candidate !== "function") {
    throw new TypeError("verifyBacklinkSourcePage is not exported");
  }
  return candidate as VerifyBacklinkSourcePage;
}

function okResult(
  body: string,
  overrides: Partial<Extract<PublicResourceResult, { kind: "ok" }>> = {},
): Extract<PublicResourceResult, { kind: "ok" }> {
  return {
    kind: "ok",
    requestedUrl: "https://ref.example/articles/backlinks",
    finalUrl: "https://ref.example/articles/backlinks",
    firstStatus: 200,
    finalStatus: 200,
    redirectChain: [],
    contentType: "text/html; charset=utf-8",
    xRobotsTag: null,
    body,
    bytes: new TextEncoder().encode(body).byteLength,
    bodyComplete: true,
    ...overrides,
  };
}

interface VerificationHarness {
  readonly result: BacklinkSourcePageVerification;
  readonly calls: readonly {
    readonly url: string;
    readonly options: PublicResourceFetchOptions;
  }[];
}

async function verifyFixture(
  resourceResult: PublicResourceResult,
  input: VerifyBacklinkSourcePageInput = {
    sourceUrl: "https://ref.example/articles/backlinks",
    targetUrl: "https://target.example/product",
  },
): Promise<VerificationHarness> {
  const verifier = await loadVerifier();
  const calls: Array<{
    readonly url: string;
    readonly options: PublicResourceFetchOptions;
  }> = [];
  const fetchPublicResource: BacklinkPublicResourceFetch = async (
    url,
    options,
  ) => {
    calls.push({ url, options });
    return resourceResult;
  };

  const result = await verifier(input, { fetchPublicResource });
  return { result, calls };
}

function expectCheckedAt(value: string): void {
  expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(Number.isNaN(Date.parse(value))).toBe(false);
}

function expectNoMatchedLink(
  result: BacklinkSourcePageVerification,
): void {
  expect(result.anchorText).toBeNull();
  expect(result.rel).toBeNull();
}

describe("verifyBacklinkSourcePage", () => {
  it("verifies an exact canonical target URL and extracts anchor + rel evidence", async () => {
    const html = `
      <html><body>
        <a
          href="//target.example/product/?utm_source=partner"
          rel="ugc sponsored nofollow"
        ><span>Trusted &amp; useful</span></a>
      </body></html>
    `;

    const { result, calls } = await verifyFixture(okResult(html));

    expect(result).toMatchObject({
      status: "verified",
      finalUrl: "https://ref.example/articles/backlinks",
      httpStatus: 200,
      anchorText: "Trusted & useful",
      rel: "ugc sponsored nofollow",
      limitation: null,
    });
    expectCheckedAt(result.checkedAt);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://ref.example/articles/backlinks");
    expect(calls[0]?.options).toEqual(
      expect.objectContaining({
        allowedOrigin: "https://ref.example",
        timeoutMs: expect.any(Number),
        maxRedirects: expect.any(Number),
        maxBodyBytes: expect.any(Number),
      }),
    );
  });

  it("does not verify a different page on the target origin", async () => {
    const html = `
      <a href="https://target.example/resources/guide">
        Target resource
      </a>
    `;

    const { result } = await verifyFixture(okResult(html));

    expect(result).toMatchObject({
      status: "absent",
      limitation: null,
    });
    expectNoMatchedLink(result);
  });

  it("resolves a path-relative href against the fetched source page", async () => {
    const html = `<a href="../product/" rel="nofollow">Relative target</a>`;
    const sourceUrl = "https://target.example/articles/backlinks";
    const { result } = await verifyFixture(
      okResult(html, { requestedUrl: sourceUrl, finalUrl: sourceUrl }),
      {
        sourceUrl,
        targetUrl: "https://target.example/product",
      },
    );

    expect(result).toMatchObject({
      status: "verified",
      anchorText: "Relative target",
      rel: "nofollow",
      limitation: null,
    });
  });

  it("reports absent only for a complete successful HTML response", async () => {
    const { result } = await verifyFixture(
      okResult(`<html><body><a href="https://other.example/">Other</a></body></html>`),
    );

    expect(result).toMatchObject({
      status: "absent",
      finalUrl: "https://ref.example/articles/backlinks",
      httpStatus: 200,
      limitation: null,
    });
    expectCheckedAt(result.checkedAt);
    expectNoMatchedLink(result);
  });

  it("keeps a no-match truncated body inconclusive instead of claiming absence", async () => {
    const { result } = await verifyFixture(
      okResult(`<html><body><a href="https://other.example/">Other</a>`, {
        bodyComplete: false,
      }),
    );

    expect(result.status).toBe("inconclusive");
    expect(result.limitation).toMatch(/truncat/i);
    expectNoMatchedLink(result);
  });

  it("accepts positive link evidence even when the retained body is truncated", async () => {
    const { result } = await verifyFixture(
      okResult(`<a href="https://target.example/product">Found early</a>`, {
        bodyComplete: false,
      }),
    );

    expect(result).toMatchObject({
      status: "verified",
      anchorText: "Found early",
      rel: null,
      limitation: null,
    });
  });

  it("keeps a non-HTML response inconclusive even if its bytes resemble a link", async () => {
    const { result } = await verifyFixture(
      okResult(`<a href="https://target.example/product">Not HTML evidence</a>`, {
        contentType: "application/pdf",
      }),
    );

    expect(result.status).toBe("inconclusive");
    expect(result.limitation).toMatch(/html|content.?type/i);
    expectNoMatchedLink(result);
  });

  it("keeps a non-2xx response inconclusive even if an error page contains the link", async () => {
    const { result } = await verifyFixture(
      okResult(`<a href="https://target.example/product">Error page</a>`, {
        firstStatus: 404,
        finalStatus: 404,
      }),
    );

    expect(result).toMatchObject({
      status: "inconclusive",
      finalUrl: "https://ref.example/articles/backlinks",
      httpStatus: 404,
    });
    expect(result.limitation).toMatch(/status|2xx/i);
    expectNoMatchedLink(result);
  });

  it.each(["timeout", "network"] as const)(
    "maps a %s transport failure to inconclusive",
    async (code) => {
      const { result } = await verifyFixture({ kind: "error", code });

      expect(result).toMatchObject({
        status: "inconclusive",
        finalUrl: null,
        httpStatus: null,
      });
      expect(result.limitation).toContain(code);
      expectCheckedAt(result.checkedAt);
      expectNoMatchedLink(result);
    },
  );

  it.each(["blocked", "cross_origin"] as const)(
    "maps a stable %s safety-policy refusal to blocked",
    async (code) => {
      const { result } = await verifyFixture({ kind: "error", code });

      expect(result).toMatchObject({
        status: "blocked",
        finalUrl: null,
        httpStatus: null,
      });
      expect(result.limitation).toContain(code);
      expectCheckedAt(result.checkedAt);
      expectNoMatchedLink(result);
    },
  );
});
