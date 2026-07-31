// @input  -- POST JSON body naming one granted Search Console property
// @output -- traffic drop diagnosis envelope or a stable error envelope
// @pos    -- thin Next.js boundary over the shared traffic-drop handler
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { extractClientIp } from "@/lib/rate-limit";
import { handleTrafficDropRequest } from "@/lib/tools/traffic-drop-handler";
import { createTrafficDropReader } from "@/lib/tools/traffic-drop-reader";
import {
  isGoogleConnectEnabled,
  readGoogleConsentNotice,
  readTrafficDropGrant,
} from "@/lib/tools/traffic-drop-session";

export const runtime = "nodejs";
/** Search Console paging plus backoff; well inside the platform limit. */
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  // The token is read here and handed straight to the reader, so it exists
  // only for the life of this request and never reaches a server component.
  const grant = await readTrafficDropGrant();

  return handleTrafficDropRequest(request, {
    readSession: () =>
      Promise.resolve({
        properties: grant?.properties ?? null,
        propertyTotal: grant?.properties.length ?? 0,
        connectEnabled: isGoogleConnectEnabled(),
        consentNotice: readGoogleConsentNotice(),
      }),
    readDailySeries: grant
      ? createTrafficDropReader({ accessToken: grant.accessToken })
      : /* Unreachable: the handler rejects a missing grant before reading. */
        () => Promise.reject(new Error("no_search_console_grant")),
    now: () => new Date(),
    extractClientIp,
  });
}
