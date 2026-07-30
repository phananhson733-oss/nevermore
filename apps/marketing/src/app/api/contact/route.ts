// @input  — POST request body
// @output — Explicit disabled response; public marketing lead capture is not configured
// @pos    — Contact API endpoint retained only to prevent accidental writes to the retired Supabase project
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { apiError } from "@/lib/api-response";

export async function POST() {
  return apiError(
    "LEAD_CAPTURE_UNAVAILABLE",
    "Lead capture is not currently available. Please email hello@gengrowth.ai.",
    503,
  );
}
