import { describe, expect, it } from "vitest";
import { postgresUrlIssue, runtimeHttpUrlIssue } from "./runtime-url.ts";

describe("runtimeHttpUrlIssue", () => {
  it("allows canonical loopback HTTP only in explicit development/test environments", () => {
    expect(
      runtimeHttpUrlIssue("http://127.0.0.1:3000", "development", {
        originOnly: true,
      }),
    ).toBeNull();
    expect(
      runtimeHttpUrlIssue("http://127.0.0.1:3000", undefined, {
        originOnly: true,
      }),
    ).toBe(
      "must use HTTPS; HTTP is allowed only for loopback development/test endpoints",
    );
  });
});

describe("postgresUrlIssue", () => {
  it("accepts direct and session-mode Supabase URLs", () => {
    expect(
      postgresUrlIssue(
        "postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
      ),
    ).toBeNull();
    expect(
      postgresUrlIssue(
        "postgres://postgres.abcdefghijklmnopqrst:pw@aws-0-us-west-1.pooler.supabase.com:5432/postgres",
      ),
    ).toBeNull();
  });

  it("rejects shared and dedicated Supabase transaction-pooler URLs", () => {
    expect(
      postgresUrlIssue(
        "postgres://postgres.abcdefghijklmnopqrst:pw@aws-0-us-west-1.pooler.supabase.com:6543/postgres",
      ),
    ).toBe(
      "must not use a Supabase transaction-pooler URL; use a direct connection or Supavisor session mode instead",
    );
    expect(
      postgresUrlIssue(
        "postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:6543/postgres",
      ),
    ).toBe(
      "must not use a Supabase transaction-pooler URL; use a direct connection or Supavisor session mode instead",
    );
  });

  it("does not overreach to non-Supabase PostgreSQL hosts on port 6543", () => {
    expect(
      postgresUrlIssue("postgresql://app:pw@db.example.com:6543/signalframe"),
    ).toBeNull();
  });
});
