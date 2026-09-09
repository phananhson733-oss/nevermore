// @input -- only a named loopback disposable Marketing database and synthetic values
// @output -- V3 draft saving, review locking, optional question sets and idempotent publishing
// @pos -- real SQL tests, never a provider or production invocation

/**
 * Every payload, context and candidate below is produced by the shipped v3
 * builders, and that is the point of the file's shape.
 *
 * Until 2026-09-07 this suite hand-wrote its own v3 JSON: `citation_matched`
 * for an enum whose only value is `cited_and_literals_match`, `entity/definition/w25`
 * for an item key that is a sha256 digest, bare arrays for modules that are
 * `{status, value}`, and a `note` field on a review decision that no contract
 * has. The draft CHECK asks only "is this an object" and "does it have these
 * three keys" (design deviation #16: the database polices size, version and
 * question-set pairing; the TypeScript contracts are the only shape authority),
 * so all of it passed -- and what the suite proved was that the database
 * accepts a payload the product cannot produce. That is the failure recorded as
 * [[verify-the-thing-you-ship]], and design deviation #15.
 *
 * So: `payloadV3` derives from `completePayloadV3()`, reviews are built with
 * the real state machine, and candidates go through
 * `createGeoPreparedCandidateV3`. Where a test needs a malformed input -- most
 * of them do, because they exist to prove a guard refuses something -- the
 * malformed value is a *mutation of a real one*, so the mutation is the only
 * difference between the accepted and the refused case. A blob that is wrong in
 * six ways proves nothing about which of the six a guard caught.
 *
 * The publish-path counterpart is `kb-v3-publish.integration.test.ts`, which
 * checks the same RPC against the TypeScript parsers a reader uses. This file
 * stays on the database's own rules: constraints, budgets, outcomes,
 * privileges and migration replay.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectFreshMarketingSchema } from "../credits/sql-test-harness.ts";
import { completePayloadV2, questionSetV2 } from "./kb-v2.test-fixtures.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { buildGeoKnowledgeSynthesisInputV1 } from "./kb-knowledge-synthesis-contract.ts";
import {
  buildGeoKnowledgeGenerationResultV2,
  buildGeoKnowledgeSynthesisInputV2,
} from "./kb-knowledge-synthesis-v2-contract.ts";
import {
  geoV2EvidenceFixture,
  geoV2NarrativeFixture,
} from "./kb-knowledge-synthesis-v2-fixtures.ts";
import { buildGeoKnowledgePackV3 } from "./kb-knowledge-pack-v3.ts";
import { parseGeoKnowledgePackV2 } from "./kb-knowledge-pack-v2-contract.ts";
import { geoBriefFactsForSnapshot } from "./brief-facts.ts";
import type { VersionedGeoKbFrozenSnapshot } from "./kb-versioned-read.ts";
import {
  createGeoPreparedCandidateV3,
  geoReviewHashV3,
  type GeoCandidateQuestionSetV3,
  type GeoPreparedCandidateV3,
} from "./kb-prepared-v3-contract.ts";
import {
  buildGeoSnapshotContextV3,
  parseGeoSnapshotContextV3,
} from "./snapshot-context-v3.ts";
import {
  geoV3ItemKeys,
  parseGeoKbPayloadV3,
  type GeoKbPayloadV3,
} from "./kb-v3-contract.ts";
import { geoV3ItemContentHashes } from "./kb-v3-item-content.ts";
import {
  applyGeoV3ReviewAction,
  geoV3DecisionStates,
  geoV3PendingKeys,
  materializeGeoV3Review,
  type GeoV3ReviewAction,
} from "./kb-v3-review.ts";
import {
  FACT_KEY_TEAM,
  OWNER_DECLARED_AT,
  OWNER_DECLARED_PRO_PRICE,
  OWNER_DECLARED_TEAM_PRICE,
  completePayloadV3,
  ownerDeclaredPayloadV3,
} from "./kb-v3.test-fixtures.ts";

const MIGRATION = new URL(
  "../../../supabase/migrations/20260907143000_geo_kb_v3.sql",
  import.meta.url,
);
const ATTEMPT = {
  attemptedCalls: 1,
  delivery: "response_received",
  modelRequested: "offline-model",
  inputTokens: 12,
  outputTokens: 30,
  requestCount: 1,
};
// UUIDv8 -- the identifier shape this codebase actually mints. The V1 knowledge
// manifest pins the RFC 4122 version nibble to [1-5] and would reject it.
const V8_RECEIPT_ID = "3f2b1a04-77c5-8d31-9e60-0a1b2c3d4e5f";
// The same id with the version nibble moved into the V1 range, so the two can
// be swapped one for the other and nothing else changes.
const V4_RECEIPT_ID = "3f2b1a04-77c5-4d31-9e60-0a1b2c3d4e5f";
const RECEIPT_HASH = "e".repeat(64);

/** Every timestamp is an argument in these builders; none of them reads a clock. */
const NOW = "2026-09-07T00:00:00.000Z";
const GENERATED_AT = "2026-09-07T01:00:00.000Z";

let db: Client;
beforeAll(async () => {
  db = await connectFreshMarketingSchema();
});
afterAll(async () => {
  await db?.end();
});

