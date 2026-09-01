import { describe, expect, it } from "vitest";
import { ROLE_SYNTHESIS_INPUT, ROLE_SYNTHESIS_OUTPUT } from "./kb-synthesis-fixtures.ts";
import { createGeoRoleProposal, parseGeoRoleProposal, resolveGeoModelRoleLineage } from "./kb-role-proposal.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";

const ID = "11111111-1111-4111-8111-111111111111";
const KB = "22222222-2222-4222-8222-222222222222";
const hash = "a".repeat(64);
const body = () => ({ generationId: ID, kbId: KB, baseDraftVersion: "2", baseDraftHash: hash, profileCopyHash: hash,
  input: ROLE_SYNTHESIS_INPUT, output: ROLE_SYNTHESIS_OUTPUT, sourceReceiptRefs: [],
  availableEvidenceCounts: { profile: 1, gsc: 1, crawl: 0, manual: 0 }, selectedEvidenceCounts: { profile: 1, gsc: 1, crawl: 0, manual: 0 },
});
const role = () => ({ ...ROLE_SYNTHESIS_OUTPUT.roles[0]!, review: "accepted" as const, source: { kind: "model" as const, generationId: ID, itemId: "finance", evidenceRefs: ["P1", "G1"] } });

describe("immutable source-grounded role proposal", () => {
  it("round-trips the exact input/output and rejects altered stored bytes", () => {
    const proposal = createGeoRoleProposal(body());
    expect(parseGeoRoleProposal(proposal)).toEqual(proposal);
    expect(() => parseGeoRoleProposal({ ...proposal, baseDraftVersion: "3" })).toThrow();
    const { contentHash: _hash, ...original } = proposal;
    expect(geoV2Digest(original)).toBe(proposal.contentHash);
  });
  it("checks source and numeric evidence on stored model proposals too", () => {
    expect(() => createGeoRoleProposal({ ...body(), output: { ...ROLE_SYNTHESIS_OUTPUT, roles: [{ ...ROLE_SYNTHESIS_OUTPUT.roles[0]!, evidenceRefs: ["invented"] }] } })).toThrow();
    expect(() => createGeoRoleProposal({ ...body(), selectedEvidenceCounts: { profile: 2, gsc: 0, crawl: 0, manual: 0 } })).toThrow();
  });
  it("retains exact lineage after reviewed wording changes and records that it was edited", () => {
    const proposal = createGeoRoleProposal(body());
    const first = resolveGeoModelRoleLineage({ kbId: KB, profileCopyHash: hash, officialName: "Acme", language: "en-US", roles: [role()], proposals: [proposal] });
    expect(first.userEdited.finance).toBe(false);
    const edited = resolveGeoModelRoleLineage({ kbId: KB, profileCopyHash: hash, officialName: "Acme", language: "en-US", roles: [{ ...role(), label: "已人工修订的角色" }], proposals: [proposal] });
    expect(edited.userEdited.finance).toBe(true);
    expect(edited.evidenceCatalog).toEqual(ROLE_SYNTHESIS_INPUT.sources);
  });
  it("rejects foreign, stale-copy and forged evidence references rather than relabeling manual", () => {
    const proposal = createGeoRoleProposal(body());
    const base = { kbId: KB, profileCopyHash: hash, officialName: "Acme", language: "en-US", roles: [role()], proposals: [proposal] };
    expect(() => resolveGeoModelRoleLineage({ ...base, kbId: ID })).toThrow();
    expect(() => resolveGeoModelRoleLineage({ ...base, profileCopyHash: "b".repeat(64) })).toThrow();
    expect(() => resolveGeoModelRoleLineage({ ...base, roles: [{ ...role(), source: { ...role().source, evidenceRefs: ["P1"] } }] })).toThrow();
    expect(() => resolveGeoModelRoleLineage({ ...base, proposals: [] })).toThrow();
  });
});
