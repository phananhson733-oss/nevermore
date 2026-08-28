import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminSupabaseClient: vi.fn(),
}));

vi.mock("../supabase/admin.ts", () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}));

const { DEFAULT_WEBSITE_STORE_DEPENDENCIES } = await import("./store.ts");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WEBSITE_ID = "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6";
const SNAPSHOT_ID = "a53f4ddb-7cd6-42da-af53-88cc68b41987";

interface QueryResult {
  readonly data: unknown;
  readonly error: null;
}

interface FakeBuilder extends Promise<QueryResult> {
  readonly select: ReturnType<typeof vi.fn>;
  readonly eq: ReturnType<typeof vi.fn>;
  readonly in: ReturnType<typeof vi.fn>;
  readonly order: ReturnType<typeof vi.fn>;
  readonly maybeSingle: ReturnType<typeof vi.fn>;
}

function query(data: unknown): FakeBuilder {
  const result: QueryResult = { data, error: null };
  const builder = Promise.resolve(result) as FakeBuilder;
  Object.assign(builder, {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
  });
  return builder;
}

function clientFor(
  tables: Readonly<Record<string, FakeBuilder>>,
): { readonly from: ReturnType<typeof vi.fn>; readonly rpc: ReturnType<typeof vi.fn> } {
  return {
    from: vi.fn((table: string) => tables[table]),
    rpc: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("default account website Supabase adapter", () => {
  it("scopes every list query to the user and fetches only current snapshots", async () => {
    const websites = query([
      {
        id: WEBSITE_ID,
        current_confirmed_snapshot_id: SNAPSHOT_ID,
      },
    ]);
    const drafts = query([]);
    const snapshots = query([]);
    mocks.createAdminSupabaseClient.mockReturnValue(
      clientFor({
        marketing_websites: websites,
        marketing_website_profile_drafts: drafts,
        marketing_website_profile_snapshots: snapshots,
      }),
    );

    await expect(
      DEFAULT_WEBSITE_STORE_DEPENDENCIES.readList(USER_ID),
    ).resolves.toMatchObject({ kind: "ok" });

    expect(websites.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(drafts.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(drafts.in).toHaveBeenCalledWith("website_id", [WEBSITE_ID]);
    expect(snapshots.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(snapshots.in).toHaveBeenCalledWith("id", [SNAPSHOT_ID]);
  });

  it("scopes website, draft, and snapshot detail reads to user and website", async () => {
    const website = query({
      id: WEBSITE_ID,
      current_confirmed_snapshot_id: SNAPSHOT_ID,
    });
    const draft = query(null);
    const snapshot = query({ id: SNAPSHOT_ID });
    mocks.createAdminSupabaseClient.mockReturnValue(
      clientFor({
        marketing_websites: website,
        marketing_website_profile_drafts: draft,
        marketing_website_profile_snapshots: snapshot,
      }),
    );

    await expect(
      DEFAULT_WEBSITE_STORE_DEPENDENCIES.readDetails(USER_ID, WEBSITE_ID),
    ).resolves.toMatchObject({ kind: "ok" });

    expect(website.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(website.eq).toHaveBeenCalledWith("id", WEBSITE_ID);
    expect(draft.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(draft.eq).toHaveBeenCalledWith("website_id", WEBSITE_ID);
    expect(snapshot.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(snapshot.eq).toHaveBeenCalledWith("website_id", WEBSITE_ID);
    expect(snapshot.eq).toHaveBeenCalledWith("id", SNAPSHOT_ID);
  });

  it("scopes an exact snapshot read to user, website, and snapshot IDs", async () => {
    const snapshot = query({ id: SNAPSHOT_ID });
    mocks.createAdminSupabaseClient.mockReturnValue(
      clientFor({ marketing_website_profile_snapshots: snapshot }),
    );

    await expect(
      DEFAULT_WEBSITE_STORE_DEPENDENCIES.readSnapshot(
        USER_ID,
        WEBSITE_ID,
        SNAPSHOT_ID,
      ),
    ).resolves.toMatchObject({ kind: "ok" });

    expect(snapshot.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(snapshot.eq).toHaveBeenCalledWith("website_id", WEBSITE_ID);
    expect(snapshot.eq).toHaveBeenCalledWith("id", SNAPSHOT_ID);
    expect(snapshot.maybeSingle).toHaveBeenCalledTimes(1);
  });
});
