// @input  -- same-origin authenticated POST without a body, plus admission and Google grant dependencies
// @output -- fresh cookie-bounded properties, real total and brand candidates, or a stable private error
// @pos    -- explicit Search Console property refresh, independent of report-run quota
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { brandTermCandidates, createPublicToolError } from "@sf/public-tools";
import { cookies } from "next/headers";
import { identitySubFrom, type GrantResolution } from "../auth/grant-cookie.ts";
import { acquireGscSlot } from "./gsc-inflight.ts";
import { refuseWithoutGrant } from "./gsc-gate.ts";
import type { PublicToolSlot } from "./public-tool-request.ts";
import {
  consumePublicToolQuota,
  DEFAULT_SHARED_QUOTA_DEPENDENCIES,
  type SharedQuotaDependencies,
} from "./shared-rate-limit.ts";
import {
  isGoogleConnectEnabled,
  resolveTrafficDropGrant,
} from "./traffic-drop-session.ts";

/** A site-list read is cheaper than a report and must not consume report runs. */
export const GSC_PROPERTIES_IP_MAX = 30;
export const GSC_PROPERTIES_IP_WINDOW_SECONDS = 60 * 60;

export interface GscPropertiesHandlerDependencies {
  readonly readIdentity: () => Promise<string | null>;
  readonly connectEnabled: () => boolean;
  readonly refreshProperties: () => Promise<GrantResolution>;
  readonly extractClientIp: (headers: Headers) => string;
  readonly acquireSlot: (clientIp: string) => PublicToolSlot;
  readonly quota: SharedQuotaDependencies;
}

function json(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", ...headers },
  });
}

export async function handleGscPropertiesRequest(
  request: Request,
  dependencies: GscPropertiesHandlerDependencies,
): Promise<Response> {
  // Browser POSTs identify their origin. No body or caller-supplied property is trusted.
  const origin = request.headers.get("Origin");
  if (origin !== new URL(request.url).origin) {
    return json(createPublicToolError("invalid_request"), 403);
  }

  let release: (() => void) | undefined;
  try {
    if (
      !dependencies.connectEnabled() ||
      await dependencies.readIdentity() === null
    ) {
      return refuseWithoutGrant({ kind: "none" });
    }

    const clientIp = dependencies.extractClientIp(request.headers);
    const slot = dependencies.acquireSlot(clientIp);
    if (!slot.acquired) {
      return json(createPublicToolError("scan_in_progress"), 409, {
        "Retry-After": "5",
      });
    }
    release = slot.release;

    const quota = await consumePublicToolQuota(
      `gsc-properties:ip:${clientIp}`,
      GSC_PROPERTIES_IP_MAX,
      GSC_PROPERTIES_IP_WINDOW_SECONDS,
      dependencies.quota,
    );
    if (quota.kind === "unavailable") {
      return json(createPublicToolError("quota_unavailable"), 503, {
        "Retry-After": "60",
      });
    }
    if (quota.kind === "limited") {
      return json(createPublicToolError("rate_limited"), 429, {
        "Retry-After": String(quota.retryAfterSeconds),
      });
    }

    // Binding and token renewal are checked here, only after durable admission.
    const grant = await dependencies.refreshProperties();
    if (grant.kind !== "grant") return refuseWithoutGrant(grant);
    return json({
      data: {
        properties: grant.properties,
        propertyTotal: grant.propertyTotal,
        brandCandidates: Object.fromEntries(
          grant.properties.map((property) => [
            property,
            brandTermCandidates(property),
          ]),
        ),
      },
    }, 200);
  } catch {
    return refuseWithoutGrant({ kind: "unavailable" });
  } finally {
    release?.();
  }
}

export const DEFAULT_GSC_PROPERTIES_DEPENDENCIES: Omit<
  GscPropertiesHandlerDependencies,
  "extractClientIp"
> = {
  readIdentity: async () => identitySubFrom((await cookies()).get("gg_id")?.value),
  connectEnabled: isGoogleConnectEnabled,
  refreshProperties: () => resolveTrafficDropGrant({ refreshProperties: true }),
  acquireSlot: acquireGscSlot,
  quota: DEFAULT_SHARED_QUOTA_DEPENDENCIES,
};
