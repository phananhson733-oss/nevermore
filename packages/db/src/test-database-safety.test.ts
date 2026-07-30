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
    [
      "postgres://localhost/signalframe_e2e_local?host=/var/run/postgresql",
      "connection routing",
    ],
    [
      "postgres://localhost/signalframe_e2e_local?HOSTADDR=203.0.113.10",
      "connection routing",
    ],
    [
      "postgres://localhost/signalframe_e2e_local?service=production",
      "connection routing",
    ],
    [
      "postgres://localhost/signalframe_e2e_%ZZ",
      "disposable database name",
    ],
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

  it("accepts a disposable database name at PostgreSQL's 63-byte limit", () => {
    const databaseName = `signalframe_e2e_${"a".repeat(47)}`;
    const value = `postgresql://tester@localhost:5432/${databaseName}`;

    expect(Buffer.byteLength(databaseName, "utf8")).toBe(63);
    expect(requireSafeTestDatabaseUrl(value)).toBe(value);
  });

  it("rejects a disposable database name beyond PostgreSQL's 63-byte limit", () => {
    const databaseName = `signalframe_e2e_${"a".repeat(48)}`;
    const value = `postgresql://tester:do-not-reflect@localhost:5432/${databaseName}`;

    expect(() =>
      requireSafeTestDatabaseUrl(value, "E2E_DATABASE_URL"),
    ).toThrow("63 bytes");
    try {
      requireSafeTestDatabaseUrl(value, "E2E_DATABASE_URL");
    } catch (error: unknown) {
      expect((error as Error).message).not.toContain(value);
      expect((error as Error).message).not.toContain("do-not-reflect");
    }
  });

  it("allows non-routing PostgreSQL connection options", () => {
    const value =
      "postgresql://tester@localhost:5432/signalframe_e2e_local?sslmode=disable&application_name=real-e2e";

    expect(requireSafeTestDatabaseUrl(value)).toBe(value);
  });
});
