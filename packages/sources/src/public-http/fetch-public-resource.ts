import { fetch as undiciFetch } from "undici";
import type { Dispatcher } from "undici";
import { isIP } from "node:net";
import {
  canonicalUrlGuard,
  createPinnedAgent,
  normaliseIpv4,
  type UrlGuardResult,
} from "../url-safety/index.ts";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export const PUBLIC_RESOURCE_DEFAULT_TIMEOUT_MS = 8_000;
export const PUBLIC_RESOURCE_DEFAULT_MAX_REDIRECTS = 5;
export const PUBLIC_RESOURCE_DEFAULT_MAX_BODY_BYTES = 1_500_000;
export const PUBLIC_RESOURCE_DEFAULT_USER_AGENT =
  "GenGrowth-Public-Tools/1.0 (+https://gengrowth.ai/tools)";

export type PublicResourceErrorCode =
  | "blocked"
  | "cross_origin"
  | "invalid_redirect"
  | "network"
  | "redirect_limit"
  | "timeout";

export interface PublicResourceSuccess {
  readonly kind: "ok";
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly firstStatus: number;
  readonly finalStatus: number;
  readonly redirectChain: readonly string[];
  readonly contentType: string | null;
  readonly xRobotsTag: string | null;
  readonly body: string;
  readonly bytes: number;
  /**
   * False means `body` is only the bounded response prefix. Consumers may use
   * observed positive facts, but must not infer that a tag/value is absent.
   */
  readonly bodyComplete: boolean;
}

export interface PublicResourceFailure {
  readonly kind: "error";
  readonly code: PublicResourceErrorCode;
}

export type PublicResourceResult =
  | PublicResourceSuccess
  | PublicResourceFailure;

export interface PublicResourceFetchOptions {
  readonly timeoutMs?: number;
  readonly maxRedirects?: number;
  readonly maxBodyBytes?: number;
  readonly userAgent?: string;
  /**
   * When set, the initial URL and every redirect must have this exact origin.
   * Used for standard-path robots.txt and sitemap.xml probes.
   */
  readonly allowedOrigin?: string;
  /**
   * Optional redirect policy evaluated before the next guard or network
   * request. This lets callers admit a narrowly defined canonical-host
   * transition without enabling arbitrary cross-site redirects.
   */
  readonly allowRedirect?: (fromUrl: string, toUrl: string) => boolean;
}

export interface PublicResourceFetchInit {
  readonly signal: AbortSignal;
  readonly redirect: "manual";
  readonly dispatcher: Dispatcher;
  readonly headers: Readonly<Record<string, string>>;
}

export interface PublicResourceFetchDependencies {
  readonly guard: (url: string) => Promise<UrlGuardResult>;
  readonly createDispatcher: (
    hostname: string,
    pinnedIp: string,
  ) => Dispatcher & { close(): Promise<void> };
  readonly fetch: (
    url: string,
    init: PublicResourceFetchInit,
  ) => Promise<Response>;
}

interface BoundedBody {
  readonly body: string;
  readonly bytes: number;
  readonly complete: boolean;
}

type SignalRace<T> =
  | { readonly kind: "value"; readonly value: T }
  | { readonly kind: "error"; readonly error: unknown }
  | { readonly kind: "aborted" };

function raceWithSignal<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<SignalRace<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: SignalRace<T>): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = (): void => finish({ kind: "aborted" });
    signal.addEventListener("abort", onAbort, { once: true });
    void operation.then(
      (value) => finish({ kind: "value", value }),
      (error: unknown) => finish({ kind: "error", error }),
    );
    if (signal.aborted) onAbort();
  });
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return resolved;
}

function nonNegativeInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return resolved;
}

function originMatches(url: string, allowedOrigin: string | undefined): boolean {
  if (!allowedOrigin) return true;
  try {
    return new URL(url).origin === allowedOrigin;
  } catch {
    return false;
  }
}

/**
 * Parse a network target without applying the crawler's identity
 * canonicalisation. Fetch semantics (path slash and query order) are preserved,
 * while the public preview surface is restricted to hostname-based HTTP(S) on
 * standard ports. The canonical guard still performs the authoritative DNS/IP
 * classification and returns the connect-time pin.
 */
function publicFetchUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.port
  ) {
    return null;
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !hostname ||
    !hostname.includes(".") ||
    normaliseIpv4(hostname) !== null ||
    isIP(hostname) !== 0
  ) {
    return null;
  }
  parsed.hash = "";
  return parsed.toString();
}

function cancelBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // A hostile stream may throw synchronously. Cleanup remains best effort.
  }
}

async function readBoundedBody(
  response: Response,
  maxBodyBytes: number,
): Promise<BoundedBody> {
  const stream = response.body;
  if (!stream) return { body: "", bytes: 0, complete: true };

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let complete = true;

  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const value = next.value;
      if (!value || value.byteLength === 0) continue;

      const remaining = maxBodyBytes - bytes;
      if (value.byteLength > remaining) {
        if (remaining > 0) {
          chunks.push(value.slice(0, remaining));
          bytes += remaining;
        }
        complete = false;
        try {
          await reader.cancel();
        } catch {
          // The evidence boundary is already known; cancellation is best effort.
        }
        break;
      }

      chunks.push(value);
      bytes += value.byteLength;
      // If the chunk exactly fills the cap, perform one more read. A clean EOF
      // means complete; another byte means the retained evidence is a prefix.
      if (bytes === maxBodyBytes) {
        const overflow = await reader.read();
        if (!overflow.done) {
          complete = false;
          try {
            await reader.cancel();
          } catch {
            // Best effort.
          }
        }
        break;
      }
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // Preserve the original stream error.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    body: new TextDecoder().decode(combined),
    bytes,
    complete,
  };
}

function errorCode(error: unknown, signal: AbortSignal): PublicResourceErrorCode {
  if (
    signal.aborted ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    return "timeout";
  }
  return "network";
}

async function closeDispatcher(
  dispatcher: Dispatcher & { close(): Promise<void> },
): Promise<void> {
  try {
    await dispatcher.close();
  } catch {
    // A failed close must not leak internal transport details to the caller.
  }
}

const DEFAULT_DEPENDENCIES: PublicResourceFetchDependencies = {
  guard: canonicalUrlGuard,
  createDispatcher: createPinnedAgent,
  fetch: (url, init) =>
    undiciFetch(url, {
      signal: init.signal,
      redirect: init.redirect,
      dispatcher: init.dispatcher,
      headers: init.headers,
      cache: "no-store",
    }) as unknown as Promise<Response>,
};

/**
 * Fetch one public HTTP resource with a fresh guard-validated, IP-pinned
 * dispatcher on every hop. The function never exposes DNS addresses or raw
 * transport errors.
 */
