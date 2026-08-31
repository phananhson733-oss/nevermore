// @input -- model sentence plus the resolved GEO fact/absence ledger
// @output -- conservative lexical support, never an inferred semantic entailment
// @pos -- citations alone do not prove a sentence; unsupported claims fail closed
import type { ModelSentence } from "./contract.ts";
import type { GeoContentBrief, GeoFactEvidence } from "./geo-contract.ts";
export interface GeoMissingFact { readonly label: string; readonly reason: string }
const WORD_NUMBERS: Readonly<Record<string, string>> = { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20", thirty: "30", forty: "40", fifty: "50", sixty: "60", seventy: "70", eighty: "80", ninety: "90" };
export function canonicalGeoFactText(value: string): string {
  return value.normalize("NFC").toLowerCase().replace(/\b[a-z]+\b/g, word => WORD_NUMBERS[word] ?? word).replace(/\s+/gu, " ").trim().replace(/[.!?。！？]+$/u, "").trim();
}
export function geoMissingFactStatements(fact: GeoMissingFact): readonly string[] {
  const suffix = fact.reason === "notPublished" ? "is not published" : fact.reason === "fetchFailed" ? "could not be verified because its source could not be read" : fact.reason === "conflicting" ? "has conflicting sources" : fact.reason === "lowConfidence" ? "is not verified because the evidence is inconclusive" : "is not verified";
  return [`${fact.label} ${suffix}.`, `${fact.label} needs verification.`];
}
const PRICE_FACET_ALIASES = ["price", "prices", "pricing", "cost", "costs", "fee", "fees"] as const;
function mentionsExactLabel(text: string, normalized: string): boolean {
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u.test(normalized)) return text.includes(normalized);
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, "u").test(text);
}
function mentionsLabel(text: string, label: string): boolean {
  const normalized = canonicalGeoFactText(label);
  const labels = PRICE_FACET_ALIASES.some(alias => alias === normalized) ? PRICE_FACET_ALIASES : [normalized];
  return labels.some(alias => mentionsExactLabel(text, alias));
}
export type GeoFactSupportFailure = "geo_unsupported_fact_text" | "geo_unsupported_number" | "geo_missing_reason" | "geo_missing_value";
// Finite defensive vocabulary, not general language/number understanding.
// Generation is English-only; these catch known out-of-language model slips.
const SPANISH_NUMERALS = /\b(?:cero|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|doce|trece|catorce|quince|diecis[eé]is|diecisiete|dieciocho|diecinueve|veinte|veintiuno|veintid[oó]s|veintitr[eé]s|veinticuatro|veinticinco|veintis[eé]is|veintisiete|veintiocho|veintinueve|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|novecientos|mil|mill[oó]n|millones)\b|\b(?:admite|cuesta|tiene|soporta|incluye|son)\s+once\b/u;
const CJK_NUMERALS = /[〇零一二三四五六七八九十百千万萬亿億两兩壹贰貳叁參肆伍陆陸柒捌玖拾佰仟]/u;
export function checkGeoFactSupport(sentence: ModelSentence, facts: ReadonlyMap<string, GeoFactEvidence>, missing?: readonly GeoMissingFact[], mode: "sentence" | "heading" = "sentence"): GeoFactSupportFailure | null {
  const text = canonicalGeoFactText(sentence.text);
  let exactMissingStatement = false;
  for (const fact of missing ?? []) {
    if (!mentionsLabel(text, fact.label)) continue;
    if (geoMissingFactStatements(fact).some(statement => canonicalGeoFactText(statement) === text)) { exactMissingStatement = true; continue; }
    // Lexical guard, not semantic inference: advice without a declarative
    // value is allowed, but "Price is free" cannot hide behind no_claim.
    const advice = /(?:^|[,;]\s*)(?:compare|consider|review|evaluate|check|verify|confirm|research|ask)\b/u.test(text);
    const assertion = /\b(?:is|are|was|were|has|have|costs?|equals?|requires?|includes?|offers?|supports?|starts?|free|paid|unlimited)\b|:/u.test(text);
    if (mode === "heading" && !assertion) continue;
    if (sentence.claim !== "bound" && advice && !assertion) continue;
    return /\b(?:not published|unpublished|not disclosed|undisclosed)\b/u.test(text) ? "geo_missing_reason" : "geo_missing_value";
  }
  if (sentence.claim === "bound") {
    // Every reference must support the complete quoted statement. Attaching
    // unrelated receipts cannot inflate corroboration or earn a KB exemption.
    return sentence.evidence_refs.length > 0 && sentence.evidence_refs.every(ref => { const fact = facts.get(ref); return fact !== undefined && canonicalGeoFactText(fact.text) === text; }) ? null : "geo_unsupported_fact_text";
  }
  // All matching missing rows were checked first. An array index inside an
  // exact trusted absence template is metadata, not an invented factual value.
  if (exactMissingStatement) return null;
  // A number without bound factual evidence is not rescued by calling it gap
  // or no_claim. This also prevents borrowing a known seat count as a price.
  if (/\p{N}|\b(?:hundred|thousand|million|billion|trillion|half|quarter|dozen|double|triple)\b/u.test(text) || SPANISH_NUMERALS.test(text) || CJK_NUMERALS.test(text)) return "geo_unsupported_number";
  if (missing !== undefined && /\b(?:not published|unpublished|not disclosed|undisclosed)\b/u.test(text)) {
    const allowed = missing.some(fact => fact.reason === "notPublished" && canonicalGeoFactText(`${fact.label} is not published.`) === text);
    if (!allowed) return "geo_missing_reason";
  }
  return null;
}

/** Headings are content too: neutral topics are allowed, invented values are not. */
export function checkGeoHeadingSupport(heading: string, brief: Pick<GeoContentBrief, "fact_table" | "evidence">): GeoFactSupportFailure | null {
  const normalized = canonicalGeoFactText(heading);
  const facts = new Map(brief.evidence.facts.map(fact => [fact.id, fact]));
  const missing = brief.fact_table.filter(fact => fact.value === null).map(fact => ({ label: fact.label, reason: fact.reason ?? "unverified" }));
  for (const row of brief.fact_table) {
    if (row.value === null || row.reason !== null) continue;
    if (![row.value, `${row.label}: ${row.value}`].some(value => canonicalGeoFactText(value) === normalized)) continue;
    return checkGeoFactSupport({ text: row.value, claim: "bound", evidence_refs: row.evidence_refs }, facts, missing);
  }
  return checkGeoFactSupport({ text: heading, claim: "no_claim", evidence_refs: [] }, facts, missing, "heading");
}

export function geoOutlineSupportViolation(brief: GeoContentBrief): string | null {
  if (brief.outline.status !== "available") return null;
  for (const [index, section] of brief.outline.items.entries()) {
    if (checkGeoHeadingSupport(section.h2, brief) !== null) return `outline.items[${index}].h2`;
    for (const [subIndex, heading] of section.h3.entries()) if (checkGeoHeadingSupport(heading, brief) !== null) return `outline.items[${index}].h3[${subIndex}]`;
  }
  return null;
}
