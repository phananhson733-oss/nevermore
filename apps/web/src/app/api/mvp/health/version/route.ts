import { resolveBuildMetadata } from "@sf/contracts";
import { route } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";

/** Public deploy identity (spec DoD §18.8): contract plus immutable build SHA. */
export const GET = route((_request, ctx) =>
  ok(resolveBuildMetadata("web"), ctx.requestId),
);

export const dynamic = "force-dynamic";
