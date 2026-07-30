// @input  — POST or PATCH request
// @output — Explicit disabled response; public marketing lead capture is not configured
// @pos    — Waitlist API endpoint retained only to prevent accidental writes or email sends
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { apiError } from "@/lib/api-response";

export async function POST() {
  return unavailable();
}

export async function PATCH() {
  return unavailable();
}

function unavailable() {
  return apiError(
    "LEAD_CAPTURE_UNAVAILABLE",
    "Lead capture is not currently available. Please start in the GenGrowth application.",
    503,
  );
}
