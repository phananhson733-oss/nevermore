import { isIP } from "node:net";

import {
  PublishingProviderError,
  type PublishingProvider,
} from "./errors";

export type PinnedFetchLike = (
  input: string | URL | Request,
  init: RequestInit | undefined,
  endpoint: ResolvedEndpoint,
) => Promise<Response>;

/** Concise alias used by in-memory test doubles. */
export type FetchLike = PinnedFetchLike;

export type ResolveHostname = (
  hostname: string,
  signal: AbortSignal,
) => Promise<readonly string[]>;

/**
 * The exact endpoint resolution approved by the SSRF guard.
 *
 * A production PinnedFetchLike MUST connect only to one of `addresses` while using
 * `hostname` for TLS SNI and certificate verification. It must not resolve the
 * hostname again. Requiring this third argument prevents the package from
 * silently falling back to a TOCTOU-prone global fetch. Test doubles may ignore
 * it because they never open a socket.
 */
export interface ResolvedEndpoint {
  readonly origin: string;
  readonly hostname: string;
  readonly addresses: readonly string[];
}

export type RetryMode = "never" | "safe_read";

export interface BoundedTransportOptions {
  readonly fetch: PinnedFetchLike;
  readonly now: () => Date;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly resolveHostname: ResolveHostname;
  readonly requestTimeoutMs?: number;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxAttempts?: number;
  readonly retryBackoffMs?: readonly number[];
}

