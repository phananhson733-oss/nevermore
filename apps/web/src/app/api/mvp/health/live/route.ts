import { route } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";

/** Liveness: process is up. No dependency checks (spec §13.3). */
export const GET = route((_request, ctx) => ok({ status: "live" }, ctx.requestId));

export const dynamic = "force-dynamic";
