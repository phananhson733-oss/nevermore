// @input -- a fully validated complete editor result, after all source reads
// @output -- private bounded JSON, without buffering a single Vercel payload
// @pos -- response transport only; never streams unfinished model content
import { privateError } from "../account-websites/route-http.ts";

const MAX_BYTES = 8_400_000; // The 8 MiB editor contract plus its small route envelope.
const CHUNK_BYTES = 65_536;

/** Vercel's documented streaming response path avoids the buffered 4.5 MB
 * response ceiling. The complete JSON is validated and bounded before headers;
 * clients still use response.json() and never receive partial model results.
 * https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions */
export function privateGeoEditorJson(body: unknown): Response {
  let bytes: Uint8Array;
  try {
    const text = JSON.stringify(body);
    if (text === undefined) throw new Error("Missing JSON");
    bytes = new TextEncoder().encode(text);
    if (bytes.byteLength > MAX_BYTES) return privateError("response_too_large", 503);
  } catch { return privateError("response_too_large", 503); }
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) { controller.close(); return; }
      controller.enqueue(bytes.subarray(offset, offset + CHUNK_BYTES));
      offset += CHUNK_BYTES;
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" } });
}