export interface ProviderRequest {
  readonly provider: PublishingProvider;
  readonly operation: string;
  readonly method: "DELETE" | "GET" | "HEAD" | "PATCH" | "POST" | "PUT";
  readonly url: string;
  readonly allowedOrigins: readonly string[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly secrets?: readonly string[];
  readonly body?: unknown;
  readonly retry: RetryMode;
  readonly acceptedStatuses?: readonly number[];
  readonly signal?: AbortSignal;
}

export interface ProviderResponse<T> {
  readonly status: number;
  readonly body: T;
  readonly headers: Headers;
  readonly providerRequestId: string | null;
  readonly observedAt: string;
}

export interface BoundedJsonTransport {
  request<T = unknown>(request: ProviderRequest): Promise<ProviderResponse<T>>;
  requestText(request: ProviderRequest): Promise<ProviderResponse<string>>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REQUEST_BYTES = 8_388_608;
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_BACKOFF_MS = [250] as const;
const HARD_MAX_TIMEOUT_MS = 30_000;
const HARD_MAX_REQUEST_BYTES = 16_777_216;
const HARD_MAX_RESPONSE_BYTES = 33_554_432;
const HARD_MAX_ATTEMPTS = 3;
const HARD_MAX_BACKOFF_MS = 5_000;
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

export function createBoundedJsonTransport(
  options: BoundedTransportOptions,
): BoundedJsonTransport {
  const fetchImpl = options.fetch;
  const resolveHostname = options.resolveHostname;
  const requestTimeoutMs =
    options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRequestBytes =
    options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryBackoffMs =
    options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;

  assertBound(requestTimeoutMs, "requestTimeoutMs", HARD_MAX_TIMEOUT_MS);
  assertBound(maxRequestBytes, "maxRequestBytes", HARD_MAX_REQUEST_BYTES);
  assertBound(
    maxResponseBytes,
    "maxResponseBytes",
    HARD_MAX_RESPONSE_BYTES,
  );
  assertBound(maxAttempts, "maxAttempts", HARD_MAX_ATTEMPTS);
  if (
    retryBackoffMs.length > HARD_MAX_ATTEMPTS - 1 ||
    retryBackoffMs.some(
      (milliseconds) =>
        !Number.isSafeInteger(milliseconds) ||
        milliseconds < 0 ||
        milliseconds > HARD_MAX_BACKOFF_MS,
    )
  ) {
    throw new TypeError(
      `retryBackoffMs must contain at most ${HARD_MAX_ATTEMPTS - 1} values between 0 and ${HARD_MAX_BACKOFF_MS}`,
    );
  }

  async function execute(
    request: ProviderRequest,
    responseKind: "json" | "text",
  ): Promise<ProviderResponse<unknown>> {
    const serializedBody = serializeRequestBody(
      request,
      maxRequestBytes,
    );
    const resolvedEndpoint = await assertSafeEndpoint(
      request.provider,
      request.operation,
      request.url,
      request.allowedOrigins,
      resolveHostname,
      requestTimeoutMs,
      request.signal,
    );

    const canRetry =
      request.retry === "safe_read" &&
      (request.method === "GET" || request.method === "HEAD");
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt += 1;
      const controller = new AbortController();
      let callerAborted = request.signal?.aborted === true;
      const abortFromCaller = () => {
        callerAborted = true;
        controller.abort(request.signal?.reason);
      };
      if (callerAborted) {
        controller.abort(request.signal?.reason);
      } else {
        request.signal?.addEventListener("abort", abortFromCaller, {
          once: true,
        });
      }
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, requestTimeoutMs);

      try {
        const response = await fetchImpl(
          request.url,
          {
            method: request.method,
            headers: {
              accept:
                responseKind === "json"
                  ? "application/json"
                  : "text/html, text/plain;q=0.8",
              ...(serializedBody === undefined
                ? {}
                : { "content-type": "application/json" }),
              ...request.headers,
            },
            ...(serializedBody === undefined
              ? {}
              : { body: serializedBody }),
            redirect: "error",
            signal: controller.signal,
          },
          resolvedEndpoint,
        );
        const providerRequestId = getProviderRequestId(response.headers);

        if (response.status >= 300 && response.status < 400) {
          cancelBody(response);
          throw new PublishingProviderError({
            code: "REDIRECT_BLOCKED",
            provider: request.provider,
            operation: request.operation,
            message: "Provider redirect was blocked.",
            providerRequestId,
          });
        }

        const accepted =
          (response.status >= 200 && response.status < 300) ||
          request.acceptedStatuses?.includes(response.status) === true;

        if (!accepted) {
          cancelBody(response);
          if (
            canRetry &&
            RETRYABLE_STATUS.has(response.status) &&
            attempt < maxAttempts
          ) {
            await options.sleep(
              retryBackoffMs[
                Math.min(attempt - 1, retryBackoffMs.length - 1)
              ] ?? 0,
            );
            continue;
          }
          throw mapHttpFailure(
            request.provider,
            request.operation,
            response.status,
            providerRequestId,
          );
        }

        const text = await readBoundedText(
          response,
          maxResponseBytes,
          request.provider,
          request.operation,
          providerRequestId,
          controller.signal,
        );
        let body: unknown = text;
        if (responseKind === "json") {
          try {
            body = text.length === 0 ? null : JSON.parse(text);
          } catch {
            throw new PublishingProviderError({
              code: "INVALID_RESPONSE",
              provider: request.provider,
              operation: request.operation,
              message: "Provider returned an invalid JSON response.",
              providerRequestId,
            });
          }
        }

        return {
          status: response.status,
          body,
          headers: response.headers,
          providerRequestId,
          observedAt: options.now().toISOString(),
        };
      } catch (error) {
        if (error instanceof PublishingProviderError) {
          throw error;
        }
        if (callerAborted) {
          throw new PublishingProviderError({
            code: "CANCELLED",
            provider: request.provider,
            operation: request.operation,
            message: "Provider request was cancelled by the caller.",
          });
        }
        if (timedOut || isAbortError(error)) {
          if (canRetry && timedOut && attempt < maxAttempts) {
            await options.sleep(
              retryBackoffMs[
                Math.min(attempt - 1, retryBackoffMs.length - 1)
              ] ?? 0,
            );
            continue;
          }
          throw new PublishingProviderError({
            code: "TIMEOUT",
            provider: request.provider,
            operation: request.operation,
            message: "Provider request timed out.",
            retryable: true,
          });
        }
        if (canRetry && attempt < maxAttempts) {
          await options.sleep(
            retryBackoffMs[
              Math.min(attempt - 1, retryBackoffMs.length - 1)
            ] ?? 0,
          );
          continue;
        }
        throw new PublishingProviderError({
          code: "REMOTE_UNAVAILABLE",
          provider: request.provider,
          operation: request.operation,
          message: "Provider is currently unavailable.",
          retryable: true,
        });
      } finally {
        clearTimeout(timeout);
        request.signal?.removeEventListener("abort", abortFromCaller);
      }
    }

