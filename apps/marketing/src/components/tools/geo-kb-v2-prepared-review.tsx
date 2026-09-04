"use client";
// @input -- exact persisted candidate plus a local checkbox bound to its ID/hash
// @output -- complete visible review and explicit freeze gesture; no fabricated review persistence
import type { GeoPreparedCandidateV1 } from "../../lib/geo-tools/kb-prepared-contract.ts";
import { GeoKbVersionContent } from "./geo-kb-version-content.tsx";
import { geoKbV2EditorCopy } from "./geo-kb-v2-editor-copy.ts";
import { Button } from "../ui/button.tsx";
export function GeoKbV2PreparedReview({ candidate, locale, stale, reviewed, canFreeze, busy, onReview, onFreeze }: {
  readonly candidate: GeoPreparedCandidateV1 | null; readonly locale: string; readonly stale: boolean; readonly reviewed: boolean; readonly canFreeze: boolean; readonly busy: boolean;
  readonly onReview: (value: boolean) => void; readonly onFreeze: () => void;
}) {
  const t = geoKbV2EditorCopy(locale);
  return <section data-prepared-review className="min-w-0 space-y-5 rounded-card border border-brand-accent/40 bg-brand-panel p-5 sm:p-7">
    <h4 className="text-[15px] font-semibold text-text-dark-primary">{t.candidate}</h4>
    {candidate === null ? <p className="text-sm text-text-dark-secondary">{t.noCandidate}</p> : <>
      {/* Not the candidate id and hash: this panel asks whether the content is
          right to freeze, and the content below ends with a version-identity
          panel that states both for the record. */}
      {stale ? <p data-candidate-stale role="status" className="text-sm text-brand-error">{t.stale}</p> : null}
      <GeoKbVersionContent heading={4} payload={candidate.payload} questionSet={candidate.questionSet} context={candidate.context} locale={locale} />
      <label className="flex items-start gap-3 text-sm text-text-dark-primary"><input data-confirm-prepared type="checkbox" className="mt-1" disabled={stale || busy} checked={reviewed} onChange={event => onReview(event.target.checked)} /><span>{t.reviewed}</span></label>
      <Button data-freeze-prepared type="button" disabled={!canFreeze} onClick={onFreeze}>{t.freeze}</Button>
    </>}
  </section>;
}
