import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadE2eProjectShell,
  shouldUseE2eProjectShell,
} from "./_e2e-shell.ts";
import {
  E2E_PROJECT_ID,
  e2eProjectShell,
  e2eProjectShellProjection,
} from "./_e2e-shell-fixture.ts";

describe("isolated E2E project shell gate", () => {
  const localDevelopment = {
    NODE_ENV: "development",
    APP_ORIGIN: "http://localhost:3200",
    SF_E2E_MOCK_API: "true",
  } as const;

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is enabled only for the reserved project on loopback development", () => {
    expect(
      shouldUseE2eProjectShell(localDevelopment, E2E_PROJECT_ID),
    ).toBe(true);
    expect(
      shouldUseE2eProjectShell(
        { ...localDevelopment, NODE_ENV: "production" },
        E2E_PROJECT_ID,
      ),
    ).toBe(false);
    expect(
      shouldUseE2eProjectShell(
        { ...localDevelopment, NODE_ENV: "test" },
        E2E_PROJECT_ID,
      ),
    ).toBe(false);
    expect(
      shouldUseE2eProjectShell(
        { ...localDevelopment, APP_ORIGIN: "https://staging.example.com" },
        E2E_PROJECT_ID,
      ),
    ).toBe(false);
    expect(
      shouldUseE2eProjectShell(
        localDevelopment,
        "another-project",
      ),
    ).toBe(false);
    expect(
      shouldUseE2eProjectShell(
        { NODE_ENV: "development", APP_ORIGIN: "http://localhost:3200" },
        E2E_PROJECT_ID,
      ),
    ).toBe(false);
  });

  it("cannot load the fixture in a production process", async () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(
      shouldUseE2eProjectShell(localDevelopment, E2E_PROJECT_ID),
    ).toBe(false);
    await expect(
      loadE2eProjectShell(localDevelopment, E2E_PROJECT_ID),
    ).resolves.toBeNull();
  });

  it("loads the fixture only through the isolated development path", async () => {
    await expect(
      loadE2eProjectShell(
        {
          ...localDevelopment,
          SF_E2E_CLIENT_NAME: "RelayOps",
          SF_E2E_PROJECT_NAME: "海外增长工作台",
        },
        E2E_PROJECT_ID,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        currentProject: expect.objectContaining({
          id: E2E_PROJECT_ID,
          clientName: "RelayOps",
          projectName: "海外增长工作台",
        }),
      }),
    );
  });

  it("keeps fixture bytes out of the production-reachable gate source", async () => {
    const gateSource = await readFile(
      new URL("./_e2e-shell.ts", import.meta.url),
      "utf8",
    );

    expect(gateSource).not.toContain("SF_E2E_MOCK_API");
    expect(gateSource).not.toContain(
      "00000000-0000-4000-8000-000000000042",
    );
    expect(gateSource).not.toContain("E2E Client");
    expect(gateSource).not.toContain("example.test");
  });

  it("builds a stable shell project without a database", () => {
    const project = e2eProjectShell(E2E_PROJECT_ID);

    expect(project.id).toBe(E2E_PROJECT_ID);
    expect(project.clientName).toBe("E2E Client");
    expect(project.site.host).toBe("example.test");
    expect(project.contextStatus).toBe("complete");
  });

  it("accepts isolated visual-acceptance labels without changing defaults", () => {
    const project = e2eProjectShell(E2E_PROJECT_ID, {
      SF_E2E_CLIENT_NAME: "RelayOps",
      SF_E2E_PROJECT_NAME: "海外增长工作台",
    });

    expect(project.clientName).toBe("RelayOps");
    expect(project.projectName).toBe("海外增长工作台");
  });

  it("builds explicit non-authoritative cockpit data for the browser harness", () => {
    const shell = e2eProjectShellProjection(E2E_PROJECT_ID);

    expect(shell.currentProject.id).toBe(E2E_PROJECT_ID);
    expect(shell.projectOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: E2E_PROJECT_ID, selected: true }),
        expect.objectContaining({ id: expect.any(String), selected: false }),
      ]),
    );
    expect(shell.navigationBadges).toEqual({ diagnosis: 1, studio: 1 });
    expect(shell.program).toEqual({
      day: 30,
      totalDays: 90,
      progressPercent: 33,
    });
  });
});
