import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { route } from "@/lib/http/handler";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("route unexpected-error logging", () => {
  it("logs only stable failure metadata, never arbitrary error content", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const wrapped = route(() => {
      throw new Error("customer-content-secret");
    });

    const response = await wrapped(
      new NextRequest("http://localhost/api/mvp/projects"),
    );

    expect(response.status).toBe(500);
    const logged = stderr.mock.calls.map(([line]) => String(line)).join("");
    expect(logged).not.toContain("customer-content-secret");
    expect(logged).toContain('"event":"unhandled_error"');
    expect(logged).toContain('"code":"INTERNAL_ERROR"');
    expect(logged).toContain('"type":"internal"');
  });
});
