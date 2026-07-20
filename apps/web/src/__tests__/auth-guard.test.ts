import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// Replace the session module so no real DB/Supabase dependencies load.
vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => null),
}));

const { operatorRoute } = await import("@/lib/http/handler");
const { getOperatorContext } = await import("@/lib/auth/session");

describe("operatorRoute auth guard (AC-005)", () => {
  it("returns 401 problem+json when no operator is resolved", async () => {
    const handler = operatorRoute(() => {
      throw new Error("handler must not run when unauthenticated");
    });
    const res = await handler(new NextRequest("http://localhost/api/mvp/projects"));

    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(res.headers.get("x-request-id")).toBeTruthy();

    const body = (await res.json()) as { code: string; status: number };
    expect(body.code).toBe("AUTH_REQUIRED");
    expect(body.status).toBe(401);
  });

  it.each([
    ["empty context", {}],
    ["undefined params", { params: undefined }],
  ])("runs a static route when Next supplies %s", async (_label, routeCtx) => {
    vi.mocked(getOperatorContext).mockResolvedValueOnce({
      userId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002",
    });
    const businessHandler = vi.fn(() =>
      NextResponse.json({ data: { ok: true } }, { status: 201 }),
    );
    const handler = operatorRoute(businessHandler);

    const response = await handler(
      new NextRequest("http://localhost/api/mvp/projects"),
      routeCtx as never,
    );

    expect(response.status).toBe(201);
    expect(businessHandler).toHaveBeenCalledTimes(1);
  });
});
