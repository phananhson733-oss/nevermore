// @input  -- same-origin authenticated POST with no body
// @output -- refreshed Search Console properties and brand candidates, never Google credentials
// @pos    -- thin Next.js boundary for the property-list refresh handler

import { extractClientIp } from "@/lib/rate-limit";
import {
  DEFAULT_GSC_PROPERTIES_DEPENDENCIES,
  handleGscPropertiesRequest,
} from "@/lib/tools/gsc-properties-handler";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  return handleGscPropertiesRequest(request, {
    ...DEFAULT_GSC_PROPERTIES_DEPENDENCIES,
    extractClientIp,
  });
}
