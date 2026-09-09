// @input -- exact immutable frozen KB, optional owner-verified context, and the published pack a v3 version carries
// @output -- fact rows and matching receipts, with inconsistent sources rejected
// @pos -- one projection for Brief generation and free input evidence summaries
import type { GeoContentBrief } from "@sf/public-tools/content-brief/geo-contract";
import type { AnyGeoKnowledgePack, AnyVersionedGeoSnapshotContext } from "./kb-complete-read.ts";
import { isGeoKbPayloadV3Value, type VersionedGeoKbFrozenSnapshot } from "./kb-versioned-read.ts";
import { GEO_KNOWLEDGE_PACK_V2_SCHEMA, type GeoKnowledgePackV2, type GeoKnowledgeSourceV2 } from "./kb-knowledge-pack-v2-contract.ts";
import type { GeoItemOrigin } from "./kb-knowledge-shape.ts";
import { GEO_SNAPSHOT_CONTEXT_SCHEMA_V3 } from "./snapshot-context-v3.ts";
import { normalizeGeoHost } from "../agents/geo-url.ts";
import { GEO_PROFILE_FACT_OVERRIDES_POLICY } from "./kb-questions.ts";

function normalizedExactText(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en");
}

/**
 * Which of the Brief's three receipt sources a published item's origin is.
 *
 * The Brief's receipt vocabulary is narrower than a pack's `origin`: it only
 * separates "read off a page" from "stated by the knowledge base" from "copied
 * from the Product Profile". `declared_profile` maps to `kb` rather than
 * `product_profile` because the Brief's `product_profile` receipts require a
 * `geo_origin.profile_ref`, and a v3 version's profile reference carries a
 * 13-field subset instead of the profile schema/hash pair that reference names.
 * Claiming one anyway would put an identifier in the Brief that points at
 * nothing. The finer origin stays where it is exact: in the published pack.
 */
const PACK_FACT_RECEIPT_SOURCE: Readonly<Record<GeoItemOrigin, "kb" | "crawl">> = {
  observed_own: "crawl",
  observed_competitor: "crawl",
  observed_third_party: "crawl",
  observed_gsc: "kb",
  declared_profile: "kb",
  declared_owner: "kb",
  synthesized: "kb",
};

function packFactRows(pack: GeoKnowledgePackV2 | null, frozenAt: string) {
  const receipts: GeoContentBrief["evidence"]["facts"] = [];
  const factTable: GeoContentBrief["fact_table"] = [];
  if (pack === null || pack.facts.status === "unavailable") return { receipts, factTable };
  const sources = new Map<string, GeoKnowledgeSourceV2>(pack.sourceCatalogue.map((source) => [source.id, source]));
  for (const [index, fact] of pack.facts.value.entries()) {
    // Competing observations are published with no value at all, and this
    // repeats that rule rather than trusting it: a value beside
    // `reason: "conflicting"` would state one page's number as settled.
    const value = fact.reason === "conflicting" ? null : fact.value;
    const receiptSource = PACK_FACT_RECEIPT_SOURCE[fact.origin];
    const id = `${receiptSource === "crawl" ? "C" : "K"}${index + 1}`;
    if (value !== null) {
      const cited = fact.sourceRefs.map((ref) => sources.get(ref));
      if (cited.some((source) => source === undefined)) throw new Error("unknown_source_reference");
      const url = cited.find((source) => source!.url !== null)?.url ?? null;
      // A crawled receipt with no URL is a page nobody can go and check.
      if (receiptSource === "crawl" && url === null) throw new Error("crawl_receipt_missing");
      receipts.push({ id, source: receiptSource, text: value, observed_at: fact.observedAt ?? fact.ownerDeclaredAt ?? frozenAt, url });
    }
    // Never 0 and never "": an unavailable value is null, and the reason it is
    // unavailable is the only thing said about it. A published fact that has no
    // value and no reason is a contract violation, not an invitation to pick a
    // plausible-sounding one.
    let reason: GeoContentBrief["fact_table"][number]["reason"] = null;
    if (value === null) {
      if (fact.reason === "") throw new Error("unavailable_fact_without_reason");
      reason = fact.reason;
    }
    factTable.push({ id: `F${index + 1}`, label: fact.label, value, reason, evidence_refs: value === null ? [] : [id] });
  }
  return { receipts, factTable };
}

