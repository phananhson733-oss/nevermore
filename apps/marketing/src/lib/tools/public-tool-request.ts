export type PublicToolRequestErrorCode =
  | "invalid_request"
  | "payload_too_large"
  | "unsupported_media_type";

export type PublicToolJsonResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly code: PublicToolRequestErrorCode };

const activeSlots = new Set<string>();

function requestError(code: PublicToolRequestErrorCode): PublicToolJsonResult {
  return { ok: false, code };
}

export async function readPublicToolJson(
  request: Request,
  maxBytes: number,
): Promise<PublicToolJsonResult> {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return requestError("unsupported_media_type");
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("maxBytes must be a positive safe integer");
  }

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return requestError("payload_too_large");
  }
  if (!request.body) return requestError("invalid_request");

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const value = next.value;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The request is already rejected; cancellation remains best effort.
        }
        return requestError("payload_too_large");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    return requestError("invalid_request");
  } finally {
    reader.releaseLock();
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return requestError("invalid_request");
  }
}

export type PublicToolSlot =
  | { readonly acquired: false }
  | { readonly acquired: true; readonly release: () => void };

/**
 * Per-isolate best-effort concurrency gate. A globally strict limit requires a
 * shared store and is intentionally not claimed by this V0 implementation.
 */
export function acquirePublicToolSlot(key: string): PublicToolSlot {
  if (activeSlots.has(key)) return { acquired: false };
  activeSlots.add(key);
  let released = false;
  return {
    acquired: true,
    release: () => {
      if (released) return;
      released = true;
      activeSlots.delete(key);
    },
  };
}

/**
 * Share one crawl slot across every synchronous public crawler for this IP.
 * This is intentionally per isolate; a globally strict gate would require a
 * shared store that is outside the stateless public-tools architecture.
 */
export function acquirePublicCrawlSlot(clientIp: string): PublicToolSlot {
  return acquirePublicToolSlot(`tools:public-crawl:inflight:${clientIp}`);
}

/** Test-only reset. */
export function resetPublicToolSlots(): void {
  activeSlots.clear();
}
