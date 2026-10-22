import { describe, expect, it } from "vitest";
import { normalizeOwnedDestination, registerShortLink } from "./short-links";

describe("short-link target validation", () => {
  it.each(["https://evil.example/", "https://gengrowth.ai:444/", "https://user:pass@gengrowth.ai/", "javascript://gengrowth.ai/path", "ftp://gengrowth.ai/"])("rejects %s", (url) => {
    expect(normalizeOwnedDestination(url)).toBeNull();
  });
  it("retains owned http compatibility and upgrades to https", () => {
    expect(normalizeOwnedDestination("http://www.gengrowth.ai/path?x=1")).toBe("https://www.gengrowth.ai/path?x=1");
  });
});

function racingAdmin(destination: string, errorCode = "23505") {
  let reads = 0;
  return {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ++reads === 1 ? null : { code: "launch", destination_url: destination, redirect_status: 302 }, error: null }) }) }),
      insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: errorCode, message: "insert failed" } }) }) }),
    }),
  } as never;
}

describe("concurrent duplicate registration", () => {
  it("reuses a matching row inserted by another request", async () => {
    await expect(registerShortLink("launch", "https://gengrowth.ai/", racingAdmin("https://gengrowth.ai/"))).resolves.toMatchObject({ ok: true, reused: true });
  });
  it("returns conflict when the raced row points elsewhere", async () => {
    await expect(registerShortLink("launch", "https://gengrowth.ai/", racingAdmin("https://gengrowth.ai/other"))).resolves.toMatchObject({ ok: false, status: 409 });
  });
  it("does not hide unrelated insert failures", async () => {
    await expect(registerShortLink("launch", "https://gengrowth.ai/", racingAdmin("https://gengrowth.ai/", "42501"))).rejects.toThrow();
  });
});
