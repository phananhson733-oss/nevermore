import { PublishingProviderError } from "./errors";
import type {
  BoundedJsonTransport,
  ProviderResponse,
} from "./http";

export interface LiveCanonicalVerificationInput {
  readonly transport: BoundedJsonTransport;
  readonly provider: "github" | "wordpress";
  readonly operation: string;
  readonly liveUrl: string;
  readonly expectedCanonicalUrl: string;
  readonly expectedRevision?: string;
  readonly revisionHeader?: string;
}

export interface LiveCanonicalVerification {
  readonly canonicalUrl: string;
  readonly providerRequestId: string | null;
}

export async function verifyLiveCanonical(
  input: LiveCanonicalVerificationInput,
): Promise<LiveCanonicalVerification> {
  const expectedCanonicalUrl = normalizeCanonicalUrl(
    input.expectedCanonicalUrl,
    input.provider,
    input.operation,
  );
  const liveUrl = normalizeCanonicalUrl(
    input.liveUrl,
    input.provider,
    input.operation,
  );
  const expectedOrigin = new URL(expectedCanonicalUrl).origin;

  if (new URL(liveUrl).origin !== expectedOrigin) {
    throw liveVerificationFailure(
      input.provider,
      input.operation,
      "origin_mismatch",
    );
  }

  const response = await input.transport.requestText({
    provider: input.provider,
    operation: input.operation,
    method: "GET",
    url: liveUrl,
    allowedOrigins: [expectedOrigin],
    retry: "safe_read",
  });
  assertHtmlResponse(response, input.provider, input.operation);

  const canonical = extractCanonical(response.body);
  if (
    canonical === null ||
    normalizeCanonicalUrl(canonical, input.provider, input.operation) !==
      expectedCanonicalUrl
  ) {
    throw liveVerificationFailure(
      input.provider,
      input.operation,
      "canonical_mismatch",
      response.providerRequestId,
    );
  }

  if (
    input.expectedRevision !== undefined &&
    input.revisionHeader !== undefined &&
    response.headers.get(input.revisionHeader) !== input.expectedRevision
  ) {
    throw liveVerificationFailure(
      input.provider,
      input.operation,
      "revision_mismatch",
      response.providerRequestId,
    );
  }

  return {
    canonicalUrl: expectedCanonicalUrl,
    providerRequestId: response.providerRequestId,
  };
}

export function normalizeCanonicalUrl(
  rawUrl: string,
  provider: "github" | "wordpress",
  operation: string,
): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw liveVerificationFailure(provider, operation, "invalid_url");
  }
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0
  ) {
    throw liveVerificationFailure(provider, operation, "invalid_url");
  }
  url.hash = "";
  return url.href;
}

function assertHtmlResponse(
  response: ProviderResponse<string>,
  provider: "github" | "wordpress",
  operation: string,
): void {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("text/html")) {
    throw liveVerificationFailure(
      provider,
      operation,
      "content_type_mismatch",
      response.providerRequestId,
    );
  }
}

function extractCanonical(html: string): string | null {
  for (const tag of html.matchAll(/<link\b[^>]*>/giu)) {
    const value = tag[0];
    const rel = readAttribute(value, "rel");
    if (
      rel
        ?.toLowerCase()
        .split(/\s+/u)
        .includes("canonical") !== true
    ) {
      continue;
    }
    const href = readAttribute(value, "href");
    if (href !== null) {
      return decodeBasicHtmlEntities(href);
    }
  }
  return null;
}

function readAttribute(tag: string, attribute: string): string | null {
  const expression = new RegExp(
    `\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "iu",
  );
  const match = expression.exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function liveVerificationFailure(
  provider: "github" | "wordpress",
  operation: string,
  reason: string,
  providerRequestId: string | null = null,
): PublishingProviderError {
  return new PublishingProviderError({
    code: "LIVE_VERIFICATION_FAILED",
    provider,
    operation,
    message: "Live canonical verification did not pass.",
    retryable: reason !== "invalid_url" && reason !== "origin_mismatch",
    providerRequestId,
    safeDetails: { reason },
  });
}
