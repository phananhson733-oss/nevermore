import { describe, expect, it } from "vitest";
import {
  E2E_PROJECT_ID,
  e2eProjectShell,
  shouldUseE2eProjectShell,
} from "./_e2e-shell.ts";

describe("isolated E2E project shell gate", () => {
  const localDevelopment = {
    NODE_ENV: "development",
    APP_ORIGIN: "http://localhost:3200",
    SF_E2E_MOCK_API: "true",
  } as const;

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

  it("builds a stable shell project without a database", () => {
    const project = e2eProjectShell(E2E_PROJECT_ID);

    expect(project.id).toBe(E2E_PROJECT_ID);
    expect(project.clientName).toBe("E2E Client");
    expect(project.site.host).toBe("example.test");
    expect(project.contextStatus).toBe("complete");
  });
});
