// @vitest-environment jsdom
// @input  -- a sign-out call against a stubbed endpoint and populated Web Storage
// @output -- proof that signing out takes this site's local data with it
// @pos    -- the sign-out endpoint clears cookies only; this covers the rest

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signOut } from "./sign-out-action.ts";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // jsdom has no navigation; the caller reloads after a successful sign-out.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload: vi.fn() },
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function endpointReturning(status: number): void {
  globalThis.fetch = vi.fn(
    async () => new Response(null, { status }),
  ) as typeof fetch;
}

describe("signing out", () => {
  it("clears the page checker's local data as well as the cookies", async () => {
    endpointReturning(200);
    localStorage.setItem("gengrowth:onpage-history:v1", "[]");
    sessionStorage.setItem("gengrowth:onpage-draft:v1", "{}");
    localStorage.setItem("gg-theme", "dark");

    await signOut();

    expect(localStorage.getItem("gengrowth:onpage-history:v1")).toBeNull();
    expect(sessionStorage.getItem("gengrowth:onpage-draft:v1")).toBeNull();
    // Someone else's key is not ours to delete.
    expect(localStorage.getItem("gg-theme")).toBe("dark");
    expect(window.location.reload).toHaveBeenCalled();
  });

  it("takes the GEO report with it, because that report restores itself", async () => {
    // GeoWorkbench reads this key in a mount effect. Sign-out reloads the page,
    // so a report left behind is a report handed to the next person in the tab.
    endpointReturning(200);
    sessionStorage.setItem("geo_report_session.v1", '{"schemaVersion":"x"}');

    await signOut();

    expect(sessionStorage.getItem("geo_report_session.v1")).toBeNull();
  });

  it("leaves local data alone when the sign-out itself failed", async () => {
    endpointReturning(500);
    localStorage.setItem("gengrowth:onpage-history:v1", "[]");

    await signOut();

    // Still signed in, so the data still belongs to the person looking at it.
    expect(localStorage.getItem("gengrowth:onpage-history:v1")).toBe("[]");
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it("posts to the sign-out endpoint rather than reading it", async () => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 200 }),
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await signOut();

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/sign-out", {
      method: "POST",
    });
  });
});
