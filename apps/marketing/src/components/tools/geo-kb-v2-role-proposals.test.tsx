// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { completePayloadV2, V2_CANDIDATE_ID, V2_KB_ID } from "../../lib/geo-tools/kb-v2.test-fixtures.ts";
import { ROLE_SYNTHESIS_INPUT, ROLE_SYNTHESIS_OUTPUT } from "../../lib/geo-tools/kb-synthesis-fixtures.ts";
import { createGeoRoleProposal } from "../../lib/geo-tools/kb-role-proposal.ts";
import { geoKbV2Copy } from "./geo-kb-v2-copy.ts";
import { GeoKbV2RoleProposals } from "./geo-kb-v2-sources.tsx";

// Ids a person could never look up, so an assertion that they are absent is
// about the identifiers themselves and not about a short fixture string that
// happens to occur in prose.
const PROFILE_REF = "3f6a9a30-16b3-4c1a-9b7f-1d0f4a2c8e51";
const GSC_REF = "b2c5d7e1-9a44-4f0c-8f31-77a2c6e4b019";
const proposal = createGeoRoleProposal({
  generationId: V2_CANDIDATE_ID, kbId: V2_KB_ID, baseDraftVersion: "0", baseDraftHash: "a".repeat(64), profileCopyHash: "b".repeat(64),
  input: { ...ROLE_SYNTHESIS_INPUT, sources: ROLE_SYNTHESIS_INPUT.sources.map((source, index) => ({ ...source, id: index === 0 ? PROFILE_REF : GSC_REF })) },
  output: { ...ROLE_SYNTHESIS_OUTPUT, roles: ROLE_SYNTHESIS_OUTPUT.roles.map(role => ({ ...role, evidenceRefs: [PROFILE_REF, GSC_REF] })), categoryTerms: ROLE_SYNTHESIS_OUTPUT.categoryTerms.map(term => ({ ...term, evidenceRefs: [PROFILE_REF, GSC_REF] })) },
  sourceReceiptRefs: [], selectedEvidenceCounts: { profile: 1, gsc: 1, crawl: 0, manual: 0 }, availableEvidenceCounts: { profile: 4, gsc: 9, crawl: 2, manual: 0 },
});
const c = geoKbV2Copy("en");
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render() {
  await act(async () => root.render(<GeoKbV2RoleProposals proposal={proposal} payload={completePayloadV2()} locale="en" stale={false} onAdopt={() => {}} />));
}

describe("saved role proposals", () => {
  it("says what each role was built from instead of listing the row ids", async () => {
    await render();
    const basis = host.querySelector(`[data-role-basis="${proposal.output.roles[0]!.id}"]`)?.textContent ?? "";
    // Two references, from the Profile and from Search Console. The refs are
    // row ids in this proposal's own source list; a role carries dozens.
    expect(basis).toContain("2");
    expect(basis).toContain(c.roleEvidence.basis.profile);
    expect(basis).toContain(c.roleEvidence.basis.gsc);
    expect(basis).not.toContain(PROFILE_REF);
    expect(host.textContent).not.toContain(PROFILE_REF);
    expect(host.textContent).not.toContain(GSC_REF);
  });
  it("does not print the record's own identity at a person", async () => {
    await render();
    // The generation id and the content hash identify the record for the
    // server. Nothing on this panel is addressed by them.
    expect(host.textContent).not.toContain(proposal.generationId);
    expect(host.textContent).not.toContain(proposal.contentHash);
    expect(host.textContent).not.toContain(proposal.baseDraftHash);
  });
  it("reads the evidence counts out per kind rather than as JSON", async () => {
    await render();
    expect(host.textContent).not.toContain('{"profile"');
    expect(host.textContent).not.toContain("[object Object]");
    const counts = host.querySelector('[data-evidence-count="gsc"]')?.textContent ?? "";
    expect(counts).toContain(c.sources.gsc);
    // Selected against available: 1 of the 9 Search Console rows were used.
    expect(counts).toContain("1 / 9");
    expect(host.querySelector('[data-evidence-count="profile"]')?.textContent).toContain("1 / 4");
  });
  it("keeps the evidence itself readable, without its row id", async () => {
    await render();
    const raw = host.querySelector("details")?.textContent ?? "";
    expect(raw).toContain(c.sources.gsc);
    expect(raw).toContain("invoice reminder software with audit trails");
    expect(raw).not.toContain(GSC_REF);
  });
});
