import { describe, expect, it, vi } from "vitest";

import {
  addAccountWebsite,
  confirmAccountWebsiteProfile,
  findAccountWebsiteByUrl,
  listAccountWebsites,
  readAccountWebsite,
  resolveAccountWebsiteProfileReference,
  saveAccountWebsiteDraft,
  type WebsiteStoreDependencies,
} from "./store.ts";
import {
  MARKETING_WEBSITE_PROFILE_VERSION,
  WEBSITE_PROFILE_REFERENCE_VERSION,
  canonicalProfileJson,
  emptyMarketingWebsiteProfile,
  profileSha256,
} from "./contracts.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WEBSITE_ID = "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6";
const SNAPSHOT_ID = "a53f4ddb-7cd6-42da-af53-88cc68b41987";
const OLDER_SNAPSHOT_ID = "d8746f5d-493c-4b04-a9ac-df07a59b3ca8";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_WEBSITE_ID = "b4f53f12-8090-4c5f-8ddb-7d9587758d7a";
const NOW = "2026-08-27T08:00:00.000Z";

interface TestBundle {
  readonly websites: Array<{
    id: string;
    user_id: string;
    canonical_site_key: string;
    origin: string;
    submitted_url: string;
    host: string;
    display_name: string;
    is_primary: boolean;
    current_confirmed_snapshot_id: string | null;
    created_at: string;
    updated_at: string;
  }>;
  drafts: Array<{
    website_id: string;
    user_id: string;
    draft_version: number;
    schema_version: string;
    profile: ReturnType<typeof profile>;
    content_hash: string;
    updated_at: string;
  }>;
  snapshots: Array<{
    id: string;
    website_id: string;
    user_id: string;
    revision: number;
    schema_version: string;
    profile: ReturnType<typeof profile>;
    content_hash: string;
    source_draft_version: number;
    confirmed_at: string;
  }>;
}

function profile() {
  return {
    ...emptyMarketingWebsiteProfile(),
    productName: "Example",
    oneLinePositioning: "Example positioning",
    valueProposition: "Example value",
    primaryIcp: "Example ICP",
    locale: "en-US",
  };
}

async function profileReference(
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    schemaVersion: WEBSITE_PROFILE_REFERENCE_VERSION,
    websiteId: WEBSITE_ID,
    snapshotId: OLDER_SNAPSHOT_ID,
    snapshotRevision: 1,
    profileSchemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
    profileHash: await profileSha256({
      ...profile(),
      productName: "Original Example",
    }),
    ...overrides,
  };
}

async function olderSnapshotRow() {
  const snapshotProfile = {
    ...profile(),
    productName: "Original Example",
  };
  return {
    id: OLDER_SNAPSHOT_ID,
    website_id: WEBSITE_ID,
    user_id: USER_ID,
    revision: 1,
    schema_version: MARKETING_WEBSITE_PROFILE_VERSION,
    profile: snapshotProfile,
    content_hash: await profileSha256(snapshotProfile),
    source_draft_version: 1,
    confirmed_at: "2026-08-26T08:00:00.000Z",
  };
}