    throw new PublishingProviderError({
      code: "REMOTE_UNAVAILABLE",
      provider: request.provider,
      operation: request.operation,
      message: "Provider retry budget was exhausted.",
      retryable: true,
    });
  }

  return {
    async request<T>(
      request: ProviderRequest,
    ): Promise<ProviderResponse<T>> {
      return (await execute(request, "json")) as ProviderResponse<T>;
    },
    async requestText(
      request: ProviderRequest,
    ): Promise<ProviderResponse<string>> {
      return (await execute(request, "text")) as ProviderResponse<string>;
    },
  };
}

async function assertSafeEndpoint(
  provider: PublishingProvider,
  operation: string,
  rawUrl: string,
  allowedOrigins: readonly string[],
  resolveHostname: ResolveHostname,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ResolvedEndpoint> {
  if (signal?.aborted === true) {
    throw cancelledError(provider, operation);
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw unsafeEndpoint(provider, operation);
  }

  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0 ||
    (url.port.length > 0 && url.port !== "443")
  ) {
    throw unsafeEndpoint(provider, operation);
  }

  const normalizedAllowedOrigins = allowedOrigins.map((origin) => {
    try {
      return new URL(origin).origin;
    } catch {
      return "";
    }
  });
  if (!normalizedAllowedOrigins.includes(url.origin)) {
    throw unsafeEndpoint(provider, operation);
  }

  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[/u, "")
    .replace(/\]$/u, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw unsafeEndpoint(provider, operation);
  }

  let addresses: readonly string[];
  try {
    addresses =
      isIP(hostname) === 0
        ? await resolveWithTimeout(
            provider,
            operation,
            hostname,
            resolveHostname,
            timeoutMs,
            signal,
          )
        : [hostname];
  } catch (error) {
    if (error instanceof PublishingProviderError) {
      throw error;
    }
    throw new PublishingProviderError({
      code: "REMOTE_UNAVAILABLE",
      provider,
      operation,
      message: "Provider endpoint could not be resolved safely.",
      retryable: true,
    });
  }
  if (
    addresses.length === 0 ||
    addresses.some((address) => !isPublicAddress(address))
  ) {
    throw unsafeEndpoint(provider, operation);
  }
  return Object.freeze({
    origin: url.origin,
    hostname,
    addresses: Object.freeze([...addresses]),
  });
}

async function resolveWithTimeout(
  provider: PublishingProvider,
  operation: string,
  hostname: string,
  resolveHostname: ResolveHostname,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<readonly string[]> {
  if (signal?.aborted === true) {
    throw cancelledError(provider, operation);
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortFromCaller: (() => void) | undefined;
  const resolverController = new AbortController();
  try {
    const races: Promise<readonly string[]>[] = [
      resolveHostname(hostname, resolverController.signal),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          const error = new PublishingProviderError({
            code: "TIMEOUT",
            provider,
            operation,
            message: "Provider endpoint resolution timed out.",
            retryable: true,
          });
          reject(error);
          resolverController.abort(error);
        }, timeoutMs);
      }),
    ];
    if (signal !== undefined) {
      races.push(
        new Promise<never>((_resolve, reject) => {
          abortFromCaller = () => {
            const error = cancelledError(provider, operation);
            reject(error);
            resolverController.abort(error);
          };
          signal.addEventListener("abort", abortFromCaller, {
            once: true,
          });
        }),
      );
    }
    return await Promise.race(races);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    if (abortFromCaller !== undefined) {
      signal?.removeEventListener("abort", abortFromCaller);
    }
  }
}

