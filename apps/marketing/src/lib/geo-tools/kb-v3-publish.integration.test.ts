// @input -- only a named loopback disposable Marketing database and synthetic values
// @output -- proof that the v3 TypeScript contracts and marketing_geo_publish_kb_v3 agree
// @pos -- real SQL tests, never a provider or production invocation

/**
 * The test whose absence let a whole broken publish path land green.
 *
 * Every v3 unit test builds a candidate with the TypeScript contracts and hands
 * it to a fake store; every SQL test that exists builds JSON by hand and hands
 * it to the RPC. Neither ever put the two together, so four independent shape
 * disagreements between `kb-prepared-v3-contract.ts` / `snapshot-context-v3.ts`
 * and `marketing_geo_publish_kb_v3` all survived: the RPC demanded two context
 * fields the contract does not produce, read the question set as a bare object
 * where the contract carries a discriminated slot, hashed the slot rather than
 * the set inside it, and never compared the candidate to the draft it claimed
 * to publish. No v3 version could be published or read back at all.
 *
 * So this file builds the candidate exactly the way the publish route does --
 * the same sweep, the same pack assembler, the same context builder, the same
 * `createGeoPreparedCandidateV3` -- calls the real function, and re-parses what
 * comes back out of the tables with the same parsers a reader would use.
 */
import { randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectFreshMarketingSchema } from "../credits/sql-test-harness.ts";
import { assertGeoItemKeyIntegrity } from "./kb-item-key.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { questionSetV2 } from "./kb-v2.test-fixtures.ts";
import { buildGeoKnowledgePackV3 } from "./kb-knowledge-pack-v3.ts";
import { parseGeoKnowledgePackV2 } from "./kb-knowledge-pack-v2-contract.ts";
import { parseGeoQuestionSetV2 } from "./kb-question-set-v2.ts";
import {
  createGeoPreparedCandidateV3,
  geoReviewHashV3,
  parseGeoPreparedCandidateV3,
  type GeoCandidateQuestionSetV3,
} from "./kb-prepared-v3-contract.ts";
import { geoV3ItemContentHashes } from "./kb-v3-item-content.ts";
import {
  applyGeoV3ReviewAction,
  geoV3DecisionStates,
  geoV3PendingKeys,
  materializeGeoV3Review,
} from "./kb-v3-review.ts";
import {
  geoV3ItemKeys,
  geoV3Items,
  parseGeoKbPayloadV3,
  type GeoKbPayloadV3,
} from "./kb-v3-contract.ts";
import {
  GEO_ABSENT_QUESTION_SET_HASH,
  buildGeoSnapshotContextV3,
  parseGeoSnapshotContextV3,
} from "./snapshot-context-v3.ts";
import { completePayloadV3 } from "./kb-v3.test-fixtures.ts";
import {
  buildGeoKnowledgeGenerationResultV2,
  type GeoKnowledgeSynthesisInputV2,
} from "./kb-knowledge-synthesis-v2-contract.ts";
import {
  V2_GENERATION_ID,
  V2_GENERATION_INPUT_HASH,
  V2_HASH,
  V2_KB_ID,
  geoV2EvidenceFixture,
  geoV2NarrativeFixture,
  geoV2SynthesisInputFixture,
} from "./kb-knowledge-synthesis-v2-fixtures.ts";

let db: Client;
beforeAll(async () => {
  db = await connectFreshMarketingSchema();
});
afterAll(async () => {
  await db?.end();
});

const NOW = "2026-09-07T00:00:00.000Z";

interface Fixture {
  readonly userId: string;
  readonly kbId: string;
  readonly websiteId: string;
  readonly payload: GeoKbPayloadV3;
  readonly draftVersion: number;
  readonly draftHash: string;
}

