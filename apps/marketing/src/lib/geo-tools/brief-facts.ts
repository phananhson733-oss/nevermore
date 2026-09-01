// @input -- exact immutable frozen KB and optional owner-verified context
// @output -- fact rows and matching receipts, with inconsistent sources rejected
// @pos -- one projection for Brief generation and free input evidence summaries
import type { GeoContentBrief } from "@sf/public-tools/content-brief/geo-contract";
import type { GeoKbFrozenSnapshot } from "./kb-store.ts";
import type { GeoSnapshotContext } from "./snapshot-context.ts";
import { normalizeGeoHost } from "../agents/geo-url.ts";
import { GEO_PROFILE_FACT_OVERRIDES_POLICY } from "./kb-questions.ts";

function normalizedExactText(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en");
}

export function geoBriefFactsForSnapshot(frozen: GeoKbFrozenSnapshot, context: GeoSnapshotContext | null) {
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
