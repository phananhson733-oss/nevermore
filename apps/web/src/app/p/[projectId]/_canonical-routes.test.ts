import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
  StudioClient: vi.fn(),
  ExecutionClient: vi.fn(),
  ReportClient: vi.fn(),
  ResultsClient: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("./studio/_studio.tsx", () => ({ StudioClient: mocks.StudioClient }));
vi.mock("./execution/_execution.tsx", () => ({
  ExecutionClient: mocks.ExecutionClient,
}));
vi.mock("./report/_report.tsx", () => ({ ReportClient: mocks.ReportClient }));
vi.mock("./results/_results.tsx", () => ({
  ResultsClient: mocks.ResultsClient,
}));

import ExecutionPage from "./execution/page.tsx";
import PlanPage from "./plan/page.tsx";
import ReportPage from "./report/page.tsx";
import ResultsPage from "./results/page.tsx";
import StudioPage from "./studio/page.tsx";

const PROJECT_ID = "00000000-0000-4000-8000-000000000042";
const ACTION_ID = "00000000-0000-4000-8000-000000000043";
const ARTIFACT_ID = "00000000-0000-4000-8000-000000000044";

beforeEach(() => {
  mocks.redirect.mockClear();
});

describe("canonical project shell routes", () => {
  it("renders the Execution single-chain client at /execution", async () => {
    const element = await ExecutionPage({
      params: Promise.resolve({ projectId: PROJECT_ID }),
      searchParams: Promise.resolve({
        actionId: ACTION_ID,
        artifactId: ARTIFACT_ID,
      }),
    });

    expect(element.type).toBe(mocks.ExecutionClient);
    expect(element.props).toEqual({
      projectId: PROJECT_ID,
      initialDeepLink: {
        kind: "target",
        actionId: ACTION_ID,
        artifactId: ARTIFACT_ID,
      },
    });
  });

  it("passes an invalid bounded selection to Execution instead of dropping it", async () => {
    const element = await ExecutionPage({
      params: Promise.resolve({ projectId: PROJECT_ID }),
      searchParams: Promise.resolve({ actionId: "not-a-uuid" }),
    });

    expect(element.type).toBe(mocks.ExecutionClient);
    expect(element.props).toEqual({
      projectId: PROJECT_ID,
      initialDeepLink: { kind: "invalid", invalidKeys: ["actionId"] },
    });
  });

  it("renders the recheck Results client at /results", async () => {
    const element = await ResultsPage({
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(element.type).toBe(mocks.ResultsClient);
    expect(element.props).toEqual({ projectId: PROJECT_ID });
  });
});

describe("legacy project shell route compatibility", () => {
  it.each([
    ["plan", PlanPage],
    ["studio", StudioPage],
  ])("redirects /%s to canonical /execution", async (_route, page) => {
    await expect(
      page({
        params: Promise.resolve({ projectId: PROJECT_ID }),
        searchParams: Promise.resolve({ actionId: ACTION_ID, mode: "edit" }),
      }),
    ).rejects.toThrow(
      `NEXT_REDIRECT:/p/${PROJECT_ID}/execution?actionId=${ACTION_ID}&mode=edit`,
    );
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/p/${PROJECT_ID}/execution?actionId=${ACTION_ID}&mode=edit`,
    );
  });

  it("redirects /report to /results without dropping query state", async () => {
    await expect(
      ReportPage({
        params: Promise.resolve({ projectId: PROJECT_ID }),
        searchParams: Promise.resolve({
          outputLocale: ["zh-CN", "en"],
          focus: "campaign & attribution",
          absent: undefined,
        }),
      }),
    ).rejects.toThrow(
      `NEXT_REDIRECT:/p/${PROJECT_ID}/results?outputLocale=zh-CN&outputLocale=en&focus=campaign+%26+attribution`,
    );
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/p/${PROJECT_ID}/results?outputLocale=zh-CN&outputLocale=en&focus=campaign+%26+attribution`,
    );
  });

  it("redirects a queryless /report deep link to /results", async () => {
    await expect(
      ReportPage({
        params: Promise.resolve({ projectId: PROJECT_ID }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow(`NEXT_REDIRECT:/p/${PROJECT_ID}/results`);
  });
});
