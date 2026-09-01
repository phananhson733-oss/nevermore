// @input -- authenticated same-origin POST naming an exact page evidence snapshot
// @output -- one optional DataForSEO semantic review, never automatic paid retries
// @pos -- thin Next.js route over the evidence and durable-admission handler
import { handleCitabilityAiRequest } from "../../../../../lib/geo-tools/citability-ai-handler.ts";

export const runtime = "nodejs";
/** A bounded 8s refetch and up to 120s provider call, plus admission overhead. */
export const maxDuration = 180;

export async function POST(request: Request): Promise<Response> {
  return handleCitabilityAiRequest(request);
}