export async function fetchPublicResource(
  requestedUrl: string,
  options: PublicResourceFetchOptions = {},
  dependencies: PublicResourceFetchDependencies = DEFAULT_DEPENDENCIES,
): Promise<PublicResourceResult> {
  const timeoutMs = positiveInteger(
    options.timeoutMs,
    PUBLIC_RESOURCE_DEFAULT_TIMEOUT_MS,
    "timeoutMs",
  );
  const maxRedirects = nonNegativeInteger(
    options.maxRedirects,
    PUBLIC_RESOURCE_DEFAULT_MAX_REDIRECTS,
    "maxRedirects",
  );
  const maxBodyBytes = positiveInteger(
    options.maxBodyBytes,
    PUBLIC_RESOURCE_DEFAULT_MAX_BODY_BYTES,
    "maxBodyBytes",
  );
  const userAgent =
    options.userAgent ?? PUBLIC_RESOURCE_DEFAULT_USER_AGENT;
  const allowedOrigin = options.allowedOrigin
    ? new URL(options.allowedOrigin).origin
    : undefined;

  const initialUrl = publicFetchUrl(requestedUrl);
  if (!initialUrl) {
    return { kind: "error", code: "blocked" };
  }
  if (!originMatches(initialUrl, allowedOrigin)) {
    return { kind: "error", code: "cross_origin" };
  }
  const initialProtocol = new URL(initialUrl).protocol;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const redirectChain: string[] = [];
  let currentUrl = initialUrl;
  let firstStatus: number | null = null;

  try {
    for (;;) {
      if (controller.signal.aborted) {
        return { kind: "error", code: "timeout" };
      }

      const fetchUrl = publicFetchUrl(currentUrl);
      if (
        !fetchUrl ||
        (initialProtocol === "https:" &&
          new URL(fetchUrl).protocol !== "https:")
      ) {
        return { kind: "error", code: "blocked" };
      }
      currentUrl = fetchUrl;

      const guardRace = await raceWithSignal(
        dependencies.guard(currentUrl),
        controller.signal,
      );
      if (guardRace.kind === "aborted") {
        return { kind: "error", code: "timeout" };
      }
      if (guardRace.kind === "error") {
        return {
          kind: "error",
          code: controller.signal.aborted ? "timeout" : "blocked",
        };
      }
      const guarded: UrlGuardResult = guardRace.value;
      if (
        !guarded.safe ||
        !guarded.pinnedIp
      ) {
        return { kind: "error", code: "blocked" };
      }
      if (!originMatches(currentUrl, allowedOrigin)) {
        return { kind: "error", code: "cross_origin" };
      }

      const hostname = new URL(currentUrl).hostname;
      let dispatcher: Dispatcher & { close(): Promise<void> };
      try {
        dispatcher = dependencies.createDispatcher(
          hostname,
          guarded.pinnedIp,
        );
      } catch {
        return { kind: "error", code: "blocked" };
      }

      try {
        const fetchRace = await raceWithSignal(
          dependencies.fetch(currentUrl, {
            signal: controller.signal,
            redirect: "manual",
            dispatcher,
            headers: { "user-agent": userAgent },
          }),
          controller.signal,
        );
        if (fetchRace.kind === "aborted") {
          return { kind: "error", code: "timeout" };
        }
        if (fetchRace.kind === "error") {
          return {
            kind: "error",
            code: errorCode(fetchRace.error, controller.signal),
          };
        }
        const response = fetchRace.value;

        firstStatus ??= response.status;
        if (REDIRECT_STATUSES.has(response.status)) {
          const location = response.headers.get("location");
          if (!location) {
            const bodyRace = await raceWithSignal(
              readBoundedBody(response, maxBodyBytes),
              controller.signal,
            );
            if (bodyRace.kind === "aborted") {
              cancelBody(response);
              return { kind: "error", code: "timeout" };
            }
            if (bodyRace.kind === "error") {
              return {
                kind: "error",
                code: errorCode(bodyRace.error, controller.signal),
              };
            }
            const bounded = bodyRace.value;
            return {
              kind: "ok",
              requestedUrl: initialUrl,
              finalUrl: currentUrl,
              firstStatus,
              finalStatus: response.status,
              redirectChain,
              contentType: response.headers.get("content-type"),
              xRobotsTag: response.headers.get("x-robots-tag"),
              body: bounded.body,
              bytes: bounded.bytes,
              bodyComplete: bounded.complete,
            };
          }
          if (redirectChain.length >= maxRedirects) {
            cancelBody(response);
            return { kind: "error", code: "redirect_limit" };
          }

          let nextUrl: string;
          try {
            nextUrl = new URL(location, currentUrl).toString();
          } catch {
            cancelBody(response);
            return { kind: "error", code: "invalid_redirect" };
          }
          cancelBody(response);
          if (
            !originMatches(nextUrl, allowedOrigin) ||
            (options.allowRedirect &&
              !options.allowRedirect(currentUrl, nextUrl))
          ) {
            return { kind: "error", code: "cross_origin" };
          }
          redirectChain.push(nextUrl);
          currentUrl = nextUrl;
          continue;
        }

        const bodyRace = await raceWithSignal(
          readBoundedBody(response, maxBodyBytes),
          controller.signal,
        );
        if (bodyRace.kind === "aborted") {
          cancelBody(response);
          return { kind: "error", code: "timeout" };
        }
        if (bodyRace.kind === "error") {
          return {
            kind: "error",
            code: errorCode(bodyRace.error, controller.signal),
          };
        }
        const bounded: BoundedBody = bodyRace.value;
        return {
          kind: "ok",
          requestedUrl: initialUrl,
          finalUrl: currentUrl,
          firstStatus,
          finalStatus: response.status,
          redirectChain,
          contentType: response.headers.get("content-type"),
          xRobotsTag: response.headers.get("x-robots-tag"),
          body: bounded.body,
          bytes: bounded.bytes,
          bodyComplete: bounded.complete,
        };
      } finally {
        await closeDispatcher(dispatcher);
      }
    }
  } finally {
    clearTimeout(timer);
  }
}