/** A kb, its website and one v3 draft, inserted as owner-admin setup. */
async function fixture(payload = completePayloadV3()): Promise<Fixture> {
  const userId = randomUUID();
  const websiteId = randomUUID();
  const upserted = await db.query(
    "select * from public.marketing_geo_upsert_kb($1,'https://example.com','example.com','example.com')",
    [userId],
  );
  const kbId = upserted.rows[0].kb_id as string;
  await db.query(
    "insert into public.marketing_websites(id,user_id,canonical_site_key,origin,submitted_url,host) values($1,$2,'example.com','https://example.com','https://example.com','example.com')",
    [websiteId, userId],
  );
  const draftHash = geoV2Digest(payload);
  await db.query(
    "insert into public.marketing_geo_kb_drafts(kb_id,user_id,schema_version,draft_version,payload,content_hash) values($1,$2,'marketing-geo-kb.v3',1,$3,$4)",
    [kbId, userId, payload, draftHash],
  );
  return { userId, kbId, websiteId, payload, draftVersion: 1, draftHash };
}

/**
 * The publish route's own assembly, minus the HTTP and the store. Kept in this
 * order deliberately: the sweep changes the payload, so the draft hash the
 * candidate names has to be the hash of the swept payload, which is why the
 * route saves before it publishes.
 */
function buildCandidate(
  f: Fixture,
  options: {
    readonly questionSet?: GeoCandidateQuestionSetV3;
    readonly candidateId?: string;
    readonly baseDraftVersion?: string;
    readonly baseDraftHash?: string;
  } = {},
) {
  const questionSet: GeoCandidateQuestionSetV3 = options.questionSet ?? {
    status: "available",
    value: questionSetV2(),
  };
  assertGeoItemKeyIntegrity(geoV3Items(f.payload.knowledge));
  const states = geoV3DecisionStates(f.payload.review, geoV3ItemKeys(f.payload.knowledge));
  const pending = geoV3PendingKeys(states);
  const swept =
    pending.length === 0 ? states : applyGeoV3ReviewAction(states, { kind: "accept_all", itemKeys: pending });
  const review = materializeGeoV3Review(f.payload.review, swept, {
    contentHash: geoV3ItemContentHashes(f.payload.knowledge),
    decidedAt: NOW,
    baseDraftVersion: String(f.draftVersion),
  });
  const payload = parseGeoKbPayloadV3({ ...f.payload, review });
  const set = questionSet.status === "available" ? questionSet.value : null;
  const candidate = createGeoPreparedCandidateV3({
    schemaVersion: "marketing-geo-prepared-candidate.v3",
    candidateId: options.candidateId ?? randomUUID(),
    kbId: f.kbId,
    baseDraftVersion: options.baseDraftVersion ?? String(f.draftVersion),
    baseDraftHash: options.baseDraftHash ?? geoV2Digest(payload),
    payload,
    questionSet,
    context: buildGeoSnapshotContextV3({ kbId: f.kbId, payload, questionSet: set, evidenceRefs: [] }),
    knowledgePack:
      payload.knowledge === null
        ? null
        : buildGeoKnowledgePackV3({ generatedAt: NOW, payload, questionSet: set, bulkAcceptedAt: NOW }),
    generationInputHash: payload.runRef.generationInputHash,
    reviewHash: geoReviewHashV3(payload),
    sourceReceiptRefs: [],
  });
  return { candidate, payload };
}

/**
 * The draft the route saves before publishing. Without it the payload the
 * candidate names is not the payload in the table, and the new draft CAS -- the
 * whole point of `baseDraftHash` -- would refuse the publish.
 */
async function saveSweptDraft(f: Fixture, payload: GeoKbPayloadV3): Promise<Fixture> {
  const hash = geoV2Digest(payload);
  if (hash === f.draftHash) return f;
  const row = (
    await db.query(
      "select * from public.marketing_geo_save_kb_draft($1,$2,'marketing-geo-kb.v3',$3,$4,$5)",
      [f.userId, f.kbId, payload, hash, f.draftVersion],
    )
  ).rows[0];
  expect(row.outcome).toBe("saved");
  return { ...f, payload, draftVersion: row.draft_version as number, draftHash: row.content_hash as string };
}

async function publish(f: Fixture, candidate: ReturnType<typeof buildCandidate>["candidate"]) {
  return (
    await db.query("select * from public.marketing_geo_publish_kb_v3($1,$2,$3,$4)", [
      f.userId,
      f.kbId,
      candidate,
      candidate.candidateHash,
    ])
  ).rows[0];
}

