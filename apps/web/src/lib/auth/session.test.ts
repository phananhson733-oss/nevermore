import { afterEach, describe, expect, it, vi } from "vitest";
import { operatorProfiles, workspaces } from "@sf/db/schema";
import { DEV_USER_ID } from "./dev.ts";

interface ExistingOperatorRow {
  readonly workspaceId: string;
}

function fakeDb(
  existing: readonly ExistingOperatorRow[],
  options: {
    readonly executeTransaction?: boolean;
    /** A workspace already present when the dev bootstrap takes its lock. */
    readonly transactionWorkspaceId?: string;
    /** A profile that appeared while a signup waited for its per-user lock. */
    readonly transactionProfileWorkspaceId?: string;
  } = {},
) {
  const workspaceId = "00000000-0000-4000-8000-000000000099";
  const limit = vi.fn(async () => [...existing]);
  const where = vi.fn(() => ({ limit }));
  // Records the table on the TOP-LEVEL handle too, not just inside the
  // transaction. Scoping the isolation assertion to `tx` alone let the same
  // regression pass simply by moving the join above `db.transaction(...)`.
  const selectedTables: unknown[] = [];
  const from = vi.fn((table: unknown) => {
    selectedTables.push(table);
    return { where };
  });
  const select = vi.fn(() => ({ from }));

  // Each insert mints a distinct id, so a test can tell "provisioned a new
  // workspace" apart from "handed back the same one twice".
  let minted = 0;
  const workspaceValues = vi.fn(() => ({
    returning: async () => {
      minted += 1;
      return [{ id: `${workspaceId.slice(0, -1)}${minted}` }];
    },
  }));

  // Signup awaits `.values(...)` directly; the dev bootstrap chains
  // `.onConflictDoNothing()` first. The return value has to serve both.
  const profileValues = vi.fn(() =>
    Object.assign(Promise.resolve(undefined), {
      onConflictDoNothing: async () => undefined,
    }),
  );
  const insert = vi.fn((table: unknown) =>
    table === workspaces
      ? { values: workspaceValues }
      : table === operatorProfiles
        ? { values: profileValues }
        : undefined,
  );

  const txSelectedTables: unknown[] = [];
  const tx = {
    execute: vi.fn(async () => undefined),
    select: vi.fn(() => ({
      from: (table: unknown) => {
        txSelectedTables.push(table);
        return {
          // dev bootstrap: "is there already a singleton workspace?"
          limit: async () =>
            options.transactionWorkspaceId
              ? [{ id: options.transactionWorkspaceId }]
              : [],
          // signup: "did another request provision this user first?"
          where: () => ({
            limit: async () =>
              options.transactionProfileWorkspaceId
                ? [{ workspaceId: options.transactionProfileWorkspaceId }]
                : [],
          }),
        };
      },
    })),
    insert,
  };
  const transaction = vi.fn(
    async (callback: (transaction: typeof tx) => Promise<unknown>) =>
      options.executeTransaction
        ? callback(tx)
        : { userId: DEV_USER_ID, workspaceId },
  );
  return {
    select,
    transaction,
    transactionSpies: {
      tx,
      workspaceValues,
      profileValues,
      txSelectedTables,
      selectedTables,
    },
  };
}

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

const { getOperatorContext } = await import("./session.ts");

afterEach(() => {
  mocks.getDb.mockReset();
  mocks.createSupabaseServerClient.mockReset();
  vi.unstubAllEnvs();
});

function authenticatedAs(userId: string): void {
  mocks.createSupabaseServerClient.mockResolvedValue({
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: userId,
            email: "operator@example.test",
            user_metadata: { full_name: "Operator" },
          },
        },
      }),
    },
  });
}

