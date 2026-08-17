// @input  -- GET ?cursor=<createdAt>|<id> from a signed-in browser
// @output -- one page of this visitor's credit history, newest first
// @pos    -- the read side of the account page's history table

import { NextResponse } from "next/server";

import { getServerAuthenticatedUser } from "../../../../lib/auth/server-auth-user.ts";
import {
  LEDGER_PAGE_SIZE,
  creditsEnabled,
} from "../../../../lib/credits/credits-config.ts";
import {
  decodeLedgerCursor,
  readLedger,
} from "../../../../lib/credits/credits-store.ts";

export const runtime = "nodejs";

/** One person's own money history; nothing on this path may retain it. */
const CACHE_CONTROL = "no-store, private";

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": CACHE_CONTROL },
  });
}

function failure(code: string, status: number): NextResponse {
  return json({ error: { code } }, status);
}

export async function GET(request: Request): Promise<Response> {
  if (!creditsEnabled()) return failure("credits_disabled", 404);

  const authentication = await getServerAuthenticatedUser();
  if (authentication.status === "unavailable") {
    return failure("auth_unavailable", 503);
  }
  if (authentication.status === "unauthenticated") {
    return failure("auth_required", 401);
  }

  const requested = new URL(request.url).searchParams.get("cursor");
  const cursor = decodeLedgerCursor(requested);
  // An absent or empty cursor is the first page. Anything else that fails to
  // parse is refused rather than silently restarted from the top, which would
  // look to the reader like their history had been truncated.
  if (cursor === null && requested !== null && requested !== "") {
    return failure("invalid_cursor", 400);
  }

  // The page size is ours. Honouring a caller's `limit` would turn one request
  // into a full-table read of an append-only table that only grows.
  const page = await readLedger(authentication.userId, {
    limit: LEDGER_PAGE_SIZE,
    cursor,
  });
  if (page.kind !== "ok") return failure("credits_unavailable", 503);

  return json(
    {
      data: {
        entries: page.value.entries,
        nextCursor: page.value.nextCursor,
      },
    },
    200,
  );
}
