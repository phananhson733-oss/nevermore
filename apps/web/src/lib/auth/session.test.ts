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
    readonly transactionWorkspaceId?: string;
  } = {},
) {
  const workspaceId = "00000000-0000-4000-8000-000000000099";
  const limit = vi.fn(async () => [...existing]);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const workspaceValues = vi.fn(() => ({
    returning: async () => [{ id: workspaceId }],
  }));
  const profileValues = vi.fn(() => ({
    onConflictDoNothing: async () => undefined,
  }));
  const insert = vi.fn((table: unknown) =>
    table === workspaces
      ? { values: workspaceValues }
      : table === operatorProfiles
        ? { values: profileValues }
        : undefined,
  );
  const tx = {
    execute: vi.fn(async () => undefined),
    select: vi.fn(() => ({
      from: () => ({
        limit: async () =>
          options.transactionWorkspaceId
            ? [{ id: options.transactionWorkspaceId }]
            : [],
      }),
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
    transactionSpies: { tx, workspaceValues, profileValues },
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

  it("fails closed for an authenticated production user without an operator profile", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SF_DEV_AUTH", "false");
    const db = fakeDb([]);
    mocks.getDb.mockReturnValue({ db });
    authenticatedAs("00000000-0000-4000-8000-000000000010");

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

    await expect(getOperatorContext()).resolves.toEqual({ userId, workspaceId });
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
      workspaceId: "00000000-0000-4000-8000-000000000099",
    });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.transactionSpies.tx.execute).toHaveBeenCalledTimes(1);
    expect(db.transactionSpies.workspaceValues).toHaveBeenCalledWith({
      name: "SignalFrame",
    });
    expect(db.transactionSpies.profileValues).toHaveBeenCalledWith({
      user_id: DEV_USER_ID,
      workspace_id: "00000000-0000-4000-8000-000000000099",
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