export function geoBriefFactsForSnapshot(frozen: VersionedGeoKbFrozenSnapshot, context: AnyVersionedGeoSnapshotContext | null, knowledgePack: AnyGeoKnowledgePack | null) {
  if (isGeoKbPayloadV3Value(frozen.payload)) {
    // The v3 context deliberately carries no facts: an owner declaration has no
    // URL and a bulk-accepted model item has no receipt, so projecting either
    // into the immutable context would have written something untrue. The facts
    // live in exactly one place now -- the published pack.
    if (context?.schemaVersion !== GEO_SNAPSHOT_CONTEXT_SCHEMA_V3) throw new Error("complete_v3_context_required");
    if (knowledgePack !== null && knowledgePack.schemaVersion !== GEO_KNOWLEDGE_PACK_V2_SCHEMA) throw new Error("knowledge_pack_version_mismatch");
    if (context.payloadHash !== frozen.contentHash || context.kbId !== frozen.kbId
      || context.targetHost !== normalizeGeoHost(frozen.payload.generationInput.identity.targetUrl)) throw new Error("snapshot_context_mismatch");
    return packFactRows(knowledgePack, frozen.frozenAt);
  }
  if (context?.schemaVersion === GEO_SNAPSHOT_CONTEXT_SCHEMA_V3) throw new Error("snapshot_context_version_mismatch");
  // A v2 pack describes reviewed v3 items; it cannot be the fact source for a
  // payload that keeps its own fact rows, and silently ignoring it would let a
  // mispaired version publish facts nobody projected.
  if (knowledgePack?.schemaVersion === GEO_KNOWLEDGE_PACK_V2_SCHEMA) throw new Error("knowledge_pack_version_mismatch");
  if (frozen.payload.schemaVersion === "marketing-geo-kb.v2") {
    if (context?.schemaVersion !== "marketing-geo-snapshot-context.v2") throw new Error("complete_v2_context_required");
    const facts = context.facts.map(fact => {
      if (fact.value !== null && (fact.source === "none" || fact.review !== "accepted" || fact.reason !== "" || fact.sourceUrl === null || fact.observedAt === null)) throw new Error("invalid_admitted_fact");
      if (fact.source === "crawl" && fact.supportRef === null) throw new Error("crawl_receipt_missing");
      return { key: fact.key, value: fact.source === "none" ? null : fact.value, reason: fact.reason,
        source: fact.source === "crawl" ? "crawl" as const : "kb" as const, sourceUrl: fact.sourceUrl, observedAt: fact.observedAt, evidenceId: fact.supportRef?.evidenceId ?? null };
    });
    const receipts: GeoContentBrief["evidence"]["facts"] = [];
    const factTable: GeoContentBrief["fact_table"] = facts.map((fact, index) => {
      const value = fact.reason === "conflicting" ? null : fact.value;
      const id = `${fact.source === "crawl" ? "C" : "K"}${index + 1}`;
      if (value !== null) {
        if (fact.source === "crawl" && (fact.evidenceId === null || fact.sourceUrl === null || fact.observedAt === null)) throw new Error("crawl_receipt_missing");
        receipts.push({ id, source: fact.source, text: value, observed_at: fact.observedAt ?? frozen.frozenAt, url: fact.sourceUrl });
      }
      return { id: `F${index + 1}`, label: fact.key, value, reason: value === null ? fact.reason || "lowConfidence" : null, evidence_refs: value === null ? [] : [id] };
    });
    return { receipts, factTable };
  }
  if (context?.schemaVersion === "marketing-geo-snapshot-context.v2") throw new Error("snapshot_context_version_mismatch");
  if (frozen.questionSet?.schemaVersion !== "marketing-geo-question-set.v1") throw new Error("question_set_version_mismatch");
  const payload = frozen.payload;
  if (context !== null) {
    if (context.kbId !== frozen.kbId || context.payloadHash !== frozen.contentHash || context.questionSetHash !== frozen.questionSetHash || context.targetHost !== normalizeGeoHost(payload.targetUrl)) throw new Error("snapshot_context_mismatch");
    if (context.facts.length !== payload.facts.length || context.facts.some((fact, index) => {
      const stored = payload.facts[index];
      return !stored || fact.key !== stored.key || fact.value !== (stored.value || null)
        || fact.reason !== stored.reason || fact.sourceUrl !== (stored.sourceUrl || null)
        || (fact.source === "kb" && fact.observedAt !== (stored.observedAt || null));
    })) throw new Error("snapshot_fact_mismatch");
  }
  const facts = context?.facts ?? payload.facts.map(fact => ({ key: fact.key, value: fact.value || null, reason: fact.reason, source: "kb" as const, sourceUrl: fact.sourceUrl || null, observedAt: fact.observedAt || null, evidenceId: null }));
  const receipts: GeoContentBrief["evidence"]["facts"] = [];
  const factTable: GeoContentBrief["fact_table"] = facts.map((fact, index) => {
    const value = fact.reason === "conflicting" ? null : fact.value;
    const id = `${fact.source === "crawl" ? "C" : "K"}${index + 1}`;
    if (value !== null) {
      if (fact.source === "crawl" && (fact.evidenceId === null || fact.sourceUrl === null || fact.observedAt === null)) throw new Error("crawl_receipt_missing");
      receipts.push({ id, source: fact.source, text: value, observed_at: fact.observedAt ?? frozen.frozenAt, url: fact.sourceUrl });
    }
    return { id: `F${index + 1}`, label: fact.key, value, reason: value === null ? fact.reason || "lowConfidence" : null, evidence_refs: value === null ? [] : [id] };
  });
  const profileFactOverrides = frozen.questionSet.registryVersion.split("/").includes(GEO_PROFILE_FACT_OVERRIDES_POLICY);
  const sourcedFactValues = new Map<string, Set<string>>();
  if (profileFactOverrides) {
    for (const fact of factTable) {
      if (fact.value === null) continue;
      const values = sourcedFactValues.get(fact.label) ?? new Set<string>();
      values.add(normalizedExactText(fact.value));
      sourcedFactValues.set(fact.label, values);
    }
  }
  if (context?.profile) {
    const profile = context.profile; let receiptIndex = 0;
    for (const field of ["productName", "oneLinePositioning", "coreFeatures"] as const) {
      const provenance = profile.fieldProvenance?.find(item => item.path === `/${field}`);
      const timed = provenance !== undefined && (provenance.observedAt !== null || provenance.derivation === "declared" || ["user_edit", "local_computation", "supplied_product_information", "supplied_marketing_strategy"].includes(provenance.source));
      const verified = provenance !== undefined && timed && ["declared", "observed", "computed"].includes(provenance.derivation);
      const raw = profile[field]; const values = typeof raw === "string" ? [raw] : raw;
      for (const [index, text] of values.entries()) {
        if (!text.trim()) continue;
        const label = field === "coreFeatures" ? `${field}[${index}]` : field;
        const id = `P${++receiptIndex}`;
        if (!verified && sourcedFactValues.get(label)?.has(normalizedExactText(text))) continue;
        if (verified && provenance) receipts.push({ id, source: "product_profile", text, observed_at: provenance.observedAt ?? frozen.frozenAt, url: provenance.evidenceUrls[0] ?? null });
        factTable.push({ id: `F${factTable.length + 1}`, label, value: verified ? text : null, reason: verified ? null : "unverified", evidence_refs: verified ? [id] : [] });
      }
    }
  }
  return { receipts, factTable };
}