async function bundle(): Promise<TestBundle> {
  const hash = await profileSha256(profile());
  return {
    websites: [
      {
        id: WEBSITE_ID,
        user_id: USER_ID,
        canonical_site_key: "example.com",
        origin: "https://example.com",
        submitted_url: "https://example.com/",
        host: "example.com",
        display_name: "Example",
        is_primary: true,
        current_confirmed_snapshot_id: SNAPSHOT_ID,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    drafts: [
      {
        website_id: WEBSITE_ID,
        user_id: USER_ID,
        draft_version: 2,
        schema_version: MARKETING_WEBSITE_PROFILE_VERSION,
        profile: profile(),
        content_hash: hash,
        updated_at: NOW,
      },
    ],
    snapshots: [
      {
        id: SNAPSHOT_ID,
        website_id: WEBSITE_ID,
        user_id: USER_ID,
        revision: 1,
        schema_version: MARKETING_WEBSITE_PROFILE_VERSION,
        profile: profile(),
        content_hash: hash,
        source_draft_version: 2,
        confirmed_at: NOW,
      },
    ],
  };
}

function dependencies(
  overrides: Partial<WebsiteStoreDependencies> = {},
): WebsiteStoreDependencies {
  return {
    readList: vi.fn(async () => ({ kind: "ok" as const, data: await bundle() })),
    readDetails: vi.fn(async () => ({
      kind: "ok" as const,
      data: await bundle(),
    })),
    readSnapshot: vi.fn(async () => ({
      kind: "ok" as const,
      data: await olderSnapshotRow(),
    })),
    callRpc: vi.fn(async () => ({
      kind: "ok" as const,
      data: [{ outcome: "ok", website_id: WEBSITE_ID }],
    })),
    ...overrides,
  };
}

describe("account website store reads", () => {
  it("maps one user-scoped list and exact confirmed details", async () => {
    const deps = dependencies();
    const list = await listAccountWebsites(USER_ID, deps);
    expect(list).toMatchObject({
      kind: "ok",
      value: [
        {
          websiteId: WEBSITE_ID,
          isPrimary: true,
          profileState: "confirmed",
          confirmedSnapshotRevision: 1,
        },
      ],
    });
    expect(deps.readList).toHaveBeenCalledWith(USER_ID);

    const details = await readAccountWebsite(USER_ID, WEBSITE_ID, deps);
    expect(details).toMatchObject({
      kind: "ok",
      value: {
        websiteId: WEBSITE_ID,
        draft: { draftVersion: 2 },
        currentConfirmedSnapshot: { snapshotId: SNAPSHOT_ID },
      },
    });
    expect(deps.readDetails).toHaveBeenCalledWith(USER_ID, WEBSITE_ID);
  });

  it("fails closed instead of smoothing a malformed private row", async () => {
    const malformed = await bundle();
    malformed.websites[0] = { ...malformed.websites[0], is_primary: "yes" } as never;
    const result = await listAccountWebsites(
      USER_ID,
      dependencies({
        readList: vi.fn(async () => ({
          kind: "ok" as const,
          data: malformed,
        })),
      }),
    );
    expect(result).toMatchObject({ kind: "unavailable" });
  });

  it("fails closed on malformed read UUID, hash, timestamp, or profile data", async () => {
    const invalidUuid = await bundle();
    invalidUuid.websites[0] = {
      ...invalidUuid.websites[0],
      id: "not-a-uuid",
    };
    const invalidHash = await bundle();
    invalidHash.drafts[0] = {
      ...invalidHash.drafts[0],
      content_hash: "not-a-hash",
    };
    const invalidTimestamp = await bundle();
    invalidTimestamp.websites[0] = {
      ...invalidTimestamp.websites[0],
      updated_at: "yesterday",
    };
    const invalidProfile = await bundle();
    invalidProfile.drafts[0] = {
      ...invalidProfile.drafts[0],
      profile: { unexpected: true } as never,
    };

    for (const data of [
      invalidUuid,
      invalidHash,
      invalidTimestamp,
      invalidProfile,
    ]) {
      const result = await readAccountWebsite(
        USER_ID,
        WEBSITE_ID,
        dependencies({
          readDetails: vi.fn(async () => ({
            kind: "ok" as const,
            data,
          })),
        }),
      );
      expect(result).toMatchObject({ kind: "unavailable" });
    }
  });

  it("fails closed on a draft with the wrong owner or schema version", async () => {
    const malformedOwner = await bundle();
    malformedOwner.drafts[0] = {
      ...malformedOwner.drafts[0],
      user_id: "22222222-2222-4222-8222-222222222222",
    };
    await expect(
      readAccountWebsite(
        USER_ID,
        WEBSITE_ID,
        dependencies({
          readDetails: vi.fn(async () => ({
            kind: "ok" as const,
            data: malformedOwner,
          })),
        }),
      ),
    ).resolves.toMatchObject({ kind: "unavailable" });

    const malformedVersion = await bundle();
    malformedVersion.drafts[0] = {
      ...malformedVersion.drafts[0],
      schema_version: "marketing-website-profile.v0",
    };
    await expect(
      readAccountWebsite(
        USER_ID,
        WEBSITE_ID,
        dependencies({
          readDetails: vi.fn(async () => ({
            kind: "ok" as const,
            data: malformedVersion,
          })),
        }),
      ),
    ).resolves.toMatchObject({ kind: "unavailable" });
  });

  it("fails closed when a detail transport returns more than one website", async () => {
    const malformed = await bundle();
    malformed.websites.push({
      ...malformed.websites[0],
      id: "b4f53f12-8090-4c5f-8ddb-7d9587758d7a",
      canonical_site_key: "second.example",
      origin: "https://second.example",
      submitted_url: "https://second.example/",
      host: "second.example",
      current_confirmed_snapshot_id: null,
    });
    const result = await readAccountWebsite(
      USER_ID,
      WEBSITE_ID,
      dependencies({
        readDetails: vi.fn(async () => ({
          kind: "ok" as const,
          data: malformed,
        })),
      }),
    );
    expect(result).toMatchObject({ kind: "unavailable" });
  });

  it("reads a non-primary website detail without treating it as a broken list", async () => {
    const data = await bundle();
    data.websites[0] = { ...data.websites[0], is_primary: false };
    const result = await readAccountWebsite(
      USER_ID,
      WEBSITE_ID,
      dependencies({
        readDetails: vi.fn(async () => ({
          kind: "ok" as const,
          data,
        })),
      }),
    );
    expect(result).toMatchObject({
      kind: "ok",
      value: { websiteId: WEBSITE_ID, isPrimary: false },
    });
  });

  it("matches a saved website by normalized URL without using another host", async () => {
    expect(
      await findAccountWebsiteByUrl(
        USER_ID,
        "https://www.example.com/pricing?from=tool",
        dependencies(),
      ),
    ).toMatchObject({
      kind: "ok",
      value: {
        website: { websiteId: WEBSITE_ID },
        reference: {
          websiteId: WEBSITE_ID,
          snapshotId: SNAPSHOT_ID,
          snapshotRevision: 1,
        },
        profile: { productName: "Example" },
      },
    });
    expect(
      await findAccountWebsiteByUrl(
        USER_ID,
        "https://other.example/",
        dependencies(),
      ),
    ).toMatchObject({ kind: "missing" });
  });

  it("keeps an existing site without a confirmed snapshot unavailable to consumers", async () => {
    const data = await bundle();
    data.websites[0] = {
      ...data.websites[0],
      current_confirmed_snapshot_id: null as string | null,
    };
    data.snapshots = [];
    const result = await findAccountWebsiteByUrl(
      USER_ID,
      "example.com",
      dependencies({
        readList: vi.fn(async () => ({ kind: "ok" as const, data })),
        readDetails: vi.fn(async () => ({ kind: "ok" as const, data })),
      }),
    );
    expect(result).toEqual({ kind: "invalid", code: "profile_not_confirmed" });
  });

  it("resolves an exact older confirmed snapshot after re-reading the owned website", async () => {
    const current = await bundle();
    current.snapshots[0] = { ...current.snapshots[0], revision: 2 };
    const readDetails = vi.fn(async () => ({
      kind: "ok" as const,
      data: current,
    }));
    const readSnapshot = vi.fn(async () => ({
      kind: "ok" as const,
      data: await olderSnapshotRow(),
    }));
    const reference = await profileReference();

    const result = await resolveAccountWebsiteProfileReference(
      USER_ID,
      reference,
      dependencies({ readDetails, readSnapshot }),
    );

    expect(result).toEqual({
      kind: "ok",
      value: {
        website: expect.objectContaining({
          websiteId: WEBSITE_ID,
          confirmedSnapshotId: SNAPSHOT_ID,
          confirmedSnapshotRevision: 2,
        }),
        reference,
        profile: expect.objectContaining({ productName: "Original Example" }),
      },
    });
    expect(readDetails).toHaveBeenCalledWith(USER_ID, WEBSITE_ID);
    expect(readSnapshot).toHaveBeenCalledWith(
      USER_ID,
      WEBSITE_ID,
      OLDER_SNAPSHOT_ID,
    );
    expect(readDetails.mock.invocationCallOrder[0]).toBeLessThan(
      readSnapshot.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("rejects a malformed reference before any private read", async () => {
    const deps = dependencies();

    const result = await resolveAccountWebsiteProfileReference(
      USER_ID,
      { schemaVersion: "wrong" },
      deps,
    );

    expect(result).toEqual({ kind: "invalid", code: "invalid_reference" });
    expect(deps.readDetails).not.toHaveBeenCalled();
    expect(deps.readSnapshot).not.toHaveBeenCalled();
  });

  it("returns missing for another user's website without probing its snapshot", async () => {
    const hidden = await bundle();
    hidden.websites.splice(0);
    hidden.drafts = [];
    hidden.snapshots = [];
    const readSnapshot = vi.fn(async () => ({
      kind: "ok" as const,
      data: await olderSnapshotRow(),
    }));

    const result = await resolveAccountWebsiteProfileReference(
      OTHER_USER_ID,
      await profileReference(),
      dependencies({
        readDetails: vi.fn(async () => ({ kind: "ok" as const, data: hidden })),
        readSnapshot,
      }),
    );

    expect(result).toEqual({ kind: "missing" });
    expect(readSnapshot).not.toHaveBeenCalled();
  });

  it("fails closed when the owned website read returns a different website ID", async () => {
    const malformed = await bundle();
    malformed.websites[0] = {
      ...malformed.websites[0],
      id: OTHER_WEBSITE_ID,
    };
    malformed.drafts[0] = {
      ...malformed.drafts[0],
      website_id: OTHER_WEBSITE_ID,
    };
    malformed.snapshots[0] = {
      ...malformed.snapshots[0],
      website_id: OTHER_WEBSITE_ID,
    };
    const deps = dependencies({
      readDetails: vi.fn(async () => ({ kind: "ok" as const, data: malformed })),
    });

    const result = await resolveAccountWebsiteProfileReference(
      USER_ID,
      await profileReference(),
      deps,
    );

    expect(result).toEqual({
      kind: "unavailable",
      reason: "malformed_store_response",
    });
    expect(deps.readSnapshot).not.toHaveBeenCalled();
  });

  it("returns missing when the exact owned snapshot does not exist", async () => {
    const result = await resolveAccountWebsiteProfileReference(
      USER_ID,
      await profileReference(),
      dependencies({
        readSnapshot: vi.fn(async () => ({ kind: "ok" as const, data: null })),
      }),
    );

    expect(result).toEqual({ kind: "missing" });
  });

  it("fails closed when any exact snapshot identity disagrees", async () => {
    const reference = await profileReference();
    const valid = await olderSnapshotRow();
    const mismatches = [
      { ...valid, user_id: OTHER_USER_ID },
      { ...valid, website_id: OTHER_WEBSITE_ID },
      { ...valid, id: SNAPSHOT_ID },
      { ...valid, revision: 2 },
      { ...valid, schema_version: "marketing-website-profile.v0" },
      { ...valid, content_hash: "0".repeat(64) },
    ];

    for (const data of mismatches) {
      await expect(
        resolveAccountWebsiteProfileReference(
          USER_ID,
          reference,
          dependencies({
            readSnapshot: vi.fn(async () => ({ kind: "ok" as const, data })),
          }),
        ),
      ).resolves.toEqual({
        kind: "unavailable",
        reason: "malformed_store_response",
      });
    }
  });

  it("recomputes the snapshot SHA and never returns or logs malformed profile text", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const row = await olderSnapshotRow();
    const privateText = "PRIVATE MALFORMED PROFILE TEXT";

    const result = await resolveAccountWebsiteProfileReference(
      USER_ID,
      await profileReference(),
      dependencies({
        readSnapshot: vi.fn(async () => ({
          kind: "ok" as const,
          data: {
            ...row,
            profile: { ...row.profile, productName: privateText },
          },
        })),
      }),
    );

    expect(result).toEqual({
      kind: "unavailable",
      reason: "malformed_store_response",
    });
    expect(JSON.stringify(result)).not.toContain(privateText);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(privateText);
    errorSpy.mockRestore();
  });

  it("fails closed on a malformed exact snapshot transport row", async () => {
    const result = await resolveAccountWebsiteProfileReference(
      USER_ID,
      await profileReference(),
      dependencies({
        readSnapshot: vi.fn(async () => ({
          kind: "ok" as const,
          data: [{ profile: { productName: "PRIVATE ROW" } }],
        })),
      }),
    );

    expect(result).toEqual({
      kind: "unavailable",
      reason: "malformed_store_response",
    });
  });
});

describe("account website store writes", () => {
  it("accepts the migration's created outcome for a new website", async () => {
    const result = await addAccountWebsite(
      { userId: USER_ID, url: "example.com", displayName: null },
      dependencies({
        callRpc: vi.fn(async () => ({
          kind: "ok" as const,
          data: [{ outcome: "created", website_id: WEBSITE_ID }],
        })),
      }),
    );
    expect(result).toMatchObject({
      kind: "ok",
      value: { websiteId: WEBSITE_ID },
    });
  });

  it("returns a stable duplicate with its existing website", async () => {
    const deps = dependencies({
      callRpc: vi.fn(async () => ({
        kind: "ok" as const,
        data: [{ outcome: "duplicate", website_id: WEBSITE_ID }],
      })),
    });
    expect(
      await addAccountWebsite(
        {
          userId: USER_ID,
          url: "https://www.example.com/pricing?utm_source=account#hero",
          displayName: "Example",
        },
        deps,
      ),
    ).toMatchObject({ kind: "duplicate", website: { websiteId: WEBSITE_ID } });
    expect(deps.callRpc).toHaveBeenCalledWith("marketing_add_website", {
      p_user_id: USER_ID,
      p_submitted_url:
        "https://www.example.com/pricing?utm_source=account",
      p_origin: "https://example.com",
      p_host: "example.com",
      p_canonical_site_key: "example.com",
      p_display_name: "Example",
    });
  });

  it("fails closed on a malformed write result", async () => {
    const result = await addAccountWebsite(
      { userId: USER_ID, url: "example.com", displayName: null },
      dependencies({
        callRpc: vi.fn(async () => ({
          kind: "ok" as const,
          data: [{ outcome: "ok", website_id: "not-a-uuid" }],
        })),
      }),
    );
    expect(result).toEqual({
      kind: "unavailable",
      reason: "malformed_store_response",
    });
  });

  it("sends a canonical profile and matching SHA to the draft RPC", async () => {
    const deps = dependencies();
    const input = profile();
    const result = await saveAccountWebsiteDraft(
      {
        userId: USER_ID,
        websiteId: WEBSITE_ID,
        baseVersion: 2,
        profile: input,
      },
      deps,
    );
    expect(result).toMatchObject({ kind: "ok" });
    expect(deps.callRpc).toHaveBeenCalledWith(
      "marketing_save_website_profile_draft",
      {
        p_user_id: USER_ID,
        p_website_id: WEBSITE_ID,
        p_base_version: 2,
        p_schema_version: MARKETING_WEBSITE_PROFILE_VERSION,
        p_profile: input,
        p_canonical_profile: canonicalProfileJson(input),
        p_content_hash: await profileSha256(input),
      },
    );
  });

  it("returns current details on CAS conflict without logging profile text", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = dependencies({
      callRpc: vi.fn(async () => ({
        kind: "ok" as const,
        data: [{ outcome: "conflict", draft_version: 2 }],
      })),
    });
    const result = await saveAccountWebsiteDraft(
      {
        userId: USER_ID,
        websiteId: WEBSITE_ID,
        baseVersion: 1,
        profile: { ...profile(), productName: "PRIVATE PROFILE TEXT" },
      },
      deps,
    );
    expect(result).toMatchObject({
      kind: "conflict",
      current: { websiteId: WEBSITE_ID },
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("PRIVATE PROFILE TEXT");
    errorSpy.mockRestore();
  });

  it("fails closed on a malformed draft-save RPC response", async () => {
    const deps = dependencies({
      callRpc: vi.fn(async () => ({ kind: "ok" as const, data: [] })),
    });

    const result = await saveAccountWebsiteDraft(
      {
        userId: USER_ID,
        websiteId: WEBSITE_ID,
        baseVersion: 2,
        profile: profile(),
      },
      deps,
    );

    expect(result).toEqual({
      kind: "unavailable",
      reason: "malformed_store_response",
    });
    expect(deps.readDetails).not.toHaveBeenCalled();
  });

  it("guards Save Back with the exact referenced snapshot atomically", async () => {
    const expectedReference = {
      schemaVersion: WEBSITE_PROFILE_REFERENCE_VERSION,
      websiteId: WEBSITE_ID,
      snapshotId: SNAPSHOT_ID,
      snapshotRevision: 1,
      profileSchemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
      profileHash: await profileSha256(profile()),
    };
    const deps = dependencies({
      callRpc: vi.fn(async () => ({
        kind: "ok" as const,
        data: [{ outcome: "snapshot_conflict", draft_version: 2 }],
      })),
    });

    const result = await saveAccountWebsiteDraft(
      {
        userId: USER_ID,
        websiteId: WEBSITE_ID,
        baseVersion: 2,
        profile: profile(),
        expectedReference,
      },
      deps,
    );

    expect(result).toMatchObject({
      kind: "conflict",
      current: { websiteId: WEBSITE_ID },
    });
    expect(deps.callRpc).toHaveBeenCalledWith(
      "marketing_save_website_profile_draft_from_snapshot",
      expect.objectContaining({
        p_expected_snapshot_id: SNAPSHOT_ID,
        p_expected_snapshot_hash: expectedReference.profileHash,
      }),
    );
  });

  it("classifies a malformed snapshot guard separately from the profile", async () => {
    const deps = dependencies();

    const result = await saveAccountWebsiteDraft(
      {
        userId: USER_ID,
        websiteId: WEBSITE_ID,
        baseVersion: 2,
        profile: profile(),
        expectedReference: { schemaVersion: "wrong" } as never,
      },
      deps,
    );

    expect(result).toEqual({ kind: "invalid", code: "invalid_reference" });
    expect(deps.callRpc).not.toHaveBeenCalled();
  });

  it("confirms only a ready current draft and returns its exact snapshot", async () => {
    const deps = dependencies();
    expect(
      await confirmAccountWebsiteProfile(
        { userId: USER_ID, websiteId: WEBSITE_ID, baseVersion: 2 },
        deps,
      ),
    ).toMatchObject({
      kind: "ok",
      value: {
        currentConfirmedSnapshot: { snapshotId: SNAPSHOT_ID },
      },
    });
    expect(deps.callRpc).toHaveBeenCalledWith(
      "marketing_confirm_website_profile",
      {
        p_user_id: USER_ID,
        p_website_id: WEBSITE_ID,
        p_base_version: 2,
      },
    );
  });

  it("returns the exact missing fields for an incomplete confirmation", async () => {
    const data = await bundle();
    const incomplete = { ...profile(), valueProposition: "" };
    data.drafts[0] = {
      ...data.drafts[0],
      profile: incomplete,
      content_hash: await profileSha256(incomplete),
    };
    const deps = dependencies({
      readDetails: vi.fn(async () => ({ kind: "ok" as const, data })),
    });

    const result = await confirmAccountWebsiteProfile(
      { userId: USER_ID, websiteId: WEBSITE_ID, baseVersion: 2 },
      deps,
    );

    expect(result).toEqual({
      kind: "invalid",
      code: "profile_incomplete",
      fields: ["valueProposition"],
    });
    expect(deps.callRpc).not.toHaveBeenCalled();
  });

  it("fails closed on a malformed confirmation RPC response", async () => {
    const deps = dependencies({
      callRpc: vi.fn(async () => ({ kind: "ok" as const, data: [] })),
    });

    const result = await confirmAccountWebsiteProfile(
      { userId: USER_ID, websiteId: WEBSITE_ID, baseVersion: 2 },
      deps,
    );

    expect(result).toEqual({
      kind: "unavailable",
      reason: "malformed_store_response",
    });
  });

  it("re-reads the current draft after a confirmation CAS conflict", async () => {
    const stale = await bundle();
    const current = await bundle();
    current.drafts[0] = {
      ...current.drafts[0],
      draft_version: 3,
      profile: { ...profile(), productName: "Current" },
      content_hash: await profileSha256({
        ...profile(),
        productName: "Current",
      }),
    };
    const readDetails = vi
      .fn()
      .mockResolvedValueOnce({ kind: "ok" as const, data: stale })
      .mockResolvedValueOnce({ kind: "ok" as const, data: current });
    const deps = dependencies({
      readDetails,
      callRpc: vi.fn(async () => ({
        kind: "ok" as const,
        data: [{ outcome: "conflict", draft_version: 3 }],
      })),
    });

    const result = await confirmAccountWebsiteProfile(
      { userId: USER_ID, websiteId: WEBSITE_ID, baseVersion: 2 },
      deps,
    );

    expect(result).toMatchObject({
      kind: "conflict",
      current: { draft: { draftVersion: 3 } },
    });
    expect(readDetails).toHaveBeenCalledTimes(2);
  });
});
