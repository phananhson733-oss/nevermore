// @input -- persisted semantic role output, exact prompt basis and its source identities
// @output -- immutable review proposal; edited roles keep their original evidence lineage
// @pos -- server validation for applying/reusing model proposals, never manual approval
import { z } from "zod";
import { parseGeoRoleSynthesis, parseGeoRoleSynthesisInput, type GeoRoleSynthesisInput, type GeoRoleSynthesis, type GeoSynthesisSource } from "./kb-synthesis-contract.ts";
import { GEO_ROLE_SYNTHESIS_PROMPT_VERSION } from "./kb-synthesis.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { canonicalGeoV2Text, geoV2JsonbBytes } from "./kb-v2-json.ts";
import type { GeoKbRoleV2 } from "./kb-v2-contract.ts";
import type { GeoEvidenceCounts } from "./kb-synthesis-input.ts";
import type { GeoSourceReceiptRef } from "./snapshot-context-v2.ts";

export const GEO_ROLE_PROPOSAL_SCHEMA = "marketing-geo-role-proposal.v1" as const;
export interface GeoRoleProposalInput {
  readonly generationId: string; readonly kbId: string;
  readonly baseDraftVersion: string; readonly baseDraftHash: string; readonly profileCopyHash: string;
  readonly input: GeoRoleSynthesisInput; readonly output: GeoRoleSynthesis;
  readonly sourceReceiptRefs: readonly GeoSourceReceiptRef[];
  readonly selectedEvidenceCounts: GeoEvidenceCounts; readonly availableEvidenceCounts: GeoEvidenceCounts;
}
export interface GeoRoleProposal extends GeoRoleProposalInput {
  readonly schemaVersion: typeof GEO_ROLE_PROPOSAL_SCHEMA;
  readonly promptVersion: string;
  readonly contentHash: string;
}
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative().max(10_000);
const counts = z.object({ profile: count, gsc: count, crawl: count, manual: count }).strict();
const schema = z.object({ schemaVersion: z.literal(GEO_ROLE_PROPOSAL_SCHEMA), promptVersion: z.string().min(1).max(128),
  generationId: z.string().uuid(), kbId: z.string().uuid(), baseDraftVersion: z.string().regex(/^(0|[1-9]\d{0,14})$/u),
  baseDraftHash: hash, profileCopyHash: hash, input: z.unknown(), output: z.unknown(),
  sourceReceiptRefs: z.array(z.object({ receiptId: z.string().uuid(), contentHash: hash }).strict()).max(32),
  selectedEvidenceCounts: counts, availableEvidenceCounts: counts, contentHash: hash,
}).strict();

export function parseGeoRoleProposal(value: unknown): GeoRoleProposal {
  if (geoV2JsonbBytes(value) > 393_216) throw new Error("Role proposal exceeds byte limit");
  const parsed = schema.parse(value);
  const { contentHash, ...body } = parsed;
  if (geoV2Digest(body) !== contentHash) throw new Error("Role proposal hash mismatch");
  const input = parseGeoRoleSynthesisInput(parsed.input);
  if (!input.ok) throw new Error("Invalid role proposal input");
  const output = parseGeoRoleSynthesis(parsed.output, input.value);
  if (!output.ok) throw new Error("Invalid role proposal evidence/output");
  for (const kind of ["profile", "gsc", "crawl", "manual"] as const) {
    if (parsed.selectedEvidenceCounts[kind] !== input.value.sources.filter(source => source.kind === kind).length || parsed.availableEvidenceCounts[kind] < parsed.selectedEvidenceCounts[kind]) throw new Error("Invalid source selection counts");
  }
  if (new Set(parsed.sourceReceiptRefs.map(ref => ref.receiptId)).size !== parsed.sourceReceiptRefs.length) throw new Error("Duplicate source receipt");
  return { ...parsed, input: input.value, output: output.value };
}

export function createGeoRoleProposal(input: GeoRoleProposalInput): GeoRoleProposal {
  const body = { schemaVersion: GEO_ROLE_PROPOSAL_SCHEMA, promptVersion: GEO_ROLE_SYNTHESIS_PROMPT_VERSION, ...input };
  return parseGeoRoleProposal({ ...body, contentHash: geoV2Digest(body) });
}

/** Proposals must first be read from owner-scoped succeeded generation records.
 * Only refs actually used by roles are carried into the later frozen context. */
export function resolveGeoModelRoleLineage(input: {
  readonly kbId: string; readonly profileCopyHash: string; readonly officialName: string; readonly language: string;
  readonly roles: readonly GeoKbRoleV2[]; readonly proposals: readonly GeoRoleProposal[];
}): { readonly userEdited: Readonly<Record<string, boolean>>; readonly evidenceCatalog: readonly GeoSynthesisSource[]; readonly sourceReceiptRefs: readonly GeoSourceReceiptRef[] } {
  const proposals = new Map(input.proposals.map(proposal => [proposal.generationId, parseGeoRoleProposal(proposal)]));
  const evidence = new Map<string, GeoSynthesisSource>(), receipts = new Map<string, GeoSourceReceiptRef>();
  const userEdited: Record<string, boolean> = {};
  for (const role of input.roles) {
    if (role.source.kind !== "model") continue;
    const proposal = proposals.get(role.source.generationId ?? "");
    const original = proposal?.output.roles.find(item => item.id === role.source.itemId);
    if (!proposal || !original || proposal.kbId !== input.kbId || proposal.profileCopyHash !== input.profileCopyHash || proposal.input.officialName !== input.officialName || proposal.input.questionLanguage !== input.language || canonicalGeoV2Text(original.evidenceRefs) !== canonicalGeoV2Text(role.source.evidenceRefs)) throw new Error("Role proposal is missing, stale or foreign");
    const wording = (item: GeoKbRoleV2 | GeoRoleSynthesis["roles"][number]) => ({ label: item.label, questionLabel: item.questionLabel, segment: item.segment, painPoints: item.painPoints, decisionCriteria: item.decisionCriteria, alternatives: item.alternatives, vocabulary: item.vocabulary });
    userEdited[role.id] = canonicalGeoV2Text(wording(role)) !== canonicalGeoV2Text(wording(original));
    for (const source of proposal.input.sources.filter(item => role.source.evidenceRefs.includes(item.id))) {
      if (evidence.has(source.id) && canonicalGeoV2Text(evidence.get(source.id)) !== canonicalGeoV2Text(source)) throw new Error("Conflicting source identity");
      evidence.set(source.id, source);
    }
    for (const ref of proposal.sourceReceiptRefs) {
      if (receipts.has(ref.receiptId) && receipts.get(ref.receiptId)!.contentHash !== ref.contentHash) throw new Error("Conflicting receipt identity");
      receipts.set(ref.receiptId, ref);
    }
  }
  return { userEdited, evidenceCatalog: [...evidence.values()], sourceReceiptRefs: [...receipts.values()] };
}