/**
 * The full round trip, in the route's order: sweep, save the swept draft, then
 * build the candidate against the version the save returned. Building first and
 * publishing after the save would name a draft version that no longer exists,
 * which is precisely what the new CAS refuses.
 *
 * The second `buildCandidate` is not wasted work: `materializeGeoV3Review`
 * keeps a decision it already made, so re-sweeping an already-swept payload
 * returns the same bytes and only the draft coordinates change.
 */
async function publishFixture(f: Fixture, options: Parameters<typeof buildCandidate>[1] = {}) {
  const swept = buildCandidate(f, options);
  const saved = await saveSweptDraft(f, swept.payload);
  const built = buildCandidate(saved, options);
  expect(geoV2Digest(built.payload)).toBe(saved.draftHash);
  return { ...built, fixture: saved, row: await publish(saved, built.candidate) };
}

describe("marketing_geo_publish_kb_v3 against the v3 TypeScript contracts", () => {
  it("publishes a candidate the contracts produced, and reads back what the contracts parse", async () => {
    const f = await fixture();
    const { row, candidate, fixture: saved } = await publishFixture(f);

    expect(row.outcome).toBe("published");
    expect(row.reused_existing).toBe(false);
    expect(row.revision).toBe(1);
    expect(row.content_hash).toBe(candidate.baseDraftHash);

    const snapshot = (
      await db.query(
        "select s.*, c.context from public.marketing_geo_kb_snapshots s join public.marketing_geo_snapshot_contexts c on c.snapshot_id=s.id where s.id=$1",
        [row.snapshot_id],
      )
    ).rows[0];

    expect(snapshot.schema_version).toBe("marketing-geo-kb.v3");
    expect(snapshot.prepared_id).toBe(candidate.candidateId);

    // Everything that came back out of the tables has to satisfy the same
    // parsers a reader uses. A stored shape no parser accepts is a version
    // nobody can open.
    const storedPayload = parseGeoKbPayloadV3(snapshot.payload);
    expect(geoV2Digest(storedPayload)).toBe(snapshot.content_hash);

    const storedContext = parseGeoSnapshotContextV3(snapshot.context);
    expect(storedContext.payloadHash).toBe(snapshot.content_hash);
    expect(storedContext.kbId).toBe(saved.kbId);

    // The question set is stored as the question set, not as the slot that
    // carried it across the wire.
    const storedQuestionSet = parseGeoQuestionSetV2(snapshot.question_set);
    expect(storedQuestionSet.schemaVersion).toBe("marketing-geo-question-set.v2");
    expect(snapshot.question_set_hash).toBe(geoV2Digest(storedQuestionSet));
    expect(storedContext.questionSetHash).toBe(snapshot.question_set_hash);

    // And the candidate the database kept still parses as a candidate.
    const storedCandidate = (
      await db.query("select candidate from public.marketing_geo_kb_prepared_candidates where id=$1", [
        candidate.candidateId,
      ])
    ).rows[0].candidate;
    expect(parseGeoPreparedCandidateV3(storedCandidate).candidateHash).toBe(candidate.candidateHash);
    if (storedCandidate.knowledgePack !== null) {
      expect(parseGeoKnowledgePackV2(storedCandidate.knowledgePack).schemaVersion).toBe(
        "marketing-geo-knowledge-pack.v2",
      );
    }
  });

  it("publishes without a question set and records its absence as absence, not as zero", async () => {
    const f = await fixture();
    const { row, candidate } = await publishFixture(f, {
      questionSet: { status: "unavailable", reason: "roles_missing", failedGenerationId: null },
    });

    expect(row.outcome).toBe("published");
    const snapshot = (
      await db.query(
        "select s.question_set, s.question_set_hash, c.context from public.marketing_geo_kb_snapshots s join public.marketing_geo_snapshot_contexts c on c.snapshot_id=s.id where s.id=$1",
        [row.snapshot_id],
      )
    ).rows[0];
    expect(snapshot.question_set).toBeNull();
    expect(snapshot.question_set_hash).toBeNull();
    // The context still states a hash, and it is the documented "no set at all"
    // value rather than a hash of something empty.
    expect(parseGeoSnapshotContextV3(snapshot.context).questionSetHash).toBe(GEO_ABSENT_QUESTION_SET_HASH);
    expect(candidate.context.questionSetHash).toBe(GEO_ABSENT_QUESTION_SET_HASH);
  });

  it("reuses the existing version when the same knowledge is published twice", async () => {
    const f = await fixture();
    const first = await publishFixture(f);
    expect(first.row.outcome).toBe("published");

    // A second publish of identical content mints a fresh candidate id, exactly
    // as a double-clicked publish would.
    const second = buildCandidate(first.fixture, { candidateId: randomUUID() });
    expect(second.candidate.candidateId).not.toBe(first.candidate.candidateId);
    const row = await publish(first.fixture, second.candidate);

    expect(row.outcome).toBe("published");
    expect(row.reused_existing).toBe(true);
    expect(row.snapshot_id).toBe(first.row.snapshot_id);
    expect(row.revision).toBe(first.row.revision);
    expect(
      (await db.query("select count(*)::int as n from public.marketing_geo_kb_snapshots where kb_id=$1", [f.kbId]))
        .rows[0].n,
    ).toBe(1);
  });

  it("refuses a candidate built against a draft that has since moved", async () => {
    const f = await fixture();
    const built = buildCandidate(f);
    const saved = await saveSweptDraft(f, built.payload);
    const candidate = buildCandidate(saved).candidate;

    // Someone else saves the draft between assembly and publish. The content
    // is byte-identical and only the version moves, which is exactly the case a
    // payload hash alone cannot see -- and the case the old guard, which
    // compared baseDraftHash with the candidate's own payload, called fine.
    const bumped = (
      await db.query("select * from public.marketing_geo_save_kb_draft($1,$2,'marketing-geo-kb.v3',$3,$4,$5)", [
        saved.userId,
        saved.kbId,
        saved.payload,
        saved.draftHash,
        saved.draftVersion,
      ])
    ).rows[0];
    expect(bumped.outcome).toBe("saved");
    expect(bumped.draft_version).toBe(saved.draftVersion + 1);
    expect(bumped.content_hash).toBe(saved.draftHash);

    expect((await publish(saved, candidate)).outcome).toBe("input_stale");
    expect(
      (await db.query("select count(*)::int as n from public.marketing_geo_kb_snapshots where kb_id=$1", [f.kbId]))
        .rows[0].n,
    ).toBe(0);

    // Not a broken candidate: the same knowledge, rebuilt against the version
    // the draft is actually on, publishes.
    const current = { ...saved, draftVersion: bumped.draft_version as number };
    expect((await publish(current, buildCandidate(current).candidate)).outcome).toBe("published");
  });

  /**
   * A slot carrying a field the RPC does not read is the one shape that can
   * make the frozen record state something the wire did not carry: an
   * `unavailable` slot that also holds a real question set publishes with
   * `question_set` NULL, so the version says it has no questions while the
   * candidate that produced it did. `questionSetSlotSchema` is `.strict()`, so
   * the contract already refuses it -- but "the only writer is well-behaved"
   * is not a property the stored record can rely on.
   */
  it("refuses a question-set slot carrying a key its own shape does not have", async () => {
    const absent = { status: "unavailable", reason: "roles_missing", failedGenerationId: null } as const;

    // Each case is built from a candidate whose *own* slot has the same
    // availability, so `context.questionSetHash` already matches what the RPC
    // will expect. Otherwise the hash guard fires first and the key pin is
    // never reached -- which is exactly how the first version of this test
    // passed while one of the two pins did nothing at all.
    for (const [name, base, slot] of [
      ["unavailable slot smuggling a question set",
        { status: "unavailable" as const, reason: "roles_missing" as const, failedGenerationId: null },
        { ...absent, value: questionSetV2() }],
      ["unavailable slot missing failedGenerationId",
        { status: "unavailable" as const, reason: "roles_missing" as const, failedGenerationId: null },
        { status: "unavailable", reason: "roles_missing" }],
      ["available slot with a stray field",
        { status: "available" as const, value: questionSetV2() },
        { status: "available", value: questionSetV2(), reason: "roles_missing" }],
    ] as const) {
      // A fresh knowledge base per case: the control publish below moves the
      // draft, and a shared fixture would make the next case conflict instead
      // of reaching the guard it is about.
      const f = await fixture();
      const built = buildCandidate(f, { questionSet: base });
      const saved = await saveSweptDraft(f, built.payload);
      const { candidate } = buildCandidate(saved, { questionSet: base });
      const { candidateHash: _drop, ...body } = { ...candidate, questionSet: slot };
      const hash = geoV2Digest(body);
      const row = (
        await db.query("select * from public.marketing_geo_publish_kb_v3($1,$2,$3,$4)", [
          saved.userId, saved.kbId, { ...body, candidateHash: hash }, hash,
        ])
      ).rows[0];
      expect(row.outcome, name).toBe("candidate_mismatch");
      // Proof the case reached the key pin rather than dying earlier: the same
      // candidate with its own untouched slot publishes.
      expect((await publish(saved, candidate)).outcome, `${name} (control)`).toBe("published");
    }
  });

  it("refuses a candidate whose context was edited after it was hashed", async () => {
    const f = await fixture();
    const built = buildCandidate(f);
    const saved = await saveSweptDraft(f, built.payload);
    const { candidate } = buildCandidate(saved);

    // A context field the contract does not police at the wire, rewritten in
    // transit. The candidate hash still matches, so only the database's own
    // re-derivation can catch it.
    const tampered = {
      ...candidate,
      context: { ...candidate.context, targetHost: "attacker.example" },
    };
    const rehashed = { ...tampered, candidateHash: undefined };
    delete (rehashed as { candidateHash?: unknown }).candidateHash;
    const hash = geoV2Digest(rehashed);
    expect(
      (
        await db.query("select * from public.marketing_geo_publish_kb_v3($1,$2,$3,$4)", [
          saved.userId,
          saved.kbId,
          { ...rehashed, candidateHash: hash },
          hash,
        ])
      ).rows[0].outcome,
    ).toBe("candidate_mismatch");
  });

  it("locks generationInput once a paid generation exists, on the three-call flow that has no runId", async () => {
    const rolesGenerationId = randomUUID();
    const base = completePayloadV3();
    const payload = parseGeoKbPayloadV3({
      ...base,
      runRef: { ...base.runRef, runId: null, rolesGenerationId },
    });
    const f = await fixture(payload);

    // Same payload, a different generation input, so a different locked hash.
    const changed = parseGeoKbPayloadV3({
      ...payload,
      generationInput: {
        ...payload.generationInput,
        identity: { ...payload.generationInput.identity, officialName: "Acme Two" },
      },
    });
    const relocked = parseGeoKbPayloadV3({
      ...changed,
      runRef: { ...changed.runRef, generationInputHash: geoV2Digest(changed.generationInput) },
    });

    const row = (
      await db.query("select * from public.marketing_geo_save_kb_draft($1,$2,'marketing-geo-kb.v3',$3,$4,$5)", [
        f.userId,
        f.kbId,
        relocked,
        geoV2Digest(relocked),
        f.draftVersion,
      ])
    ).rows[0];
    expect(row.outcome).toBe("generation_input_locked");
    expect(
      (await db.query("select content_hash from public.marketing_geo_kb_drafts where kb_id=$1", [f.kbId])).rows[0]
        .content_hash,
    ).toBe(f.draftHash);

    // The lock has a release, and it is the only one: the same save that
    // re-locks a new input must abandon the generations the old one paid for.
    // Without this the second update of any knowledge base would be refused
    // forever by ids left over from the first.
    const released = parseGeoKbPayloadV3({
      ...relocked,
      runRef: { ...relocked.runRef, rolesGenerationId: null },
    });
    const freed = (
      await db.query("select * from public.marketing_geo_save_kb_draft($1,$2,'marketing-geo-kb.v3',$3,$4,$5)", [
        f.userId,
        f.kbId,
        released,
        geoV2Digest(released),
        f.draftVersion,
      ])
    ).rows[0];
    expect(freed.outcome).toBe("saved");
    expect(freed.content_hash).toBe(geoV2Digest(released));
    expect(released.runRef.generationInputHash).not.toBe(payload.runRef.generationInputHash);
  });

  it("still refuses a new input that keeps any one of the run's generation ids", async () => {
    const base = completePayloadV3();
    const changed = parseGeoKbPayloadV3({
      ...base,
      generationInput: {
        ...base.generationInput,
        identity: { ...base.generationInput.identity, officialName: "Acme Two" },
      },
    });
    // One id at a time: a release that only had to clear `runId` would leave
    // three ways to carry a stale generation into a new input.
    for (const id of ["runId", "rolesGenerationId", "knowledgeGenerationId", "questionsGenerationId"] as const) {
      const held = randomUUID();
      const f = await fixture(parseGeoKbPayloadV3({ ...base, runRef: { ...base.runRef, [id]: held } }));
      const relocked = parseGeoKbPayloadV3({
        ...changed,
        runRef: {
          ...changed.runRef,
          [id]: held,
          generationInputHash: geoV2Digest(changed.generationInput),
        },
      });
      const row = (
        await db.query("select * from public.marketing_geo_save_kb_draft($1,$2,'marketing-geo-kb.v3',$3,$4,$5)", [
          f.userId, f.kbId, relocked, geoV2Digest(relocked), f.draftVersion,
        ])
      ).rows[0];
      expect(row.outcome, id).toBe("generation_input_locked");
    }
  });
});

