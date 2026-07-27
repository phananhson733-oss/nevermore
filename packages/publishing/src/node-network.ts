import type { LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import type { ClientRequest, IncomingMessage } from "node:http";
import {
  request as httpsRequest,
  type RequestOptions as HttpsRequestOptions,
} from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { checkServerIdentity } from "node:tls";

import {
  createBoundedJsonTransport,
  isPublicAddress,
  UnsafeResolvedAddressError,
  type BoundedJsonTransport,
  type BoundedTransportOptions,
  type PinnedFetchLike,
  type ResolvedEndpoint,
  type ResolveHostname,
} from "./http";

export type NodePublishingTransportOptions = Omit<
  BoundedTransportOptions,
  "fetch" | "now" | "resolveHostname" | "sleep"
> & {
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
};

type LookupAll = (
  hostname: string,
  options: { readonly all: true; readonly verbatim: true },
) => Promise<readonly LookupAddress[]>;

type HttpsRequest = (
  options: HttpsRequestOptions,
  onResponse: (response: IncomingMessage) => void,
) => ClientRequest;

const nodeLookupAll: LookupAll = async (hostname, options) =>
  await dnsLookup(hostname, options);

const nodeHttpsRequest: HttpsRequest = (options, onResponse) =>
  httpsRequest(options, onResponse);

/**
 * Resolve all A/AAAA answers through the operating-system resolver. The
 * returned set is fail-closed: one private, local, reserved, malformed, or
 * family-mismatched answer rejects the entire set.
 */
export function createNodeHostnameResolver(): ResolveHostname {
  return createNodeHostnameResolverForTesting(nodeLookupAll);
}

/**
 * Test seam for deterministic DNS behavior. It is deliberately not re-exported
 * from the package entrypoint; production callers receive the built-in lookup.
 *
 * @internal
 */
export function createNodeHostnameResolverForTesting(
  lookupAll: LookupAll,
): ResolveHostname {
  return async (
    hostname: string,
    signal: AbortSignal,
  ): Promise<readonly string[]> => {
    throwIfAborted(signal);
    const entries = await raceWithAbort(
      Promise.resolve().then(
        async () =>
          await lookupAll(hostname, { all: true, verbatim: true }),
      ),
      signal,
    );
    const addresses = [
      ...new Set(entries.map((entry) => entry.address)),
    ];
    if (
      addresses.length === 0 ||
      entries.some(
        (entry) =>
          (entry.family !== 4 && entry.family !== 6) ||
          isIP(entry.address) !== entry.family ||
          !isPublicAddress(entry.address),
      )
    ) {
      throw new UnsafeResolvedAddressError();
    }
    return Object.freeze(addresses);
  };
}

/**
 * A real Node PinnedFetchLike. It opens a one-request HTTPS connection directly
 * to one guard-approved address. The URL hostname remains the HTTP Host and TLS
 * identity; no DNS lookup or automatic redirect can occur in this layer.
 */
export function createNodePinnedFetch(): PinnedFetchLike {
  return createNodePinnedFetchForTesting(nodeHttpsRequest);
}

/**
 * Test seam for observing the exact Node HTTPS request boundary. It is not
 * re-exported from the package entrypoint.
 *
 * @internal
 */
export function createNodePinnedFetchForTesting(
  requestHttps: HttpsRequest,
): PinnedFetchLike {
  return async (
    input: string | URL | Request,
    init: RequestInit | undefined,
    endpoint: ResolvedEndpoint,
  ): Promise<Response> => {
    const request = new Request(input, init);
    const signal = request.signal;
    throwIfAborted(signal);

    const url = new URL(request.url);
    // Snapshot before the first await. Production endpoints are frozen by the
    // guard, but this keeps the primitive safe even if a caller hands it a
    // mutable object and changes it while a Request body is being consumed.
    const approvedEndpoint: ResolvedEndpoint = Object.freeze({
      origin: endpoint.origin,
      hostname: endpoint.hostname,
      addresses: Object.freeze([...endpoint.addresses]),
    });
    assertPinnedEndpoint(url, approvedEndpoint);
    const pinnedAddress = approvedEndpoint.addresses[0];
    if (pinnedAddress === undefined) {
      throw new TypeError("Request did not include a validated endpoint.");
    }

    const body =
      request.body === null
        ? undefined
        : new Uint8Array(await request.arrayBuffer());
    throwIfAborted(signal);

    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      headers[name] = value;
    });
    // A caller-supplied Host header must never override the approved origin.
    headers.host = url.host;

    const family = isIP(pinnedAddress);
    const requestOptions: HttpsRequestOptions = {
      protocol: "https:",
      hostname: pinnedAddress,
      family,
      port: 443,
      method: request.method,
      path: `${url.pathname}${url.search}`,
      headers,
      // Never pool a credential-bearing provider request across origins.
      agent: false,
      rejectUnauthorized: true,
      ...(isIP(approvedEndpoint.hostname) === 0
        ? { servername: approvedEndpoint.hostname }
        : {}),
      // Keep certificate identity bound to the original hostname even though
      // the TCP socket is opened directly against the pinned address.
      checkServerIdentity: (_hostname, certificate) =>
        checkServerIdentity(approvedEndpoint.hostname, certificate),
    };

    return await sendPinnedRequest(
      requestHttps,
      requestOptions,
      request.method,
      body,
      signal,
    );
  };
}

