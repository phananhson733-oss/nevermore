import { describe, expect, it } from "vitest";
import { requireSafeTestDatabaseUrl } from "./test-database-safety.ts";

describe("requireSafeTestDatabaseUrl", () => {
  it.each([
    "postgres://tester@localhost:5432/signalframe_e2e_local",
    "postgresql://tester:secret@127.0.0.1:5432/signalframe_ci",
    "postgres://tester@[::1]:5432/signalframe_codex_run_123",
  ])("accepts an explicitly disposable loopback database: %s", (value) => {
    expect(requireSafeTestDatabaseUrl(value, "E2E_DATABASE_URL")).toBe(value);
  });

  it.each([
    [undefined, "is required"],
    ["", "is required"],
    ["not a url", "valid PostgreSQL URL"],
    ["https://localhost/signalframe_e2e_local", "PostgreSQL URL"],
    ["postgres://db.example.com/signalframe_e2e_local", "loopback"],
    ["postgres://localhost/production", "disposable database name"],
    ["postgres://localhost/postgres", "disposable database name"],
  ])("rejects an unsafe value without echoing it", (value, message) => {
    let error: Error | undefined;
    try {
      requireSafeTestDatabaseUrl(value, "E2E_DATABASE_URL");
    } catch (caught) {
      error = caught as Error;
    }
    expect(error?.message).toContain(message);
    if (value) expect(error?.message).not.toContain(value);
  });
});
