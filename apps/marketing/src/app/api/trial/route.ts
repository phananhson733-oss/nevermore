// @input  — POST request body
// @output — Explicit disabled response; trials are initiated in the product application
// @pos    — Public marketing compatibility endpoint that must not write to the retired Supabase project
// Once this file is updated, update the header comments and the parent _DIR.md
import { apiError } from "@/lib/api-response";

export async function POST() {
  return apiError(
    "LEAD_CAPTURE_UNAVAILABLE",
    "Please start your trial in the GenGrowth application.",
    503,
  );
}
