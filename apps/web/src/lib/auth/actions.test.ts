import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

const { signInAction } = await import("./actions.ts");
const { SIGN_IN_ERROR_CODE } = await import("./action-state.ts");

afterEach(() => {
  mocks.redirect.mockReset();
  mocks.createSupabaseServerClient.mockReset();
});

function formData(entries: Readonly<Record<string, string>>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
}

describe("signInAction", () => {
  it("returns a stable error code for missing credentials", async () => {
    await expect(
      signInAction(
        { errorCode: null },
        formData({ email: "", password: "", next: "/p/project-1/report" }),
      ),
    ).resolves.toEqual({ errorCode: SIGN_IN_ERROR_CODE });
  });

  it("returns the same stable error code for auth failures", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: {
        signInWithPassword: vi.fn(async () => ({
          error: new Error("provider-secret-detail"),
        })),
      },
    });

    await expect(
      signInAction(
        { errorCode: null },
        formData({
          email: "operator@example.test",
          password: "wrong-password",
          next: "/p/project-1/report",
        }),
      ),
    ).resolves.toEqual({ errorCode: SIGN_IN_ERROR_CODE });
  });
});
