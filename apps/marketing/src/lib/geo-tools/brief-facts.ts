// @input -- exact immutable frozen KB and optional owner-verified context
// @output -- fact rows and matching receipts, with inconsistent sources rejected
// @pos -- one projection for Brief generation and free input evidence summaries
import type { GeoContentBrief } from "@sf/public-tools/content-brief/geo-contract";
import type { VersionedGeoKbFrozenSnapshot } from "./kb-versioned-read.ts";
import type { AnyGeoSnapshotContext } from "./snapshot-context-v2.ts";
import { normalizeGeoHost } from "../agents/geo-url.ts";

export function geoBriefFactsForSnapshot(frozen: VersionedGeoKbFrozenSnapshot, context: AnyGeoSnapshotContext | null) {
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
  if (frozen.questionSet.schemaVersion !== "marketing-geo-question-set.v1") throw new Error("question_set_version_mismatch");
  if (context !== null) {
    if (context.kbId !== frozen.kbId || context.payloadHash !== frozen.contentHash || context.questionSetHash !== frozen.questionSetHash || context.targetHost !== normalizeGeoHost(frozen.payload.targetUrl)) throw new Error("snapshot_context_mismatch");
    if (context.facts.length !== frozen.payload.facts.length || context.facts.some((fact, index) => {
      const stored = frozen.payload.facts[index];
      return !stored || fact.key !== stored.key || fact.value !== (stored.value || null)
        || fact.reason !== stored.reason || fact.sourceUrl !== (stored.sourceUrl || null)
        || (fact.source === "kb" && fact.observedAt !== (stored.observedAt || null));
    })) throw new Error("snapshot_fact_mismatch");
  }
  const facts = context?.facts ?? frozen.payload.facts.map(fact => ({ key: fact.key, value: fact.value || null, reason: fact.reason, source: "kb" as const, sourceUrl: fact.sourceUrl || null, observedAt: fact.observedAt || null, evidenceId: null }));
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
        if (verified && provenance) receipts.push({ id, source: "product_profile", text, observed_at: provenance.observedAt ?? frozen.frozenAt, url: provenance.evidenceUrls[0] ?? null });
        factTable.push({ id: `F${factTable.length + 1}`, label, value: verified ? text : null, reason: verified ? null : "unverified", evidence_refs: verified ? [id] : [] });
      }
    }
  }
  return { receipts, factTable };
}