/**
 * Explicit production factory. It wires the real DNS resolver and pinned HTTPS
 * implementation into the existing timeout, byte, retry, and redirect bounds.
 * Merely importing this module performs no request and enables no provider
 * write path.
 */
export function createNodePublishingTransport(
  options: NodePublishingTransportOptions = {},
): BoundedJsonTransport {
  const {
    now = () => new Date(),
    sleep = defaultSleep,
    ...bounds
  } = options;
  return createBoundedJsonTransport({
    ...bounds,
    fetch: createNodePinnedFetch(),
    resolveHostname: createNodeHostnameResolver(),
    now,
    sleep,
  });
}

function assertPinnedEndpoint(
  url: URL,
  endpoint: ResolvedEndpoint,
): void {
  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[/u, "")
    .replace(/\]$/u, "");
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0 ||
    (url.port.length > 0 && url.port !== "443") ||
    url.origin !== endpoint.origin ||
    hostname !== endpoint.hostname ||
    endpoint.addresses.length === 0 ||
    endpoint.addresses.some((address) => !isPublicAddress(address))
  ) {
    throw new TypeError("Request did not match the validated endpoint.");
  }
}

async function sendPinnedRequest(
  requestHttps: HttpsRequest,
  options: HttpsRequestOptions,
  method: string,
  body: Uint8Array | undefined,
  signal: AbortSignal,
): Promise<Response> {
  return await new Promise<Response>((resolve, reject) => {
    let clientRequest: ClientRequest | undefined;
    let responseReceived = false;
    let settled = false;

    const cleanupBeforeResponse = () => {
      signal.removeEventListener("abort", onAbort);
    };
    const rejectOnce = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanupBeforeResponse();
      reject(error);
    };
    const onAbort = () => {
      const error = abortReason(signal);
      clientRequest?.destroy(error);
      if (!responseReceived) {
        rejectOnce(error);
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }

    try {
      clientRequest = requestHttps(options, (incoming) => {
        responseReceived = true;
        const cleanupAfterResponse = () => {
          signal.removeEventListener("abort", onAbort);
        };
        incoming.once("end", cleanupAfterResponse);
        incoming.once("close", cleanupAfterResponse);
        incoming.once("error", cleanupAfterResponse);
        try {
          const response = toWebResponse(incoming, method);
          settled = true;
          resolve(response);
        } catch (error) {
          cleanupAfterResponse();
          incoming.destroy();
          clientRequest?.destroy();
          rejectOnce(error);
        }
      });
      clientRequest.once("error", (error) => {
        if (!responseReceived) {
          rejectOnce(error);
        }
      });
      clientRequest.end(body);
    } catch (error) {
      clientRequest?.destroy();
      rejectOnce(error);
    }
  });
}

function toWebResponse(
  incoming: IncomingMessage,
  method: string,
): Response {
  const status = incoming.statusCode;
  if (status === undefined) {
    throw new Error("Provider response did not include an HTTP status.");
  }
  const headers = new Headers();
  if (incoming.rawHeaders.length > 0) {
    for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
      const name = incoming.rawHeaders[index];
      const value = incoming.rawHeaders[index + 1];
      if (name !== undefined && value !== undefined) {
        headers.append(name, value);
      }
    }
  } else {
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) {
        value.forEach((item) => headers.append(name, item));
      } else if (value !== undefined) {
        headers.append(name, value);
      }
    }
  }

  const bodyless =
    method === "HEAD" ||
    status === 204 ||
    status === 205 ||
    status === 304;
  if (bodyless) {
    incoming.resume();
  }
  const body = bodyless
    ? null
    : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>);
  return new Response(body, {
    status,
    ...(incoming.statusMessage === undefined
      ? {}
      : { statusText: incoming.statusMessage }),
    headers,
  });
}

async function raceWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void operation.then(
      (value) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
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
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortReason(signal);
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("This operation was aborted", "AbortError");
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
