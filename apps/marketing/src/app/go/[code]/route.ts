// @input  -- GET /go/[code] requests and Supabase link_redirects mappings
// @output -- 302 redirect to stored owned destination or homepage fallback
// @pos    -- Public clean short-link entrypoint for GenGrowth attribution
// once this file is updated, update header comments and _DIR.md in this folder
import { NextResponse } from "next/server";
import {
  findShortLink,
  normalizeOwnedDestination,
  normalizeShortLinkCode,
} from "@/lib/link-attribution/short-links";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ code?: string }> | { code?: string };
};

export async function GET(request: Request, context: RouteContext) {
  const fallback = new URL("/", request.url);
  const params = await Promise.resolve(context.params);
  const code = normalizeShortLinkCode(params.code);

  if (!code) {
    return NextResponse.redirect(fallback, 302);
  }

  try {
    const record = await findShortLink(code);
    const destination = normalizeOwnedDestination(record?.destination_url);
    return NextResponse.redirect(destination ?? fallback, record?.redirect_status ?? 302);
  } catch {
    return NextResponse.redirect(fallback, 302);
  }
}
