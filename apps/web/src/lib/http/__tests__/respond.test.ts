import { describe, expect, it } from "vitest";
import { asyncAccepted } from "../respond.ts";

describe("asyncAccepted", () => {
  it("matches the shared OpenAPI envelope and polling headers", async () => {
    const data = {
      run: { id: "run-1", status: "queued" },
      statusUrl: "/api/mvp/projects/project-1/runs/run-1",
      resourceRef: { type: "export", id: "export-1" },
    };

    const response = asyncAccepted(
      data,
      "request-12345678",
      data.statusUrl,
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("Location")).toBe(data.statusUrl);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(response.headers.get("X-Request-Id")).toBe("request-12345678");
    await expect(response.json()).resolves.toEqual({ data });
  });
});
