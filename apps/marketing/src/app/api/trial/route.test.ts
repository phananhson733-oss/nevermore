// @input  -- disabled marketing trial compatibility endpoint
// @output -- regression guard for app-closed and waitlist-only response semantics
// @pos    -- prevents an old API caller from being told to open an unavailable app

import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("POST /api/trial", () => {
  it("fails closed and points product interest to the marketing waitlist", async () => {
    const response = await POST();
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json.error.code).toBe("LEAD_CAPTURE_UNAVAILABLE");
    expect(json.error.message).toContain("/waitlist");
    expect(json.error.message).not.toMatch(/free trial|application/i);
  });
});
