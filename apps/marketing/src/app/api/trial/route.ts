// @input  — POST request body
// @output — Explicit disabled response that points product interest to the marketing waitlist
// @pos    — Public marketing compatibility endpoint that must not write to the retired Supabase project
// Once this file is updated, update the header comments and the parent _DIR.md
// Relative import: the shared unit-test alias maps `@/` to apps/web.
import { apiError } from "../../../lib/api-response";

export async function POST() {
  return apiError(
    "LEAD_CAPTURE_UNAVAILABLE",
    "Product access is not currently open. Join the waitlist at /waitlist for access updates.",
    503,
  );
}