describe("getOperatorContext provisioning boundary", () => {
  it("returns null for an unauthenticated request without touching the database", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
    });

    await expect(getOperatorContext()).resolves.toBeNull();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("provisions a first-time production account its own new workspace", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SF_DEV_AUTH", "false");
    const db = fakeDb([], { executeTransaction: true });
    mocks.getDb.mockReturnValue({ db });
    const userId = "00000000-0000-4000-8000-000000000010";
    authenticatedAs(userId);

    await expect(getOperatorContext()).resolves.toEqual({
      userId,
      workspaceId: "00000000-0000-4000-8000-000000000091",
    });
    expect(db.transactionSpies.workspaceValues).toHaveBeenCalledWith({
      name: "Operator",
      plan_tier: "free",
    });
    expect(db.transactionSpies.profileValues).toHaveBeenCalledWith({
      user_id: userId,
      workspace_id: "00000000-0000-4000-8000-000000000091",
      display_name: "Operator",
    });
  });

  /**
   * The isolation invariant, stated directly.
   *
   * Isolation is enforced by application-level `workspace_id` scoping with no
   * RLS underneath, so a signup that JOINED an existing workspace instead of
   * creating one would hand the new account a full read of another customer's
   * projects. The dev bootstrap does exactly that join (`select … from
   * workspaces limit 1`) because local dev is a single-workspace world, and the
   * two functions sit next to each other looking alike. This test fails if
   * signup ever grows that shape.
   */
  it("never selects an existing workspace when provisioning a signup", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SF_DEV_AUTH", "false");
    const db = fakeDb([], { executeTransaction: true });
    mocks.getDb.mockReturnValue({ db });
    authenticatedAs("00000000-0000-4000-8000-000000000013");

    const context = await getOperatorContext();

    // Asserted across BOTH handles. Scoping this to the transaction alone made
    // the test pass for a join written just above `db.transaction(...)` —
    // verified by mutation — which is the same data leak one line earlier.
    const everySelect = [
      ...db.transactionSpies.selectedTables,
      ...db.transactionSpies.txSelectedTables,
    ];
    expect(everySelect).not.toContain(workspaces);
    expect(db.transactionSpies.txSelectedTables).toContain(operatorProfiles);

    // And the id handed back is the one THIS call minted, not one it found.
    expect(db.transactionSpies.workspaceValues).toHaveBeenCalledTimes(1);
    expect(context?.workspaceId).toBe("00000000-0000-4000-8000-000000000091");
  });

  it("gives two different first-time accounts two different workspaces", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SF_DEV_AUTH", "false");
    const db = fakeDb([], { executeTransaction: true });
    mocks.getDb.mockReturnValue({ db });

    authenticatedAs("00000000-0000-4000-8000-000000000014");
    const first = await getOperatorContext();
    authenticatedAs("00000000-0000-4000-8000-000000000015");
    const second = await getOperatorContext();

    expect(first?.workspaceId).toBeDefined();
    expect(second?.workspaceId).toBeDefined();
    expect(first?.workspaceId).not.toBe(second?.workspaceId);
  });

  it("names the workspace from the provider profile, not the email address", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const db = fakeDb([], { executeTransaction: true });
    mocks.getDb.mockReturnValue({ db });
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: {
        getUser: async () => ({
          data: {
            user: {
              id: "00000000-0000-4000-8000-000000000016",
              email: "ada@example.test",
              user_metadata: { full_name: "Ada Lovelace" },
            },
          },
        }),
      },
    });

    await getOperatorContext();

    expect(db.transactionSpies.workspaceValues).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Ada Lovelace" }),
    );
  });

  it("falls back to the email local-part, never the full address", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const db = fakeDb([], { executeTransaction: true });
    mocks.getDb.mockReturnValue({ db });
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: {
        getUser: async () => ({
          data: {
            user: {
              id: "00000000-0000-4000-8000-000000000017",
              email: "ada@example.test",
              user_metadata: {},
            },
          },
        }),
      },
    });

    await getOperatorContext();

    expect(db.transactionSpies.workspaceValues).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ada" }),
    );
  });

  it("returns the winner's workspace when a signup loses its per-user race", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const raced = "00000000-0000-4000-8000-000000000018";
    const db = fakeDb([], {
      executeTransaction: true,
      transactionProfileWorkspaceId: raced,
    });
    mocks.getDb.mockReturnValue({ db });
    const userId = "00000000-0000-4000-8000-000000000019";
    authenticatedAs(userId);

    await expect(getOperatorContext()).resolves.toEqual({
      userId,
      workspaceId: raced,
    });
    // The loser must not leave an orphaned workspace behind.
    expect(db.transactionSpies.workspaceValues).not.toHaveBeenCalled();
  });

  it("restores invite-only admission when SF_SIGNUP_MODE=invite", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SF_SIGNUP_MODE", "invite");
    const db = fakeDb([]);
    mocks.getDb.mockReturnValue({ db });
    authenticatedAs("00000000-0000-4000-8000-000000000020");

    await expect(getOperatorContext()).resolves.toBeNull();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("resolves an authenticated production user with an existing operator profile", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const userId = "00000000-0000-4000-8000-000000000011";
    const workspaceId = "00000000-0000-4000-8000-000000000012";
    const db = fakeDb([{ workspaceId }]);
    mocks.getDb.mockReturnValue({ db });
    authenticatedAs(userId);

    await expect(getOperatorContext()).resolves.toEqual({
      userId,
      workspaceId,
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("keeps explicit loopback development auth as the only automatic bootstrap path", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
    vi.stubEnv("SF_DEV_AUTH", "true");
    const db = fakeDb([], { executeTransaction: true });
    mocks.getDb.mockReturnValue({ db });

    await expect(getOperatorContext()).resolves.toEqual({
      userId: DEV_USER_ID,
      workspaceId: "00000000-0000-4000-8000-000000000091",
    });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.transactionSpies.tx.execute).toHaveBeenCalledTimes(1);
    expect(db.transactionSpies.workspaceValues).toHaveBeenCalledWith({
      name: "GenGrowth",
      // Internal, so the one-project free ceiling does not block local work.
      plan_tier: "internal",
    });
    expect(db.transactionSpies.profileValues).toHaveBeenCalledWith({
      user_id: DEV_USER_ID,
      workspace_id: "00000000-0000-4000-8000-000000000091",
      display_name: "Local Dev Operator",
    });
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("reuses an existing dev operator without running bootstrap", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
    vi.stubEnv("SF_DEV_AUTH", "true");
    const workspaceId = "00000000-0000-4000-8000-000000000098";
    const db = fakeDb([{ workspaceId }]);
    mocks.getDb.mockReturnValue({ db });

    await expect(getOperatorContext()).resolves.toEqual({
      userId: DEV_USER_ID,
      workspaceId,
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("reuses a singleton workspace that appears while dev bootstrap waits for its lock", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_ORIGIN", "http://[::1]:3000");
    vi.stubEnv("SF_DEV_AUTH", "true");
    const workspaceId = "00000000-0000-4000-8000-000000000097";
    const db = fakeDb([], {
      executeTransaction: true,
      transactionWorkspaceId: workspaceId,
    });
    mocks.getDb.mockReturnValue({ db });

    await expect(getOperatorContext()).resolves.toEqual({
      userId: DEV_USER_ID,
      workspaceId,
    });
    expect(db.transactionSpies.workspaceValues).not.toHaveBeenCalled();
    expect(db.transactionSpies.profileValues).toHaveBeenCalledWith({
      user_id: DEV_USER_ID,
      workspace_id: workspaceId,
      display_name: "Local Dev Operator",
    });
  });
});
