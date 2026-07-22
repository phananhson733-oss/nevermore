import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import DiagnosisPage from "./page";

const PROJECT_ID = "00000000-0000-4000-8000-000000000042";

beforeEach(() => {
  mocks.redirect.mockClear();
});

describe("legacy Diagnosis route", () => {
  it("redirects to canonical Growth Map without dropping deep-link query state", async () => {
    await expect(
      DiagnosisPage({
        params: Promise.resolve({ projectId: PROJECT_ID }),
        searchParams: Promise.resolve({
          selectedSitePageId: "00000000-0000-4000-8000-000000000043",
          evidence: ["a", "b"],
          search: "A&B / C",
          absent: undefined,
        }),
      }),
    ).rejects.toThrow(
      `NEXT_REDIRECT:/p/${PROJECT_ID}/growth-map?selectedSitePageId=00000000-0000-4000-8000-000000000043&evidence=a&evidence=b&q=A%26B+%2F+C`,
    );
  });

  it("translates the legacy object tab without overriding canonical state", async () => {
    await expect(
      DiagnosisPage({
        params: Promise.resolve({ projectId: PROJECT_ID }),
        searchParams: Promise.resolve({
          tab: "keyword",
          object: "competitors",
          search: "legacy query",
          q: "canonical query",
        }),
      }),
    ).rejects.toThrow(
      `NEXT_REDIRECT:/p/${PROJECT_ID}/growth-map?object=competitors&q=canonical+query`,
    );
  });

  it("redirects a queryless legacy route to Growth Map", async () => {
    await expect(
      DiagnosisPage({
        params: Promise.resolve({ projectId: PROJECT_ID }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow(`NEXT_REDIRECT:/p/${PROJECT_ID}/growth-map`);
  });
});