function serializeRequestBody(
  request: ProviderRequest,
  maxRequestBytes: number,
): string | undefined {
  if (request.body === undefined) {
    return undefined;
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(request.body);
  } catch {
    throw new PublishingProviderError({
      code: "INVALID_INPUT",
      provider: request.provider,
      operation: request.operation,
      message: "Provider request body is not serializable.",
    });
  }
  if (
    serialized === undefined ||
    Buffer.byteLength(serialized, "utf8") > maxRequestBytes
  ) {
    throw new PublishingProviderError({
      code: "REQUEST_TOO_LARGE",
      provider: request.provider,
      operation: request.operation,
      message: "Provider request exceeded the configured byte limit.",
      safeDetails: { maxRequestBytes },
    });
  }
  return serialized;
}

function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split(".").map(Number);
    const first = parts[0] ?? -1;
    const second = parts[1] ?? -1;
    return !(
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 &&
        (second === 0 ||
          second === 168 ||
          (second === 88 && (parts[2] ?? -1) === 99))) ||
      (first === 198 && (second === 18 || second === 19)) ||
      (first === 198 &&
        second === 51 &&
        (parts[2] ?? -1) === 100) ||
      (first === 203 &&
        second === 0 &&
        (parts[2] ?? -1) === 113) ||
      first >= 224
    );
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
    if (mappedIpv4 !== undefined) {
      return isPublicAddress(mappedIpv4);
    }
    const value = parseIpv6Address(normalized);
    return (
      value !== null &&
      isInIpv6Cidr(value, "2000::", 3) &&
      ![
        ["2001::", 23],
        ["2001:db8::", 32],
        ["2002::", 16],
        ["3fff::", 20],
        ["2620:4f:8000::", 48],
      ].some(
        ([network, prefixLength]) =>
          typeof network === "string" &&
          typeof prefixLength === "number" &&
          isInIpv6Cidr(value, network, prefixLength),
      )
    );
  }
  return false;
}

