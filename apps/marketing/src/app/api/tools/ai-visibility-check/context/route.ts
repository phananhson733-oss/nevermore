// @input -- verified account and optional exact frozen snapshot selector
// @output -- private read-only website preparation contexts
// @pos -- Visibility input API; no provider or mutation
import { handleVisibilityContext } from "../../../../../lib/geo-tools/visibility-context-handler.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> { return handleVisibilityContext(request); }
