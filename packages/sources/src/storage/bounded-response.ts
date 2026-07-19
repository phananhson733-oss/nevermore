/**
 * Shared network-boundary primitives for Supabase Storage REST calls. Fetch
 * resolves after response headers, so the timeout remains active while a body is
 * decoded and every body is consumed incrementally under an explicit byte cap.
 */

export class ResponseBodyTooLargeError extends Error {
  readonly limitBytes: number;

  constructor(limitBytes: number) {
    super("response body exceeded the configured byte limit");
    this.name = "ResponseBodyTooLargeError";
    this.limitBytes = limitBytes;
  }
}

export interface RequestAbortScope {
  readonly signal: AbortSignal;
  readonly timedOut: () => boolean;
  readonly dispose: () => void;
}

/** Compose a per-request timeout with zero or more caller-provided signals. */
export function createRequestAbortScope(
  timeoutMs: number,
  signals: readonly (AbortSignal | null | undefined)[] = [],
): RequestAbortScope {
  const controller = new AbortController();
  const listeners: Array<{
    readonly signal: AbortSignal;
    readonly listener: () => void;
  }> = [];
  let timeoutReached = false;

  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const listener = (): void => controller.abort(signal.reason);
    signal.addEventListener("abort", listener, { once: true });
    listeners.push({ signal, listener });
  }

  const timer = setTimeout(() => {
    timeoutReached = true;
    controller.abort(new DOMException("request timed out", "TimeoutError"));
  }, timeoutMs);
  if (typeof timer === "object" && "unref" in timer) timer.unref();

  return {
    signal: controller.signal,
    timedOut: () => timeoutReached,
    dispose: () => {
      clearTimeout(timer);
      for (const { signal, listener } of listeners) {
        signal.removeEventListener("abort", listener);
      }
    },
  };
}

/** Best-effort cancellation for response bodies the caller does not consume. */
export async function cancelResponseBody(response: Response): Promise<void> {
  try {
    const cancellation = response.body?.cancel();
    void cancellation?.catch(() => undefined);
  } catch {
    // An already-consumed/errored body needs no further work.
  }
}

/** Read decoded response bytes without ever buffering beyond `maxBytes`. */
export async function readBoundedResponseBytes(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await cancelResponseBody(response);
    throw new ResponseBodyTooLargeError(maxBytes);
  }

  const body = response.body;
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await readChunk(reader, signal);
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      if (totalBytes + value.byteLength > maxBytes) {
        try {
          void reader.cancel().catch(() => undefined);
        } catch {
          // Preserve the stable size-limit failure below.
        }
        throw new ResponseBodyTooLargeError(maxBytes);
      }
      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } catch (error) {
    if (!(error instanceof ResponseBodyTooLargeError)) {
      try {
        void reader.cancel().catch(() => undefined);
      } catch {
        // Preserve the original stream/abort failure.
      }
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  return new TextDecoder().decode(
    await readBoundedResponseBytes(response, maxBytes, signal),
  );
}

export async function readBoundedResponseJson(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<unknown> {
  return JSON.parse(
    await readBoundedResponseText(response, maxBytes, signal),
  );
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<{
  readonly done: boolean;
  readonly value: Uint8Array | undefined;
}> {
  if (!signal) return reader.read();
  if (signal.aborted) throw abortReason(signal);

  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void reader.read().then(
      (result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function abortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ?? new DOMException("request aborted", "AbortError")
  );
}
