import { describe, expect, it } from "vitest";
import {
  isDevAuthEnabled,
  isLoopbackDevelopmentRuntime,
  type RuntimeEnvironment,
} from "./dev.ts";

const enabled = (overrides: RuntimeEnvironment = {}): RuntimeEnvironment => ({
  NODE_ENV: "development",
  APP_ORIGIN: "http://localhost:3000",
  SF_DEV_AUTH: "true",
  ...overrides,
});

describe("local development runtime boundary", () => {
  it.each([
    "http://localhost:3000",
    "https://localhost",
    "http://127.0.0.1:3200",
    "http://[::1]:3100",
  ])("allows the exact loopback origin %s", (appOrigin) => {
    expect(
      isLoopbackDevelopmentRuntime(enabled({ APP_ORIGIN: appOrigin })),
    ).toBe(true);
    expect(isDevAuthEnabled(enabled({ APP_ORIGIN: appOrigin }))).toBe(true);
  });

  it.each([
    ["production runtime", { NODE_ENV: "production" }],
    ["test runtime", { NODE_ENV: "test" }],
    ["staging runtime", { NODE_ENV: "staging" }],
    ["missing runtime", { NODE_ENV: undefined }],
    ["missing origin", { APP_ORIGIN: undefined }],
    ["invalid origin", { APP_ORIGIN: "not-a-url" }],
    ["public origin", { APP_ORIGIN: "https://staging.example.com" }],
    ["localhost suffix attack", { APP_ORIGIN: "https://localhost.example.com" }],
    ["IPv4 suffix attack", { APP_ORIGIN: "https://127.0.0.1.example.com" }],
    ["wildcard bind", { APP_ORIGIN: "http://0.0.0.0:3000" }],
    ["URL credentials", { APP_ORIGIN: "http://operator@localhost:3000" }],
  ] satisfies ReadonlyArray<readonly [string, RuntimeEnvironment]>) (
    "rejects %s",
    (_label, overrides) => {
      const env = enabled(overrides);
      expect(isLoopbackDevelopmentRuntime(env)).toBe(false);
      expect(isDevAuthEnabled(env)).toBe(false);
    },
  );

  it("requires the explicit dev-auth flag even on loopback development", () => {
    expect(isDevAuthEnabled(enabled({ SF_DEV_AUTH: "false" }))).toBe(false);
    expect(isDevAuthEnabled(enabled({ SF_DEV_AUTH: undefined }))).toBe(false);
  });
});
