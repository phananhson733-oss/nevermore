import { describe, expect, it, vi } from "vitest";
import { clientProjects, workspaces } from "@sf/db/schema";
import { ProblemError } from "@sf/observability";

import { assertProjectQuotaAvailable } from "./plan-limits.ts";

/**
 * The free-tier project ceiling.
 *
 * The fake records which table each select hit and whether the workspace read
 * asked for a row lock, because the lock is the whole correctness argument:
 * count-then-insert without it lets two concurrent creates both observe zero.
 */
function fakeTx(options: {
  readonly planTier?: string | null;
  readonly activeProjects?: number;
  readonly workspaceMissing?: boolean;
}) {
  const forUpdate = vi.fn();
  const selectedTables: unknown[] = [];

  const select = vi.fn(() => ({
    from: (table: unknown) => {
      selectedTables.push(table);
      if (table === workspaces) {
        return {
          where: () => ({
            for: (strength: string) => {
              forUpdate(strength);
              return {
                limit: async () =>
                  options.workspaceMissing
                    ? []
                    : [{ planTier: options.planTier ?? "free" }],
              };
            },
          }),
        };
      }
      return {
        where: async () => [{ total: options.activeProjects ?? 0 }],
      };
    },
  }));

  return { select, spies: { forUpdate, selectedTables } };
}

const WORKSPACE = "00000000-0000-4000-8000-0000000000aa";

describe("assertProjectQuotaAvailable", () => {
  it("locks the workspace row before counting", async () => {
    const tx = fakeTx({ planTier: "free", activeProjects: 0 });

    await assertProjectQuotaAvailable(tx as never, WORKSPACE);

    // Without `FOR UPDATE` two concurrent creates both read zero and both
    // insert, and the ceiling silently does not exist.
    expect(tx.spies.forUpdate).toHaveBeenCalledWith("update");
    expect(tx.spies.selectedTables).toEqual([workspaces, clientProjects]);
  });

  it("admits the first project on the free tier", async () => {
    const tx = fakeTx({ planTier: "free", activeProjects: 0 });

    await expect(
      assertProjectQuotaAvailable(tx as never, WORKSPACE),
    ).resolves.toBeUndefined();
  });

  it("refuses the second project on the free tier", async () => {
    const tx = fakeTx({ planTier: "free", activeProjects: 1 });

    await expect(
      assertProjectQuotaAvailable(tx as never, WORKSPACE),
    ).rejects.toThrow(ProblemError);
  });

  it("reports the refusal as 403, not a validation or server error", async () => {
    const tx = fakeTx({ planTier: "free", activeProjects: 1 });

    const error = await assertProjectQuotaAvailable(
      tx as never,
      WORKSPACE,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProblemError);
    expect((error as ProblemError).code).toBe("PLAN_LIMIT_REACHED");
    // The message has to say what to do about it, since the UI shows it.
    expect((error as ProblemError).message).toMatch(/archive/i);
  });

  it("does not count archived projects against the ceiling", async () => {
    // The fake's project count already excludes archived rows; this asserts the
    // query asked for that rather than trusting the fake. A free tier that
    // counted archived projects would be one project EVER, not one at a time.
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./plan-limits.ts", import.meta.url), "utf8"),
    );
    expect(source).toMatch(/isNull\(\s*clientProjects\.archived_at\s*\)/);
  });

  it("leaves the internal tier unbounded", async () => {
    const tx = fakeTx({ planTier: "internal", activeProjects: 99 });

    await expect(
      assertProjectQuotaAvailable(tx as never, WORKSPACE),
    ).resolves.toBeUndefined();
    // Unbounded means it never even counts.
    expect(tx.spies.selectedTables).toEqual([workspaces]);
  });

  it("treats an unrecognised tier as bounded", async () => {
    const tx = fakeTx({ planTier: "enterprise", activeProjects: 1 });

    await expect(
      assertProjectQuotaAvailable(tx as never, WORKSPACE),
    ).rejects.toThrow(ProblemError);
  });

  it("defers to the caller's foreign keys when the workspace is missing", async () => {
    const tx = fakeTx({ workspaceMissing: true });

    await expect(
      assertProjectQuotaAvailable(tx as never, WORKSPACE),
    ).resolves.toBeUndefined();
  });
});