function parseIpv6Address(address: string): bigint | null {
  let normalized = address;
  const embeddedIpv4 = normalized.match(
    /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/u,
  )?.[1];
  if (embeddedIpv4 !== undefined) {
    const octets = embeddedIpv4.split(".").map(Number);
    if (
      octets.length !== 4 ||
      octets.some(
        (octet) =>
          !Number.isSafeInteger(octet) || octet < 0 || octet > 255,
      )
    ) {
      return null;
    }
    const high = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
    const low = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
    normalized =
      normalized.slice(0, -embeddedIpv4.length) +
      `${high.toString(16)}:${low.toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) {
    return null;
  }
  const left = halves[0]?.length
    ? (halves[0] ?? "").split(":")
    : [];
  const right = halves[1]?.length
    ? (halves[1] ?? "").split(":")
    : [];
  const omitted = 8 - left.length - right.length;
  if (
    (halves.length === 1 && omitted !== 0) ||
    (halves.length === 2 && omitted < 1)
  ) {
    return null;
  }
  const groups = [
    ...left,
    ...Array.from({ length: omitted }, () => "0"),
    ...right,
  ];
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))
  ) {
    return null;
  }
  return groups.reduce(
    (value, group) => (value << 16n) | BigInt(`0x${group}`),
    0n,
  );
}

function isInIpv6Cidr(
  value: bigint,
  network: string,
  prefixLength: number,
): boolean {
  const parsedNetwork = parseIpv6Address(network);
  if (parsedNetwork === null) {
    return false;
  }
  const shift = 128n - BigInt(prefixLength);
  return value >> shift === parsedNetwork >> shift;
}

function unsafeEndpoint(
  provider: PublishingProvider,
  operation: string,
): PublishingProviderError {
  return new PublishingProviderError({
    code: "UNSAFE_ENDPOINT",
    provider,
    operation,
    message: "Provider endpoint failed the public HTTPS boundary.",
  });
}

function mapHttpFailure(
  provider: PublishingProvider,
  operation: string,
  status: number,
  providerRequestId: string | null,
): PublishingProviderError {
  if (status === 401) {
    return new PublishingProviderError({
      code: "AUTH_REVOKED",
      provider,
      operation,
      message: "Provider authorization is no longer valid.",
      providerRequestId,
    });
  }
  if (status === 403) {
    return new PublishingProviderError({
      code: "SCOPE_DENIED",
      provider,
      operation,
      message: "Provider scope does not permit this operation.",
      providerRequestId,
    });
  }
  if (status === 404) {
    return new PublishingProviderError({
      code: "SCOPE_REVOKED",
      provider,
      operation,
      message: "Provider scope is no longer available.",
      providerRequestId,
    });
  }
  if (status === 409 || status === 412) {
    return new PublishingProviderError({
      code: "REMOTE_STALE",
      provider,
      operation,
      message: "Remote revision no longer matches the approved preview.",
      providerRequestId,
    });
  }
  return new PublishingProviderError({
    code: "REMOTE_UNAVAILABLE",
    provider,
    operation,
    message: "Provider request did not complete successfully.",
    retryable: status === 429 || status >= 500,
    providerRequestId,
    safeDetails: { status },
  });
}

async function readBoundedText(
  response: Response,
  maxResponseBytes: number,
  provider: PublishingProvider,
  operation: string,
  providerRequestId: string | null,
  signal: AbortSignal,
): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    Number.isFinite(Number(declaredLength)) &&
    Number(declaredLength) > maxResponseBytes
  ) {
    cancelBody(response);
    throw responseTooLarge(
      provider,
      operation,
      providerRequestId,
      maxResponseBytes,
    );
  }

  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) {
        void reader.cancel().catch(() => undefined);
        throw new DOMException("aborted", "AbortError");
      }
      const result = await readChunk(reader, signal);
      if (result.done) {
        break;
      }
      total += result.value.byteLength;
      if (total > maxResponseBytes) {
        void reader.cancel().catch(() => undefined);
        throw responseTooLarge(
          provider,
          operation,
          providerRequestId,
          maxResponseBytes,
        );
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<
  Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>
> {
  if (signal.aborted) {
    throw new DOMException("aborted", "AbortError");
  }
  return await new Promise<
    Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>
  >(
    (resolve, reject) => {
      let settled = false;
      const cleanup = () => signal.removeEventListener("abort", onAbort);
      const onAbort = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        void reader.cancel().catch(() => undefined);
        reject(new DOMException("aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      void reader.read().then(
        (result) => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          resolve(result);
        },
        (error: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          reject(error);
        },
      );
    },
  );
}

function responseTooLarge(
  provider: PublishingProvider,
  operation: string,
  providerRequestId: string | null,
  maxResponseBytes: number,
): PublishingProviderError {
  return new PublishingProviderError({
    code: "RESPONSE_TOO_LARGE",
    provider,
    operation,
    message: "Provider response exceeded the configured byte limit.",
    providerRequestId,
    safeDetails: { maxResponseBytes },
  });
}

function cancelBody(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

function getProviderRequestId(headers: Headers): string | null {
  return (
    headers.get("x-github-request-id") ??
    headers.get("x-wp-request-id") ??
    headers.get("x-request-id")
  );
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException
      ? error.name === "AbortError"
      : error instanceof Error && error.name === "AbortError"
  );
}

function cancelledError(
  provider: PublishingProvider,
  operation: string,
): PublishingProviderError {
  return new PublishingProviderError({
    code: "CANCELLED",
    provider,
    operation,
    message: "Provider request was cancelled by the caller.",
  });
}

function assertBound(value: number, field: string, maximum: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(
      `${field} must be a positive integer no greater than ${maximum}`,
    );
  }
}
