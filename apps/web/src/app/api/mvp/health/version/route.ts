import { route } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";

/** Public version endpoint (spec DoD §18.8): productVersion / contractVersion. */
export const GET = route((_request, ctx) =>
  ok({ productVersion: "0.2.0", contractVersion: "2026-07-18" }, ctx.requestId),
);

export const dynamic = "force-dynamic";
