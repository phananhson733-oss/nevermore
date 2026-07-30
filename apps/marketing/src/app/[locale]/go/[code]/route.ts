// @input  -- GET /en/go/[code] or /zh/go/[code] defensive short-link requests
// @output -- Delegated 302 redirect using the shared /go/[code] handler
// @pos    -- Locale-prefixed compatibility entrypoint for GenGrowth attribution short links
// once this file is updated, update header comments and _DIR.md in this folder
export const dynamic = "force-dynamic";

export { GET } from "@/app/go/[code]/route";