/**
 * `marketing_geo_knowledge_result_valid` pins the top-level key counts of the
 * parts it stores, so an immutable result cannot carry a field nobody checked.
 * The V2 branch had dropped the narrative pin on the premise that narrative V2
 * has a different key count from V1; it does not -- the triple-shaped facts and
 * canonicalQuestion that premise names are nested inside `facts[]` and `qa[]`.
 *
 * These tests derive the numbers from the real builders rather than restating
 * them, so a future field added to either part fails here instead of silently
 * widening what the database will store.
 */
describe("marketing_geo_knowledge_result_valid pins the V2 result shape", () => {
  function v2Result(overrides: { readonly narrative?: unknown; readonly synthesisInput?: unknown } = {}) {
    const synthesisInput: GeoKnowledgeSynthesisInputV2 = geoV2SynthesisInputFixture();
    const manifest = {
      schemaVersion: "marketing-geo-knowledge-generation-input.v2",
      kbId: V2_KB_ID,
      baseDraftVersion: "4",
      baseDraftHash: V2_HASH,
      generationInputHash: V2_GENERATION_INPUT_HASH,
      sourceReceiptRefs: [],
      knowledgeSynthesisInput: synthesisInput,
    };
    const result = buildGeoKnowledgeGenerationResultV2({
      schemaVersion: "marketing-geo-knowledge-generation-result.v2",
      generationId: V2_GENERATION_ID,
      kbId: V2_KB_ID,
      manifest,
      synthesisInput,
      evidence: geoV2EvidenceFixture(),
      narrative: geoV2NarrativeFixture(),
      generatedAt: "2026-09-04T08:00:00.000Z",
    });
    const inputHash = geoV2Digest({ kind: "knowledge_pack", input: manifest });
    return { manifest, inputHash, result: { ...result, ...overrides } };
  }

  async function valid(built: ReturnType<typeof v2Result>): Promise<boolean> {
    return (
      await db.query(
        "select public.marketing_geo_knowledge_result_valid($1,$2,$3,$4,$5) as ok",
        [V2_KB_ID, V2_GENERATION_ID, built.inputHash, built.manifest, built.result],
      )
    ).rows[0].ok as boolean;
  }

  it("accepts the result the V2 builders actually produce", async () => {
    expect(await valid(v2Result())).toBe(true);
  });

  it("refuses a narrative carrying a top-level key the contract does not have", async () => {
    const narrative = { ...geoV2NarrativeFixture(), extra: "smuggled" };
    expect(Object.keys(narrative)).toHaveLength(Object.keys(geoV2NarrativeFixture()).length + 1);
    expect(await valid(v2Result({ narrative }))).toBe(false);
  });

  it("refuses a synthesis input carrying a top-level key the contract does not have", async () => {
    const synthesisInput = { ...geoV2SynthesisInputFixture(), extra: "smuggled" };
    expect(await valid(v2Result({ synthesisInput }))).toBe(false);
  });

  it("pins the numbers this migration hard-codes to what the contracts produce", () => {
    // If either of these fails, the SQL literal is wrong, not the test: fix the
    // migration to match, never the other way round.
    expect(Object.keys(geoV2NarrativeFixture())).toHaveLength(6);
    expect(Object.keys(geoV2SynthesisInputFixture())).toHaveLength(14);
  });
});
