"use client";

// @input  -- current draft and bounded server enrichment receipts
// @output -- source-labelled suggestions applied only by explicit per-field review
// @pos    -- no autosave, no silent replacement, no client provenance authority

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { GeoKbPayload } from "../../lib/geo-tools/kb-contract.ts";
import { parseGeoKbEnrichmentReport, type GeoKbEnrichmentReport } from "../../lib/geo-tools/kb-enrichment-contract.ts";
import { applyGeoEnrichmentSuggestion } from "./geo-kb-enrichment-apply.ts";
import { Button } from "../ui/button.tsx";

type State = { readonly kind: "idle" | "loading" | "error" | "identity" } |
  { readonly kind: "ready"; readonly report: GeoKbEnrichmentReport; readonly baseline: GeoKbPayload };

export function GeoKbEnrichment({ kbId, targetHost, draftVersion, payload, dirty, onApply, inline = false }: {
  readonly kbId: string;
  readonly targetHost: string;
  readonly draftVersion: number;
  readonly payload: GeoKbPayload;
  readonly dirty: boolean;
  readonly onApply: (payload: GeoKbPayload) => void;
  readonly inline?: boolean;
}) {
  const t = useTranslations("tools.geoKnowledgeBase.enrichment");
  const Heading = inline ? "h3" : "h2";
  const [state, setState] = useState<State>({ kind: "idle" });
  const [applied, setApplied] = useState<readonly string[]>([]);
  const [conflict, setConflict] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const run = async (): Promise<void> => {
    if (dirty || draftVersion < 1 || state.kind === "loading") return;
    const baseline = payload;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setState({ kind: "loading" }); setConflict(false); setApplied([]);
    try {
      const response = await fetch("/api/tools/geo-knowledge-base/enrich", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kbId }), cache: "no-store", signal: request.signal,
      });
      const body: unknown = await response.json();
      if (request.signal.aborted) return;
      if (!response.ok) {
        const identity = response.status === 401 && typeof body === "object" && body !== null && JSON.stringify(body).includes('"gsc_identity_mismatch"');
        setState({ kind: identity ? "identity" : "error" }); return;
      }
      if (body === null || typeof body !== "object" || !("data" in body)) throw new Error("invalid receipt");
      const report = parseGeoKbEnrichmentReport(body.data);
      if (report.kbId !== kbId || report.targetHost !== targetHost || report.draftVersion !== draftVersion) throw new Error("receipt scope mismatch");
      setState({ kind: "ready", report, baseline });
    } catch { if (!request.signal.aborted) setState({ kind: "error" }); }
  };
  const stale = state.kind === "ready" && state.report.draftVersion !== draftVersion;
  const apply = (evidenceId: string): void => {
    if (state.kind !== "ready" || stale || applied.includes(evidenceId)) return;
    const result = applyGeoEnrichmentSuggestion(payload, state.baseline, state.report, evidenceId);
    if (!result.ok) { setConflict(true); return; }
    onApply(result.payload); setApplied((current) => [...current, evidenceId]); setConflict(false);
  };
  const applyButton = (id: string) => (
    <Button variant="outline" disabled={stale || applied.includes(id)} type="button" onClick={() => apply(id)}>{t(applied.includes(id) ? "used" : "apply")}</Button>
  );
  return (
    <section className="overflow-hidden rounded-card border border-brand-border-strong bg-brand-panel px-5 py-5 sm:px-7">
      <Heading className="-mx-5 -mt-5 mb-5 border-b border-brand-border-card bg-brand-panel-raised px-5 py-5 text-[17px] font-semibold text-text-dark-primary sm:-mx-7 sm:px-7">{t("title")}</Heading>
      <p className="mt-2 text-sm text-text-dark-secondary">{t("body")}</p>
      <Button variant="outline" className="mt-4"
        disabled={dirty || draftVersion < 1 || state.kind === "loading"} type="button" onClick={() => void run()}>{t(state.kind === "loading" ? "loading" : "action")}</Button>
      {dirty || draftVersion < 1 ? <p className="mt-2 text-sm text-text-dark-secondary">{t("saveFirst")}</p> : null}
      {state.kind === "error" || state.kind === "identity" ? <p role="alert" className="mt-3 text-sm text-brand-error">{t(state.kind === "identity" ? "identityMismatch" : "error")}</p> : null}
      {conflict ? <p role="alert" className="mt-3 text-sm text-brand-error">{t("conflict")}</p> : null}
      {state.kind === "ready" ? (
        <div className="mt-5 grid gap-5 text-sm">
          <p>{t("review")}</p><p>{t("captured", { time: state.report.createdAt })}</p>
          {stale ? <p role="alert">{t("stale")}</p> : null}
          <div>
            <h3>{t("roles")}</h3>
            <p>{t("window", { start: state.report.gsc.window.startDate, end: state.report.gsc.window.endDate })}</p>
            {state.report.gsc.status === "unavailable" ? <p>{t("gscUnavailable", { reason: t(`reasons.${state.report.gsc.reason}`) })}</p> : (
              <><p>{t("queryCount", { count: state.report.gsc.queryCount })}</p>{state.report.gsc.truncated ? <p>{t("truncated")}</p> : null}</>
            )}
            {state.report.gsc.roles.length === 0 ? <p>{t("noRoles")}</p> : null}
            {state.report.gsc.roles.map((entry) => <div className="mt-3 grid gap-2 border-t border-brand-border-card pt-3" key={entry.evidenceId}>
              <p>{entry.role.label}</p><p>{t("roleQueries", { count: entry.queryCount })}</p>
              <ul>{entry.queries.map((query) => <li key={query}>{query}</li>)}</ul>
              {entry.queriesTruncated ? <p>{t("truncated")}</p> : null}{applyButton(entry.evidenceId)}
            </div>)}
          </div>
          <div><h3>{t("competitors")}</h3>{state.report.competitors.map((entry) => <div className="mt-3 grid gap-2 border-t border-brand-border-card pt-3" key={entry.evidenceId}>
            <p>{entry.domain}</p>{entry.sourceUrl === null ? null : <p>{t("source", { url: entry.sourceUrl })}</p>}
            {entry.status === "available" ? <><p>{entry.brandName}</p><p>{t("aliases", { aliases: entry.aliases.join(", ") })}</p><p>{entry.method} · {entry.observedAt}</p>{applyButton(entry.evidenceId)}<p>{t("confirmCompetitor")}</p></>
              : <p>{t("unavailable", { reason: t(`reasons.${entry.reason}`) })}</p>}
          </div>)}</div>
          <div><h3>{t("facts")}</h3>{state.report.facts.map((entry) => <div className="mt-3 grid gap-2 border-t border-brand-border-card pt-3" key={entry.evidenceId}>
            <p>{entry.key}</p>{entry.sourceUrl === null ? null : <p>{t("source", { url: entry.sourceUrl })}</p>}
            {entry.status === "available" ? <><p>{entry.value}</p><blockquote>{entry.excerpt}</blockquote><p>{entry.observedAt}</p>{applyButton(entry.evidenceId)}</>
              : <p>{t("unavailable", { reason: t(`reasons.${entry.reason}`) })}</p>}
          </div>)}</div>
        </div>
      ) : null}
    </section>
  );
}