/** One knowledge base with a website whose Profile snapshot is confirmed. */
async function fixture() {
  const userId = randomUUID(),
    websiteId = randomUUID(),
    snapshotId = randomUUID();
  const base = completePayloadV2();
  const legacyPayload = {
    ...base,
    profileCopy: { ...base.profileCopy, websiteId, snapshotId },
  };
  const created = await db.query(
    "select * from public.marketing_geo_upsert_kb($1,'https://example.com','example.com','example.com')",
    [userId],
  );
  const kbId = created.rows[0].kb_id as string;
  await db.query(
    "insert into public.marketing_websites(id,user_id,canonical_site_key,origin,submitted_url,host) values($1,$2,'example.com','https://example.com','https://example.com','example.com')",
    [websiteId, userId],
  );
  await db.query(
    "insert into public.marketing_website_profile_snapshots(id,website_id,user_id,revision,schema_version,profile,content_hash,source_draft_version) values($1,$2,$3,1,'marketing-website-profile.v1',$4,$5,1)",
    [
      snapshotId,
      websiteId,
      userId,
      legacyPayload.profileCopy.profile,
      legacyPayload.profileCopy.profileHash,
    ],
  );
  await db.query(
    "update public.marketing_websites set current_confirmed_snapshot_id=$1 where id=$2",
    [snapshotId, websiteId],
  );
  /**
   * The v3 reference to that confirmed snapshot. Only the four coordinates the
   * database re-checks (`marketing_geo_generation_input_current`'s V3 branch)
   * are taken from the row this fixture just wrote; the carried 13-field subset
   * stays exactly what the shared contract fixture produces.
   */
  const profileRef = {
    ...completePayloadV3().generationInput.profileRef,
    websiteId,
    snapshotId,
    snapshotRevision: "1",
    profileHash: legacyPayload.profileCopy.profileHash as string,
  };
  return { userId, kbId, websiteId, snapshotId, legacyPayload, profileRef };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

/** The legacy V2 draft this site is upgrading from. Owner-admin setup, not the writer. */
async function seedLegacyDraft(f: Fixture) {
  await db.query(
    "insert into public.marketing_geo_kb_drafts(kb_id,user_id,schema_version,draft_version,payload,content_hash) values($1,$2,'marketing-geo-kb.v2',1,$3,$4)",
    [f.kbId, f.userId, f.legacyPayload, geoV2Digest(f.legacyPayload)],
  );
}

type PayloadOptions = {
  /** A different `evidenceContentHash`, which is what makes a *different* generation input. */
  readonly evidence?: string;
  readonly runId?: string;
  readonly rolesGenerationId?: string;
};

/**
 * The shared v3 draft fixture, pointed at this test's own Profile snapshot.
 *
 * `runRef.generationInputHash` is recomputed rather than inherited: it is the
 * digest of `generationInput`, and a payload whose recorded hash does not match
 * the input beside it is the exact thing the publish path is supposed to
 * refuse. Building one by accident would make those refusals pass for the wrong
 * reason -- the mistake design deviation B4 records.
 */
function payloadV3(f: Fixture, options: PayloadOptions = {}): GeoKbPayloadV3 {
  const base = completePayloadV3();
  const generationInput = {
    ...base.generationInput,
    profileRef: f.profileRef,
    evidenceContentHash:
      options.evidence ?? base.generationInput.evidenceContentHash,
  };
  return parseGeoKbPayloadV3({
    ...base,
    generationInput,
    runRef: {
      ...base.runRef,
      runId: options.runId ?? null,
      rolesGenerationId: options.rolesGenerationId ?? null,
      generationInputHash: geoV2Digest(generationInput),
    },
  });
}

/**
 * One owner gesture, applied and materialised the way the review route does it:
 * the hash-free state machine moves, and the server stamps the records.
 */
function reviewed(
  payload: GeoKbPayloadV3,
  action: GeoV3ReviewAction,
  baseDraftVersion: string,
): GeoKbPayloadV3 {
  const states = geoV3DecisionStates(
    payload.review,
    geoV3ItemKeys(payload.knowledge),
  );
  const review = materializeGeoV3Review(
    payload.review,
    applyGeoV3ReviewAction(states, action),
    {
      contentHash: geoV3ItemContentHashes(payload.knowledge),
      decidedAt: NOW,
      baseDraftVersion,
    },
  );
  return parseGeoKbPayloadV3({ ...payload, review });
}

/** Publishing's own fallback: everything nobody decided one by one is accepted in bulk. */
function swept(payload: GeoKbPayloadV3, baseDraftVersion: string) {
  const pending = geoV3PendingKeys(
    geoV3DecisionStates(payload.review, geoV3ItemKeys(payload.knowledge)),
  );
  return reviewed(
    payload,
    { kind: "accept_all", itemKeys: pending },
    baseDraftVersion,
  );
}

async function saveDraft(
  f: Fixture,
  payload: unknown,
  baseVersion: number | null,
  schemaVersion = "marketing-geo-kb.v3",
) {
  return (
    await db.query(
      "select * from public.marketing_geo_save_kb_draft($1,$2,$3,$4,$5,$6)",
      [
        f.userId,
        f.kbId,
        schemaVersion,
        payload,
        geoV2Digest(payload),
        baseVersion,
      ],
    )
  ).rows[0];
}
async function readDraft(f: Fixture) {
  return (
    await db.query(
      "select schema_version,draft_version,content_hash,payload from public.marketing_geo_kb_drafts where kb_id=$1",
      [f.kbId],
    )
  ).rows[0];
}

/**
 * The discriminated slot the candidate carries, not a bare question set. Design
 * deviation #19: reading this as if it were the set itself made the available
 * branch unreachable and rejected every real candidate.
 */
const UNAVAILABLE_QUESTION_SET: GeoCandidateQuestionSetV3 = {
  status: "unavailable",
  reason: "roles_missing",
  failedGenerationId: null,
};
const availableQuestionSet = (): GeoCandidateQuestionSetV3 => ({
  status: "available",
  value: questionSetV2(),
});

function candidateV3(
  f: Fixture,
  payload: GeoKbPayloadV3,
  questionSet: GeoCandidateQuestionSetV3,
  baseDraftVersion: string,
  candidateId: string = randomUUID(),
): GeoPreparedCandidateV3 {
  const set = questionSet.status === "available" ? questionSet.value : null;
  return createGeoPreparedCandidateV3({
    schemaVersion: "marketing-geo-prepared-candidate.v3",
    candidateId,
    kbId: f.kbId,
    baseDraftVersion,
    baseDraftHash: geoV2Digest(payload),
    payload,
    questionSet,
    context: buildGeoSnapshotContextV3({
      kbId: f.kbId,
      payload,
      questionSet: set,
      evidenceRefs: [],
    }),
    knowledgePack: buildGeoKnowledgePackV3({
      generatedAt: GENERATED_AT,
      payload,
      questionSet: set,
      bulkAcceptedAt: NOW,
    }),
    generationInputHash: payload.runRef.generationInputHash,
    reviewHash: geoReviewHashV3(payload),
    sourceReceiptRefs: [],
  });
}

/**
 * A candidate edited after it was built, and re-hashed so its own hash still
 * matches. Only the database's re-derivation can catch these, which is the
 * whole reason the guards exist.
 */
function tampered(
  candidate: GeoPreparedCandidateV3,
  patch: Record<string, unknown>,
) {
  const { candidateHash: _replaced, ...body } = { ...candidate, ...patch };
  return { ...body, candidateHash: geoV2Digest(body) };
}

async function publish(f: Fixture, candidate: unknown, hash: string) {
  return (
    await db.query(
      "select * from public.marketing_geo_publish_kb_v3($1,$2,$3,$4)",
      [f.userId, f.kbId, candidate, hash],
    )
  ).rows[0];
}
const publishCandidate = (f: Fixture, candidate: GeoPreparedCandidateV3) =>
  publish(f, candidate, candidate.candidateHash);

/**
 * A saved V3 draft plus a candidate built from exactly those bytes, in the
 * publish route's order: sweep the review, save the swept payload, then build
 * the candidate against the version the save returned. Building first would
 * name a draft version the table has already moved past, which is exactly what
 * the publish RPC's draft CAS refuses (design deviation #21).
 */
async function publishable(
  questionSet: GeoCandidateQuestionSetV3 = UNAVAILABLE_QUESTION_SET,
  /**
   * What the owner decided before the sweep. The default decides nothing, which
   * is the case every test below this one exercises: publishing then accepts
   * the whole draft in bulk.
   */
  decide: (payload: GeoKbPayloadV3) => GeoKbPayloadV3 = (payload) => payload,
) {
  const f = await fixture();
  const seeded = decide(payloadV3(f));
  expect((await saveDraft(f, seeded, 0)).outcome).toBe("saved");
  const payload = swept(seeded, "1");
  const saved = await saveDraft(f, payload, 1);
  expect(saved.outcome).toBe("saved");
  const version = String(saved.draft_version);
  return {
    f,
    payload,
    version,
    candidate: candidateV3(f, payload, questionSet, version),
  };
}

async function claim(
  f: Fixture,
  kind: string,
  input: Record<string, unknown>,
  key = `key_${kind}_1`,
) {
  return (
    await db.query(
      "select * from public.marketing_geo_claim_generation($1,$2,$3,$4,$5,$6)",
      [f.userId, f.kbId, kind, key, geoV2Digest({ kind, input }), input],
    )
  ).rows[0];
}
async function dispatch(f: Fixture, generationId: string, token: string) {
  return (
    await db.query(
      "select * from public.marketing_geo_dispatch_generation($1,$2,$3,$4)",
      [f.userId, f.kbId, generationId, token],
    )
  ).rows[0];
}
async function finish(
  f: Fixture,
  generationId: string,
  token: string,
  result: unknown,
) {
  return (
    await db.query(
      "select * from public.marketing_geo_finish_generation($1,$2,$3,$4,'succeeded',$5,null,$6)",
      [f.userId, f.kbId, generationId, token, result, ATTEMPT],
    )
  ).rows[0];
}
function hashed<T extends Record<string, unknown>>(body: T) {
  return { ...body, contentHash: geoV2Digest(body) };
}

type ReceiptRef = { readonly receiptId: string; readonly contentHash: string };

/**
 * A knowledge_pack manifest and result built by the shipped V2 builders, bound
 * to this test's own draft.
 *
 * The evidence bundle and the narrative are the shared v2 fixtures: the
 * narrative cites that bundle's source ids, and `parseGeoKnowledgeNarrativeV2`
 * checks every reference against the synthesis input's catalogue, so the two
 * only make sense together. Nothing on this path binds either of them to the
 * knowledge base's host -- what binds a knowledge generation to a draft is the
 * manifest's four coordinates, and those are taken from the real draft below.
 */
function knowledgeV2(
  f: Fixture,
  payload: GeoKbPayloadV3,
  draftVersion: string,
  generationId: string,
  sourceReceiptRefs: readonly ReceiptRef[] = [],
) {
  const identity = payload.generationInput.identity;
  const evidence = geoV2EvidenceFixture();
  const synthesisInput = buildGeoKnowledgeSynthesisInputV2(
    {
      officialName: identity.officialName,
      aliases: [...identity.aliases],
      categoryTerms: [...identity.categoryTerms],
      market: identity.market.country,
      language: identity.market.language,
      profileRef: payload.generationInput.profileRef,
      generationInputHash: payload.runRef.generationInputHash,
    },
    evidence,
  );
  const manifest = {
    schemaVersion: "marketing-geo-knowledge-generation-input.v2",
    kbId: f.kbId,
    baseDraftVersion: draftVersion,
    baseDraftHash: geoV2Digest(payload),
    generationInputHash: payload.runRef.generationInputHash,
    sourceReceiptRefs,
    knowledgeSynthesisInput: synthesisInput,
  };
  const narrative = geoV2NarrativeFixture();
  const result = buildGeoKnowledgeGenerationResultV2({
    schemaVersion: "marketing-geo-knowledge-generation-result.v2",
    generationId,
    kbId: f.kbId,
    manifest,
    evidence,
    synthesisInput,
    narrative,
    generatedAt: GENERATED_AT,
  });
  return { manifest, result, narrative, synthesisInput, evidence };
}

/**
 * The V1 counterpart of the same manifest, built by the V1 builders. It exists
 * so the receipt-id version nibble can be varied on its own: a V1 manifest
 * carrying a V2 synthesis input is refused for a reason that has nothing to do
 * with the receipt.
 */
function knowledgeV1Manifest(
  f: Fixture,
  payload: GeoKbPayloadV3,
  draftVersion: string,
  sourceReceiptRefs: readonly ReceiptRef[],
) {
  const identity = payload.generationInput.identity;
  const evidence = geoV2EvidenceFixture();
  return {
    schemaVersion: "marketing-geo-knowledge-generation-input.v1",
    kbId: f.kbId,
    baseDraftVersion: draftVersion,
    baseDraftHash: geoV2Digest(payload),
    profileCopyHash: "c".repeat(64),
    sourceReceiptRefs,
    knowledgeSynthesisInput: buildGeoKnowledgeSynthesisInputV1(
      {
        officialName: identity.officialName,
        aliases: [...identity.aliases],
        categoryTerms: [...identity.categoryTerms],
        market: identity.market.country,
        language: identity.market.language,
      },
      evidence,
    ),
  };
}

/** The manifest validator, called directly: it is executable by nobody, so only the owner connection reaches it. */
async function manifestValid(f: Fixture, manifest: unknown): Promise<boolean> {
  return (
    await db.query(
      "select public.marketing_geo_knowledge_input_valid($1,$2,$3) as ok",
      [
        f.kbId,
        geoV2Digest({ kind: "knowledge_pack", input: manifest }),
        manifest,
      ],
    )
  ).rows[0].ok as boolean;
}

describe("GEO knowledge base V3 SQL", () => {
  it("saves a V3 draft whose generationInput only references the confirmed Profile", async () => {
    const f = await fixture();
    const payload = payloadV3(f);
    expect(await saveDraft(f, payload, 0)).toMatchObject({
      outcome: "saved",
      draft_version: 1,
      content_hash: geoV2Digest(payload),
    });
    const stored = await readDraft(f);
    expect(stored.schema_version).toBe("marketing-geo-kb.v3");
    expect(stored.payload).toEqual(payload);
    expect(stored.payload.profileCopy).toBeUndefined();
    // The reference, and nothing copied from it, is what points at the Profile.
    expect(stored.payload.generationInput.profileRef.snapshotId).toBe(
      f.snapshotId,
    );
  });

  it("rejects a V3 draft that keeps a profileCopy or drops a required section", async () => {
    const f = await fixture();
    const rejects = async (payload: unknown) => {
      await db.query("begin");
      try {
        await expect(
          db.query(
            "insert into public.marketing_geo_kb_drafts(kb_id,user_id,schema_version,draft_version,payload,content_hash) values($1,$2,'marketing-geo-kb.v3',1,$3,$4)",
            [f.kbId, f.userId, payload, geoV2Digest(payload)],
          ),
        ).rejects.toThrow(/check constraint/iu);
      } finally {
        await db.query("rollback");
      }
    };
    // Each of these is the accepted payload with exactly one thing changed.
    await rejects({
      ...payloadV3(f),
      profileCopy: f.legacyPayload.profileCopy,
    });
    const { review: _review, ...withoutReview } = payloadV3(f);
    await rejects(withoutReview);
    const { runRef: _runRef, ...withoutRunRef } = payloadV3(f);
    await rejects(withoutRunRef);
    await rejects({ ...payloadV3(f), schemaVersion: "marketing-geo-kb.v2" });
  });

  it("upgrades a V2 draft to V3 while still refusing a silent V2 profileCopy drop", async () => {
    const f = await fixture();
    await seedLegacyDraft(f);
    const { profileCopy: _dropped, ...v2WithoutCopy } = f.legacyPayload;
    expect(
      (await saveDraft(f, v2WithoutCopy, 1, "marketing-geo-kb.v2")).outcome,
    ).toBe("profile_copy_mismatch");
    const payload = payloadV3(f);
    expect(await saveDraft(f, payload, 1)).toMatchObject({
      outcome: "saved",
      draft_version: 2,
    });
    const stored = await readDraft(f);
    expect(stored.schema_version).toBe("marketing-geo-kb.v3");
    expect(stored.payload.profileCopy).toBeUndefined();
  });

  it("locks generationInput once a run is open and still accepts review edits", async () => {
    // Both ways a run can be open. `runId` is null for the whole three-call
    // flow the product actually runs, so a lock keyed on it alone would never
    // have fired once -- design deviation #23.
    for (const opened of [
      { rolesGenerationId: randomUUID() },
      { runId: randomUUID() },
    ]) {
      const f = await fixture();
      const open = payloadV3(f, opened);
      expect((await saveDraft(f, open, 0)).outcome).toBe("saved");

      const rebuilt = payloadV3(f, { ...opened, evidence: "b".repeat(64) });
      expect(rebuilt.runRef.generationInputHash).not.toBe(
        open.runRef.generationInputHash,
      );
      expect(await saveDraft(f, rebuilt, 1)).toMatchObject({
        outcome: "generation_input_locked",
        draft_version: 1,
      });
      expect((await readDraft(f)).content_hash).toBe(geoV2Digest(open));

      // A review decision changes the payload and leaves the locked hash alone.
      const decided = reviewed(
        open,
        { kind: "accept", itemKey: FACT_KEY_TEAM },
        "1",
      );
      expect(decided.runRef.generationInputHash).toBe(
        open.runRef.generationInputHash,
      );
      expect(geoV2Digest(decided)).not.toBe(geoV2Digest(open));
      expect(await saveDraft(f, decided, 1)).toMatchObject({
        outcome: "saved",
        draft_version: 2,
      });
    }
  });

  it("leaves generationInput writable while no run is open", async () => {
    const f = await fixture();
    const first = payloadV3(f);
    expect((await saveDraft(f, first, 0)).outcome).toBe("saved");
    const second = payloadV3(f, { evidence: "c".repeat(64) });
    expect(second.runRef.generationInputHash).not.toBe(
      first.runRef.generationInputHash,
    );
    expect(await saveDraft(f, second, 1)).toMatchObject({
      outcome: "saved",
      draft_version: 2,
    });
  });

  it("publishes a version with no question set and writes both columns null", async () => {
    const { f, candidate } = await publishable();
    const published = await publishCandidate(f, candidate);
    expect(published).toMatchObject({
      outcome: "published",
      revision: 1,
      reused_existing: false,
      content_hash: candidate.baseDraftHash,
    });
    const snapshot = (
      await db.query(
        "select * from public.marketing_geo_kb_snapshots where id=$1",
        [published.snapshot_id],
      )
    ).rows[0];
    expect(snapshot).toMatchObject({
      schema_version: "marketing-geo-kb.v3",
      question_set: null,
      question_set_hash: null,
      prepared_id: candidate.candidateId,
    });
    expect(snapshot.payload).toEqual(candidate.payload);
    expect(
      (
        await db.query(
          "select context from public.marketing_geo_snapshot_contexts where snapshot_id=$1",
          [published.snapshot_id],
        )
      ).rows[0].context,
    ).toEqual(candidate.context);
    expect(
      (
        await db.query(
          "select generation_id from public.marketing_geo_kb_prepared_candidates where id=$1",
          [candidate.candidateId],
        )
      ).rows[0].generation_id,
    ).toBeNull();
    expect(
      (
        await db.query(
          "select current_frozen_snapshot_id from public.marketing_geo_knowledge_bases where id=$1",
          [f.kbId],
        )
      ).rows[0].current_frozen_snapshot_id,
    ).toBe(published.snapshot_id);
  });

  it("publishes a version that does have a question set and writes both columns", async () => {
    const { f, candidate } = await publishable(availableQuestionSet());
    const published = await publishCandidate(f, candidate);
    expect(published.outcome).toBe("published");
    const snapshot = (
      await db.query(
        "select question_set,question_set_hash from public.marketing_geo_kb_snapshots where id=$1",
        [published.snapshot_id],
      )
    ).rows[0];
    // The column holds the question set itself, not the discriminated slot that
    // carried it: a stored slot is a value `parseGeoQuestionSetV2` cannot read.
    expect(snapshot.question_set).toEqual(questionSetV2());
    expect(snapshot.question_set_hash).toBe(geoV2Digest(questionSetV2()));
  });

  it("publishes a version whose every fact is an owner declaration, and the Brief reads it back", async () => {
    // The one artifact the design names by hand: a draft carrying only facts
    // the owner declared -- no page, no URL, no observation behind any of them
    // -- has to publish, and a Brief has to be able to read what was published.
    //
    // Both halves run against the real thing. The pack is built by the publish
    // assembler from a draft whose facts the owner corrected, stored by the
    // publish RPC, read back out of the table, and handed to the projection a
    // Brief uses -- so a publish path that stopped emitting URL-less owner
    // declarations, or a projection that started demanding a URL for them,
    // breaks this test rather than passing between them.
    const { f, candidate } = await publishable(
      UNAVAILABLE_QUESTION_SET,
      ownerDeclaredPayloadV3,
    );
    const published = await publishCandidate(f, candidate);
    expect(published.outcome).toBe("published");

    const snapshot = (
      await db.query(
        "select s.*, c.context from public.marketing_geo_kb_snapshots s join public.marketing_geo_snapshot_contexts c on c.snapshot_id=s.id where s.id=$1",
        [published.snapshot_id],
      )
    ).rows[0];
    const stored = (
      await db.query(
        "select candidate->'knowledgePack' as pack from public.marketing_geo_kb_prepared_candidates where id=$1",
        [candidate.candidateId],
      )
    ).rows[0].pack;

    // Everything from here on comes back out of the tables and through the
    // parsers a reader uses; nothing is carried over from the objects this test
    // handed to the RPC.
    const pack = parseGeoKnowledgePackV2(stored);
    const context = parseGeoSnapshotContextV3(snapshot.context);
    const frozen: VersionedGeoKbFrozenSnapshot = {
      kbId: snapshot.kb_id,
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      contentHash: snapshot.content_hash,
      questionSetHash: snapshot.question_set_hash,
      questionCount: null,
      frozenAt: new Date(snapshot.frozen_at).toISOString(),
      payload: parseGeoKbPayloadV3(snapshot.payload),
      questionSet: null,
    };

    if (pack.facts.status !== "available")
      throw new Error("Expected published facts");
    expect(pack.facts.value.map((fact) => fact.origin)).toEqual([
      "declared_owner",
      "declared_owner",
    ]);
    // Nothing cited, nothing observed: the pages that carried the prices the
    // owner replaced survive only as `priorSourceRefs`.
    expect(pack.facts.value.flatMap((fact) => fact.sourceRefs)).toEqual([]);
    expect(pack.facts.value.map((fact) => fact.observedAt)).toEqual([
      null,
      null,
    ]);
    expect(pack.facts.value.map((fact) => fact.ownerDeclaredAt)).toEqual([
      OWNER_DECLARED_AT,
      OWNER_DECLARED_AT,
    ]);

    const result = geoBriefFactsForSnapshot(frozen, context, pack);

    expect(result.factTable).toEqual([
      {
        id: "F1",
        label: "Pro plan monthly price",
        value: OWNER_DECLARED_PRO_PRICE,
        reason: null,
        evidence_refs: ["K1"],
      },
      {
        id: "F2",
        label: "Team plan monthly price",
        value: OWNER_DECLARED_TEAM_PRICE,
        reason: null,
        evidence_refs: ["K2"],
      },
    ]);
    expect(result.receipts).toEqual([
      {
        id: "K1",
        source: "kb",
        text: OWNER_DECLARED_PRO_PRICE,
        observed_at: OWNER_DECLARED_AT,
        url: null,
      },
      {
        id: "K2",
        source: "kb",
        text: OWNER_DECLARED_TEAM_PRICE,
        observed_at: OWNER_DECLARED_AT,
        url: null,
      },
    ]);
    // The declaration date, not the freeze time it would fall back to.
    expect(result.receipts.map((receipt) => receipt.observed_at)).not.toContain(
      frozen.frozenAt,
    );
    expect(result.receipts.map((receipt) => receipt.source)).not.toContain(
      "crawl",
    );
  });

  it("returns the existing version for a byte-identical republish and mints no second candidate", async () => {
    const { f, payload, version, candidate } = await publishable();
    const first = await publishCandidate(f, candidate);
    const replay = await publishCandidate(f, candidate);
    expect(replay).toMatchObject({
      outcome: "published",
      snapshot_id: first.snapshot_id,
      revision: first.revision,
      reused_existing: true,
    });

    // A different candidate id over identical content is still the same
    // version -- what a double-clicked publish produces.
    const reminted = candidateV3(
      f,
      payload,
      UNAVAILABLE_QUESTION_SET,
      version,
      randomUUID(),
    );
    expect(reminted.candidateId).not.toBe(candidate.candidateId);
    const secondReplay = await publishCandidate(f, reminted);
    expect(secondReplay).toMatchObject({
      snapshot_id: first.snapshot_id,
      reused_existing: true,
    });

    expect(
      (
        await db.query(
          "select count(*)::int as n from public.marketing_geo_kb_prepared_candidates where kb_id=$1",
          [f.kbId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await db.query(
          "select count(*)::int as n from public.marketing_geo_kb_snapshots where kb_id=$1",
          [f.kbId],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it("publishes a second version when the reviewed content changes", async () => {
    const { f, payload, version, candidate } = await publishable();
    const firstPublished = await publishCandidate(f, candidate);
    expect(firstPublished.revision).toBe(1);

    // The owner excludes an item they had only accepted in bulk. The draft has
    // to be saved before the publish: the candidate names the version and hash
    // the table currently holds.
    const corrected = reviewed(
      payload,
      { kind: "exclude", itemKey: FACT_KEY_TEAM },
      version,
    );
    const saved = await saveDraft(f, corrected, Number(version));
    expect(saved.outcome).toBe("saved");
    const secondPublished = await publishCandidate(
      f,
      candidateV3(
        f,
        corrected,
        UNAVAILABLE_QUESTION_SET,
        String(saved.draft_version),
      ),
    );
    expect(secondPublished).toMatchObject({
      revision: 2,
      reused_existing: false,
    });
    expect(secondPublished.snapshot_id).not.toBe(firstPublished.snapshot_id);
    expect(
      (
        await db.query(
          "select current_frozen_snapshot_id from public.marketing_geo_knowledge_bases where id=$1",
          [f.kbId],
        )
      ).rows[0].current_frozen_snapshot_id,
    ).toBe(secondPublished.snapshot_id);
  });

  it("refuses candidates that do not hash themselves, do not match the draft, or hide an ambiguous question set", async () => {
    const { f, payload, version, candidate } = await publishable();
    expect((await publish(f, candidate, "f".repeat(64))).outcome).toBe(
      "candidate_mismatch",
    );
    // Edited in transit and *not* re-hashed: the database recomputes the hash
    // over everything but `candidateHash`, so any added key is caught.
    expect(
      (
        await publish(
          f,
          { ...candidate, targetHostTampered: true },
          candidate.candidateHash,
        )
      ).outcome,
    ).toBe("candidate_mismatch");
    expect(
      (
        await publish(
          f,
          {
            ...candidate,
            context: { ...candidate.context, targetHost: "attacker.example" },
          },
          candidate.candidateHash,
        )
      ).outcome,
    ).toBe("candidate_mismatch");

    // A question set slot the RPC cannot classify as either present or absent.
    // Both of these are re-hashed, so nothing but the slot itself is wrong --
    // the hash guard above cannot be what refuses them.
    //
    // First: the bare question set where the discriminated slot belongs. This
    // is the shape the RPC used to read (design deviation #19), and reading it
    // that way made every real candidate unpublishable.
    const bare = tampered(candidate, { questionSet: questionSetV2() });
    expect((await publish(f, bare, bare.candidateHash)).outcome).toBe(
      "candidate_mismatch",
    );
    // Second: a slot that claims a question set and carries none.
    const emptyClaim = tampered(candidate, {
      questionSet: { status: "available" },
    });
    expect(
      (await publish(f, emptyClaim, emptyClaim.candidateHash)).outcome,
    ).toBe("candidate_mismatch");

    // Built against a generation input the draft no longer holds. The payload
    // carries `generationInput`, so a different input is necessarily a
    // different payload hash too: this fires both halves of the `input_stale`
    // guard at once, and no candidate can separate them.
    const stale = candidateV3(
      f,
      payloadV3(f, { evidence: "d".repeat(64) }),
      UNAVAILABLE_QUESTION_SET,
      version,
    );
    expect(stale.generationInputHash).not.toBe(
      payload.runRef.generationInputHash,
    );
    expect((await publishCandidate(f, stale)).outcome).toBe("input_stale");

    expect(
      (
        await db.query(
          "select count(*)::int as n from public.marketing_geo_kb_snapshots where kb_id=$1",
          [f.kbId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.query(
          "select count(*)::int as n from public.marketing_geo_kb_prepared_candidates where kb_id=$1",
          [f.kbId],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("refuses to publish for another owner or an unknown knowledge base", async () => {
    const { f, candidate } = await publishable();
    const stranger = await fixture();
    expect(
      (await publishCandidate({ ...f, userId: stranger.userId }, candidate))
        .outcome,
    ).toBe("not_found");
    expect(
      (await publishCandidate({ ...f, kbId: randomUUID() }, candidate)).outcome,
    ).toBe("not_found");
    expect(
      (
        await db.query(
          "select count(*)::int as n from public.marketing_geo_kb_snapshots where kb_id=$1",
          [f.kbId],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("keeps the legacy freeze paths closed to V3 drafts with a readable outcome", async () => {
    const f = await fixture();
    expect((await saveDraft(f, payloadV3(f), 0)).outcome).toBe("saved");
    const questionSet = questionSetV2();
    expect(
      (
        await db.query(
          "select * from public.marketing_geo_freeze_kb($1,$2,'marketing-geo-kb.v3',1,$3,$4)",
          [f.userId, f.kbId, questionSet, geoV2Digest(questionSet)],
        )
      ).rows[0].outcome,
    ).toBe("context_required");
    expect(
      (
        await db.query(
          "select * from public.marketing_geo_freeze_kb_with_context($1,$2,'marketing-geo-kb.v3',1,$3,$4,$5)",
          [
            f.userId,
            f.kbId,
            questionSet,
            geoV2Digest(questionSet),
            { schemaVersion: "marketing-geo-snapshot-context.v1" },
          ],
        )
      ).rows[0].outcome,
    ).toBe("context_required");
    expect(
      (
        await db.query(
          "select count(*)::int as n from public.marketing_geo_kb_snapshots where kb_id=$1",
          [f.kbId],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("finishes a V3 roles generation whose profileCopyHash is absent on both sides", async () => {
    const f = await fixture();
    const payload = payloadV3(f);
    expect((await saveDraft(f, payload, 0)).outcome).toBe("saved");
    const input = {
      kbId: f.kbId,
      baseDraftVersion: "1",
      baseDraftHash: geoV2Digest(payload),
      generationInputHash: payload.runRef.generationInputHash,
    };
    const claimed = await claim(f, "roles", input);
    expect(claimed.outcome).toBe("claimed");
    const generationId = claimed.generation.generationId as string;
    expect((await dispatch(f, generationId, claimed.claim_token)).outcome).toBe(
      "dispatched",
    );
    const result = hashed({
      schemaVersion: "marketing-geo-role-proposal.v1",
      generationId,
      kbId: f.kbId,
      baseDraftVersion: "1",
      baseDraftHash: input.baseDraftHash,
      sourceReceiptRefs: [],
      roles: [
        { id: "r1", label: "Finance teams", evidenceRefs: ["source:home"] },
      ],
    });
    expect(
      await finish(f, generationId, claimed.claim_token, result),
    ).toMatchObject({
      outcome: "finished",
      generation: { state: "succeeded" },
    });
  });

  it("still rejects a roles result that invents a profileCopyHash the input never had", async () => {
    const f = await fixture();
    const payload = payloadV3(f);
    expect((await saveDraft(f, payload, 0)).outcome).toBe("saved");
    const input = {
      kbId: f.kbId,
      baseDraftVersion: "1",
      baseDraftHash: geoV2Digest(payload),
      generationInputHash: payload.runRef.generationInputHash,
    };
    const claimed = await claim(f, "roles", input, "roles_forged_hash");
    const generationId = claimed.generation.generationId as string;
    await dispatch(f, generationId, claimed.claim_token);
    const result = hashed({
      schemaVersion: "marketing-geo-role-proposal.v1",
      generationId,
      kbId: f.kbId,
      baseDraftVersion: "1",
      baseDraftHash: input.baseDraftHash,
      profileCopyHash: "b".repeat(64),
      sourceReceiptRefs: [],
      roles: [],
    });
    expect(
      (await finish(f, generationId, claimed.claim_token, result)).outcome,
    ).toBe("invalid_result");
  });

  it("finishes a V3 questions generation with a question set alone and mints no candidate", async () => {
    const f = await fixture();
    const payload = payloadV3(f);
    expect((await saveDraft(f, payload, 0)).outcome).toBe("saved");
    const input = {
      schemaVersion: "marketing-geo-question-generation-input.v3",
      kbId: f.kbId,
      baseDraftVersion: "1",
      baseDraftHash: geoV2Digest(payload),
      generationInputHash: payload.runRef.generationInputHash,
    };
    const claimed = await claim(f, "questions", input);
    expect(claimed.outcome).toBe("claimed");
    const generationId = claimed.generation.generationId as string;
    await dispatch(f, generationId, claimed.claim_token);
    const result = hashed({
      schemaVersion: "marketing-geo-question-generation-result.v1",
      generationId,
      kbId: f.kbId,
      baseDraftVersion: "1",
      baseDraftHash: input.baseDraftHash,
      generationInputHash: input.generationInputHash,
      sourceReceiptRefs: [],
      questionSet: questionSetV2(),
    });
    expect(
      await finish(f, generationId, claimed.claim_token, result),
    ).toMatchObject({
      outcome: "finished",
      generation: { state: "succeeded", result },
    });
    expect(
      (
        await db.query(
          "select count(*)::int as n from public.marketing_geo_kb_prepared_candidates where kb_id=$1",
          [f.kbId],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("refuses a V3 questions result that carries a prepared candidate instead of a question set", async () => {
    const f = await fixture();
    const payload = swept(payloadV3(f), "1");
    expect((await saveDraft(f, payload, 0)).outcome).toBe("saved");
    const input = {
      schemaVersion: "marketing-geo-question-generation-input.v3",
      kbId: f.kbId,
      baseDraftVersion: "1",
      baseDraftHash: geoV2Digest(payload),
      generationInputHash: payload.runRef.generationInputHash,
    };
    const claimed = await claim(
      f,
      "questions",
      input,
      "questions_candidate_shape",
    );
    const generationId = claimed.generation.generationId as string;
    await dispatch(f, generationId, claimed.claim_token);
    // Not a hand-drawn candidate-ish blob: a candidate this very file can
    // publish. V3 mints candidates at publish time and never from a model step,
    // so even a valid one is not a question generation result.
    const result = candidateV3(
      f,
      payload,
      UNAVAILABLE_QUESTION_SET,
      "1",
      generationId,
    );
    expect(
      (await finish(f, generationId, claimed.claim_token, result)).outcome,
    ).toBe("invalid_result");
  });

  it("accepts a UUIDv8 receipt reference under manifest V2 and rejects it under V1", async () => {
    const f = await fixture();
    const payload = payloadV3(f);
    expect((await saveDraft(f, payload, 0)).outcome).toBe("saved");
    const v8 = [{ receiptId: V8_RECEIPT_ID, contentHash: RECEIPT_HASH }];
    const v2 = knowledgeV2(f, payload, "1", randomUUID(), v8);
    expect(
      (await claim(f, "knowledge_pack", v2.manifest, "knowledge_v8_ok"))
        .outcome,
    ).toBe("claimed");

    /**
     * The version nibble, isolated. Both manifests below are real V1 manifests
     * built by the V1 builders and differ in exactly one character -- the
     * receipt id's version digit -- so the refusal can only be about that.
     *
     * This has to go through the validator rather than `claim`: a V1 manifest
     * carries no `generationInputHash`, so a V3 draft would refuse it as
     * `input_stale` whatever the receipt says, and a claim-level assertion
     * would prove nothing about the pattern.
     */
    const v1 = knowledgeV1Manifest(f, payload, "1", [
      { receiptId: V4_RECEIPT_ID, contentHash: RECEIPT_HASH },
    ]);
    expect(await manifestValid(f, v1)).toBe(true);
    expect(await manifestValid(f, { ...v1, sourceReceiptRefs: v8 })).toBe(
      false,
    );
    expect(await manifestValid(f, v2.manifest)).toBe(true);
  });

  it("refuses a manifest V2 that keeps profileCopyHash or drops generationInputHash", async () => {
    const f = await fixture();
    const payload = payloadV3(f);
    expect((await saveDraft(f, payload, 0)).outcome).toBe("saved");
    const { manifest } = knowledgeV2(f, payload, "1", randomUUID());
    const { generationInputHash: _dropped, ...withoutHash } = manifest;
    // Swapped for the V1 field: still seven keys, so the key-count rule is not
    // what refuses it.
    expect(
      (
        await claim(
          f,
          "knowledge_pack",
          { ...withoutHash, profileCopyHash: "c".repeat(64) },
          "knowledge_copy_hash",
        )
      ).outcome,
    ).toBe("conflict");
    // Simply absent: six keys.
    expect(
      (await claim(f, "knowledge_pack", withoutHash, "knowledge_missing_hash"))
        .outcome,
    ).toBe("conflict");
    expect(
      (
        await db.query(
          "select count(*)::int as n from public.marketing_geo_kb_generations where kb_id=$1",
          [f.kbId],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("finishes a knowledge generation whose narrative is the six-key V2 narrative", async () => {
    const f = await fixture();
    const payload = payloadV3(f);
    expect((await saveDraft(f, payload, 0)).outcome).toBe("saved");
    const seed = knowledgeV2(f, payload, "1", randomUUID());
    /**
     * Narrative V2 has the same six top-level keys as V1. The triple-shaped
     * facts and the canonical questions that once justified dropping this pin
     * live *inside* `facts[]` and `qa[]`, so the V2 branch pins the count again
     * (design deviation #24, `marketing_geo_knowledge_result_valid`). The
     * numbers come from the builders rather than from the migration: if these
     * ever disagree, the SQL literal is what is wrong.
     */
    expect(Object.keys(seed.narrative)).toHaveLength(6);
    expect(Object.keys(seed.synthesisInput)).toHaveLength(14);
    const claimed = await claim(
      f,
      "knowledge_pack",
      seed.manifest,
      "knowledge_v2_finish",
    );
    expect(claimed.outcome).toBe("claimed");
    const generationId = claimed.generation.generationId as string;
    await dispatch(f, generationId, claimed.claim_token);
    const { result } = knowledgeV2(f, payload, "1", generationId);
    expect(
      await finish(f, generationId, claimed.claim_token, result),
    ).toMatchObject({
      outcome: "finished",
      generation: { state: "succeeded", result },
    });
  });

  it("refuses a V2 result whose narrative carries a seventh top-level key", async () => {
    const f = await fixture();
    const payload = payloadV3(f);
    expect((await saveDraft(f, payload, 0)).outcome).toBe("saved");
    const seed = knowledgeV2(f, payload, "1", randomUUID());
    const claimed = await claim(
      f,
      "knowledge_pack",
      seed.manifest,
      "knowledge_v2_extra_key",
    );
    const generationId = claimed.generation.generationId as string;
    await dispatch(f, generationId, claimed.claim_token);
    const built = knowledgeV2(f, payload, "1", generationId);
    const { contentHash: _drop, ...body } = built.result;
    // One key added to a result that is otherwise byte-identical to the one the
    // test above stores successfully. A stored result is immutable, so a field
    // nobody validated must not be able to ride along inside it.
    const smuggled = hashed({
      ...body,
      narrative: { ...built.narrative, extra: "smuggled" },
    });
    expect(
      (await finish(f, generationId, claimed.claim_token, smuggled)).outcome,
    ).toBe("invalid_result");
  });

  it("refuses a V2 result whose narrative or manifest is still V1", async () => {
    const f = await fixture();
    const payload = payloadV3(f);
    expect((await saveDraft(f, payload, 0)).outcome).toBe("saved");
    const seed = knowledgeV2(f, payload, "1", randomUUID());
    const claimed = await claim(
      f,
      "knowledge_pack",
      seed.manifest,
      "knowledge_v2_mixed",
    );
    const generationId = claimed.generation.generationId as string;
    await dispatch(f, generationId, claimed.claim_token);
    const built = knowledgeV2(f, payload, "1", generationId);
    const { contentHash: _drop, ...body } = built.result;
    const downgraded = hashed({
      ...body,
      narrative: {
        ...built.narrative,
        schemaVersion: "marketing-geo-knowledge-narrative.v1",
      },
    });
    expect(
      (await finish(f, generationId, claimed.claim_token, downgraded)).outcome,
    ).toBe("invalid_result");
    const mislabelled = hashed({
      ...body,
      schemaVersion: "marketing-geo-knowledge-generation-result.v1",
    });
    expect(
      (await finish(f, generationId, claimed.claim_token, mislabelled)).outcome,
    ).toBe("invalid_result");
  });

  it("budgets V3 payloads at one mebibyte with separate knowledge and review ceilings", async () => {
    const f = await fixture();
    const insert = async (payload: unknown, schemaVersion: string) => {
      await db.query("begin");
      try {
        await db.query(
          "insert into public.marketing_geo_kb_drafts(kb_id,user_id,schema_version,draft_version,payload,content_hash) values($1,$2,$3,1,$4,$5)",
          [f.kbId, f.userId, schemaVersion, payload, geoV2Digest(payload)],
        );
        return "accepted";
      } catch (error) {
        return /check constraint/iu.test(String(error))
          ? "rejected"
          : `unexpected: ${String(error)}`;
      } finally {
        await db.query("rollback");
      }
    };
    const large = payloadV3(f);
    const knowledge = large.knowledge;
    if (knowledge === null || knowledge.facts.status !== "available") {
      throw new Error("The shared v3 fixture publishes available facts");
    }
    const facts = knowledge.facts;
    /**
     * The real payload with one real fact repeated, its statement inflated. The
     * constraints measure `octet_length(payload->'knowledge')` and nothing
     * else, so an oversized field is the whole mutation.
     */
    const withFacts = (bytes: number) => ({
      ...large,
      knowledge: {
        ...knowledge,
        facts: {
          ...facts,
          value: [
            ...facts.value,
            {
              ...facts.value[0]!,
              id: "fact:filler",
              statement: "x".repeat(bytes),
            },
          ],
        },
      },
    });

    // Over the legacy 384KiB total, under the V3 1MiB total: V3 only.
    expect(await insert(withFacts(450_000), "marketing-geo-kb.v3")).toBe(
      "accepted",
    );
    expect(
      await insert(
        { ...f.legacyPayload, filler: "x".repeat(450_000) },
        "marketing-geo-kb.v2",
      ),
    ).toBe("rejected");

    // The sub-budgets bind even when the total does not.
    expect(await insert(withFacts(600_000), "marketing-geo-kb.v3")).toBe(
      "rejected",
    );
    expect(
      await insert(
        {
          ...large,
          review: {
            ...large.review,
            suppressions: [
              { itemKey: FACT_KEY_TEAM, suppressedAt: "x".repeat(200_000) },
            ],
          },
        },
        "marketing-geo-kb.v3",
      ),
    ).toBe("rejected");

    // And the total still binds when neither sub-budget does.
    expect(
      await insert(
        {
          ...large,
          generationInput: {
            ...large.generationInput,
            padding: "x".repeat(1_100_000),
          },
        },
        "marketing-geo-kb.v3",
      ),
    ).toBe("rejected");
  });

  it("keeps the question-set columns paired and mandatory for V1 and V2 versions", async () => {
    const f = await fixture();
    const rejects = async (sql: string, values: readonly unknown[]) => {
      await db.query("begin");
      try {
        await expect(db.query(sql, values as unknown[])).rejects.toThrow(
          /check constraint/iu,
        );
      } finally {
        await db.query("rollback");
      }
    };
    const legacy = {
      schemaVersion: "marketing-geo-kb.v1",
      targetUrl: "https://example.com/",
    };
    await rejects(
      `insert into public.marketing_geo_kb_snapshots(kb_id,user_id,revision,schema_version,payload,content_hash,question_set,question_set_hash)
      values($1,$2,1,'marketing-geo-kb.v1',$3,$4,null,null)`,
      [f.kbId, f.userId, legacy, geoV2Digest(legacy)],
    );
    await rejects(
      `insert into public.marketing_geo_kb_snapshots(kb_id,user_id,revision,schema_version,payload,content_hash,question_set,question_set_hash)
      values($1,$2,1,'marketing-geo-kb.v1',$3,$4,$5,null)`,
      [f.kbId, f.userId, legacy, geoV2Digest(legacy), questionSetV2()],
    );
  });

  it("leaves the V1 and V2 paths working exactly as before", async () => {
    const f = await fixture();
    const legacy = {
      schemaVersion: "marketing-geo-kb.v1",
      targetUrl: "https://example.com/",
      officialName: "Acme",
    };
    expect((await saveDraft(f, legacy, 0, "marketing-geo-kb.v1")).outcome).toBe(
      "saved",
    );
    const questionSet = questionSetV2();
    const frozen = (
      await db.query(
        "select * from public.marketing_geo_freeze_kb($1,$2,'marketing-geo-kb.v1',1,$3,$4)",
        [f.userId, f.kbId, questionSet, geoV2Digest(questionSet)],
      )
    ).rows[0];
    expect(frozen).toMatchObject({
      outcome: "frozen",
      revision: 1,
      reused_existing: false,
    });
    const snapshot = (
      await db.query(
        "select schema_version,question_set,prepared_id from public.marketing_geo_kb_snapshots where id=$1",
        [frozen.snapshot_id],
      )
    ).rows[0];
    expect(snapshot).toMatchObject({
      schema_version: "marketing-geo-kb.v1",
      prepared_id: null,
    });
    expect(snapshot.question_set).toEqual(questionSet);

    const other = await fixture();
    await seedLegacyDraft(other);
    expect(
      (await saveDraft(other, other.legacyPayload, 1, "marketing-geo-kb.v2"))
        .outcome,
    ).toBe("saved");
  });

  it("denies browser access to the publish RPC and keeps the validators executable by nobody", async () => {
    const publishSignature =
      "marketing_geo_publish_kb_v3(uuid,uuid,jsonb,text)";
    for (const signature of [
      publishSignature,
      "marketing_geo_save_kb_draft(uuid,uuid,text,jsonb,text,integer)",
      "marketing_geo_finish_generation(uuid,uuid,uuid,uuid,text,jsonb,text,jsonb)",
      "marketing_geo_freeze_kb(uuid,uuid,text,integer,jsonb,text)",
      "marketing_geo_freeze_kb_with_context(uuid,uuid,text,integer,jsonb,text,jsonb)",
    ]) {
      expect(
        (
          await db.query(
            "select has_function_privilege('anon',$1,'execute') as anon,has_function_privilege('authenticated',$1,'execute') as browser,has_function_privilege('service_role',$1,'execute') as service",
            [`public.${signature}`],
          )
        ).rows[0],
      ).toEqual({ anon: false, browser: false, service: true });
      const config = (
        await db.query(
          "select prosecdef,proconfig from pg_proc where oid=$1::regprocedure",
          [`public.${signature}`],
        )
      ).rows[0];
      expect(config.prosecdef).toBe(true);
      expect(config.proconfig).toEqual(
        expect.arrayContaining(['search_path=""', "TimeZone=UTC"]),
      );
    }
    for (const signature of [
      "marketing_geo_knowledge_input_valid(uuid,text,jsonb)",
      "marketing_geo_knowledge_result_valid(uuid,uuid,text,jsonb,jsonb)",
      "marketing_geo_generation_input_current(uuid,uuid,jsonb)",
    ]) {
      expect(
        (
          await db.query(
            "select has_function_privilege('anon',$1,'execute') as anon,has_function_privilege('authenticated',$1,'execute') as browser,has_function_privilege('service_role',$1,'execute') as service",
            [`public.${signature}`],
          )
        ).rows[0],
      ).toEqual({ anon: false, browser: false, service: false });
      const config = (
        await db.query(
          "select proconfig from pg_proc where oid=$1::regprocedure",
          [`public.${signature}`],
        )
      ).rows[0];
      expect(config.proconfig).toEqual(
        expect.arrayContaining(['search_path=""', "TimeZone=UTC"]),
      );
    }

    const protectedTables = [
      "marketing_geo_kb_drafts",
      "marketing_geo_kb_snapshots",
      "marketing_geo_kb_prepared_candidates",
      "marketing_geo_snapshot_contexts",
    ];
    const security = (
      await db.query(
        `select c.relname,c.relrowsecurity,count(p.policyname)::int as policies
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      left join pg_policies p on p.schemaname=n.nspname and p.tablename=c.relname
      where n.nspname='public' and c.relname=any($1::text[]) group by c.relname,c.relrowsecurity order by c.relname`,
        [protectedTables],
      )
    ).rows;
    expect(security).toHaveLength(protectedTables.length);
    expect(
      security.every(
        (row) => row.relrowsecurity === true && row.policies === 0,
      ),
    ).toBe(true);

    const { f, candidate } = await publishable();
    const asRole = async (
      role: "anon" | "authenticated" | "service_role",
      operation: () => Promise<unknown>,
    ) => {
      await db.query("begin");
      try {
        await db.query(`set local role ${role}`);
        await operation();
      } finally {
        await db.query("rollback");
      }
    };
    for (const role of ["anon", "authenticated"] as const) {
      await asRole(role, async () =>
        expect(
          db.query(
            "select * from public.marketing_geo_publish_kb_v3($1,$2,$3,$4)",
            [f.userId, f.kbId, candidate, candidate.candidateHash],
          ),
        ).rejects.toThrow(/permission denied/iu),
      );
      await asRole(role, async () =>
        expect(
          db.query("select count(*) from public.marketing_geo_kb_snapshots"),
        ).rejects.toThrow(/permission denied/iu),
      );
      await asRole(role, async () =>
        expect(
          db.query(
            "select count(*) from public.marketing_geo_kb_prepared_candidates",
          ),
        ).rejects.toThrow(/permission denied/iu),
      );
    }
    await asRole("service_role", async () =>
      expect(
        db.query(
          "select outcome from public.marketing_geo_publish_kb_v3($1,$2,$3,$4)",
          [f.userId, f.kbId, candidate, candidate.candidateHash],
        ),
      ).resolves.toMatchObject({ rows: [{ outcome: "published" }] }),
    );
    await asRole("service_role", async () =>
      expect(
        db.query(
          "insert into public.marketing_geo_kb_prepared_candidates(id,user_id,kb_id,candidate_hash,candidate) values($1,$2,$3,$4,'{}'::jsonb)",
          [randomUUID(), f.userId, f.kbId, "a".repeat(64)],
        ),
      ).rejects.toThrow(/permission denied/iu),
    );
  });

  it("replays the V3 migration inside a transaction without changing a stored byte", async () => {
    const migration = readFileSync(MIGRATION, "utf8");
    const rows = async () => ({
      drafts: (
        await db.query(
          "select to_jsonb(d) as row from public.marketing_geo_kb_drafts d order by kb_id",
        )
      ).rows,
      snapshots: (
        await db.query(
          "select to_jsonb(s) as row from public.marketing_geo_kb_snapshots s order by id",
        )
      ).rows,
      contexts: (
        await db.query(
          "select to_jsonb(c) as row from public.marketing_geo_snapshot_contexts c order by snapshot_id",
        )
      ).rows,
      candidates: (
        await db.query(
          "select to_jsonb(c) as row from public.marketing_geo_kb_prepared_candidates c order by id",
        )
      ).rows,
      generations: (
        await db.query(
          "select to_jsonb(g) as row from public.marketing_geo_kb_generations g order by id",
        )
      ).rows,
    });
    const before = await rows();
    expect(before.snapshots.length).toBeGreaterThan(0);
    expect(before.drafts.length).toBeGreaterThan(0);
    await db.query(
      "create schema if not exists app; create table if not exists app.geo_kb_v3_sentinel(value text primary key); insert into app.geo_kb_v3_sentinel values('untouched') on conflict do nothing",
    );
    await db.query("begin");
    await db.query(migration);
    await db.query("rollback");
    expect(await rows()).toEqual(before);
    expect(
      (await db.query("select value from app.geo_kb_v3_sentinel")).rows,
    ).toEqual([{ value: "untouched" }]);
  });

  it("replays the V3 migration twice and keeps every constraint and stored byte identical", async () => {
    const migration = readFileSync(MIGRATION, "utf8");
    const constraints = async () =>
      (
        await db.query(`select conrelid::regclass::text as table_name,conname,pg_get_constraintdef(oid) as definition
      from pg_constraint where connamespace='public'::regnamespace order by table_name,conname`)
      ).rows;
    const snapshots = async () =>
      (
        await db.query(
          "select to_jsonb(s) as row from public.marketing_geo_kb_snapshots s order by id",
        )
      ).rows;
    const before = await constraints(),
      beforeRows = await snapshots();
    await db.query(migration);
    await db.query(migration);
    expect(await constraints()).toEqual(before);
    expect(await snapshots()).toEqual(beforeRows);

    // The V3 rules survive the replay rather than being reverted by it.
    const definitions = Object.fromEntries(
      (await constraints()).map((row) => [row.conname, row.definition]),
    );
    expect(definitions.marketing_geo_kb_drafts_schema_version_check).toContain(
      "marketing-geo-kb.v3",
    );
    expect(
      definitions.marketing_geo_kb_snapshots_schema_version_check,
    ).toContain("marketing-geo-kb.v3");
    expect(definitions.marketing_geo_snapshot_v2_requires_prepared).toContain(
      "marketing-geo-kb.v3",
    );
    expect(definitions.marketing_geo_snapshot_contexts_context_check).toContain(
      "marketing-geo-snapshot-context.v3",
    );
    expect(
      definitions.marketing_geo_kb_prepared_candidates_candidate_check,
    ).toContain("marketing-geo-prepared-candidate.v3");
    expect(definitions.marketing_geo_kb_generations_result_check).toContain(
      "marketing-geo-question-generation-result.v1",
    );
    expect(definitions.marketing_geo_kb_generations_result_check).toContain(
      "marketing-geo-knowledge-generation-result.v2",
    );
    expect(definitions.marketing_geo_draft_v3_shape).toContain("profileCopy");
    expect(definitions.marketing_geo_kb_drafts_payload_check).toContain(
      "1048576",
    );
    expect(definitions.marketing_geo_kb_snapshots_payload_check).toContain(
      "524288",
    );
    expect(
      definitions.marketing_geo_kb_prepared_candidates_generation_id_key,
    ).toBeUndefined();

    const columns = (
      await db.query(`select column_name,is_nullable from information_schema.columns
      where table_schema='public' and ((table_name='marketing_geo_kb_snapshots' and column_name in ('question_set','question_set_hash'))
        or (table_name='marketing_geo_kb_prepared_candidates' and column_name='generation_id')) order by column_name`)
    ).rows;
    expect(columns).toEqual([
      { column_name: "generation_id", is_nullable: "YES" },
      { column_name: "question_set", is_nullable: "YES" },
      { column_name: "question_set_hash", is_nullable: "YES" },
    ]);
  });
});
