import { SourceError } from "./adapter.ts";

/** Provider calls must finish independently of the queue-level job timeout. */
export const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 30_000;

/** Applies to decoded response bytes, so compressed responses cannot bypass it. */
export const DEFAULT_PROVIDER_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export interface RequestAbortScope {
  readonly signal: AbortSignal;
  cleanup(): void;
}

function safeAbortReason(name: "AbortError" | "TimeoutError"): DOMException {
  const message =
    name === "TimeoutError"
      ? "Provider request timed out."
      : "Provider request aborted.";
  return new DOMException(message, name);
}

/**
 * Combines caller cancellation with a per-request timeout. The returned cleanup
 * must run after both fetch and response-body consumption have finished.
 */
export function createRequestAbortScope(
  timeoutMs: number,
  externalSignals: readonly (AbortSignal | undefined)[],
): RequestAbortScope {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "Provider request timeout must be positive.",
    );
  }

  const controller = new AbortController();
  const subscribed: AbortSignal[] = [];
  const abortFromCaller = (): void => {
    if (!controller.signal.aborted) {
      controller.abort(safeAbortReason("AbortError"));
    }
  };

  for (const signal of externalSignals) {
    if (!signal) continue;
    if (signal.aborted) {
      abortFromCaller();
      break;
    }
    signal.addEventListener("abort", abortFromCaller, { once: true });
    subscribed.push(signal);
  }

  const timeout = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(safeAbortReason("TimeoutError"));
    }
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      for (const signal of subscribed) {
        signal.removeEventListener("abort", abortFromCaller);
      }
    },
  };
}

export function isAbortLike(error: unknown): boolean {
  if (error === null || typeof error !== "object" || !("name" in error)) {
    return false;
  }
  const name = error.name;
  return name === "AbortError" || name === "TimeoutError";
}

function runBestEffortCleanup(action: () => unknown): void {
  try {
    const result = action();
    if (result !== undefined) {
      void Promise.resolve(result).catch(() => undefined);
    }
  } catch {
    // Cleanup cannot replace or delay the stable request outcome.
  }
}

/** Release an unread provider body so its connection is not held indefinitely. */
export async function cancelResponseBody(response: Response): Promise<void> {
  runBestEffortCleanup(() => response.body?.cancel());
}

function declaredLength(response: Response): number | null {
  const raw = response.headers.get("content-length")?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): void {
  runBestEffortCleanup(() => reader.cancel());
}

function releaseReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): void {
  runBestEffortCleanup(() => reader.releaseLock());
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Provider request aborted.", "AbortError");
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<Awaited<ReturnType<typeof reader.read>>> {
  if (!signal) return reader.read();
  if (signal.aborted) throw abortReason(signal);

  return new Promise<Awaited<ReturnType<typeof reader.read>>>(
    (resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        signal.removeEventListener("abort", onAbort);
      };
      const resolveOnce = (
        value: Awaited<ReturnType<typeof reader.read>>,
      ): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const rejectOnce = (error: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onAbort = (): void => rejectOnce(abortReason(signal));

      signal.addEventListener("abort", onAbort, { once: true });
      try {
        void reader.read().then(resolveOnce, rejectOnce);
      } catch (error) {
        rejectOnce(error);
      }
    },
  );
}

function oversizedResponse(context: string): SourceError {
  return new SourceError(
    "INVALID_RESPONSE",
    `${context} exceeded the maximum response size.`,
  );
}

/** Read and parse JSON while enforcing a cap against actual streamed bytes. */
export async function readBoundedJson(
  response: Response,
  maxBytes: number,
  context: string,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "Provider response size limit must be positive.",
    );
  }

  const contentLength = declaredLength(response);
  if (contentLength !== null && contentLength > maxBytes) {
    await cancelResponseBody(response);
    throw oversizedResponse(context);
  }

  if (!response.body) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${context} returned an empty response body.`,
    );
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await readChunk(reader, signal);
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        cancelReader(reader);
        throw oversizedResponse(context);
      }
      chunks.push(value);
    }
  } catch (error) {
    cancelReader(reader);
    throw error;
  } finally {
    releaseReader(reader);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${context} returned a non-JSON body.`,
    );
  }
}
