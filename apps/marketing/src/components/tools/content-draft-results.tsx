// @input  -- one DraftResult, the brief it was generated from, the rerun state and the locale
// @output -- the full result surface in handoff §5.5 order
// @pos    -- non-persistent result surface for the Marketing Content Draft Writer

"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type {
  DraftResult,
} from "@sf/public-tools/content-brief/contract";
import type { SharedContentBrief as ContentBrief } from "@sf/public-tools/content-brief/geo-contract";

import { CoverageCard } from "./content-draft-coverage-card";
import { DraftDoc, type RerunState } from "./content-draft-doc";
import { HandoffBar } from "./content-draft-handoff-bar";
import { DraftRunHeader } from "./content-draft-run-header";
import {
  DraftToolbar,
  readClaimsVisible,
  storeClaimsVisible,
} from "./content-draft-toolbar";
import { VerifyList } from "./content-draft-verify-list";
import { DraftWontSayFooter } from "./content-draft-wont-say-footer";
import { draftGeoProvenanceMarkdown } from "./content-draft-markdown";

export function DraftGeoProvenance({ result }: { readonly result: DraftResult }) {
  if (result.brief_ref.geo_origin === undefined) return null;
  return <details data-geo-provenance className="rounded-card border border-brand-border-card bg-brand-panel p-5"><summary className="font-mono text-xs">geo_origin · evidence</summary><pre className="mt-3 overflow-auto whitespace-pre-wrap break-all text-xs text-text-dark-secondary">{draftGeoProvenanceMarkdown(result)}</pre></details>;
}

export function ContentDraftResults({
  result,
  brief,
  rerun,
  locale,
}: {
  readonly result: DraftResult;
  readonly brief: ContentBrief;
  readonly rerun: RerunState;
  readonly locale: string;
}) {
  const t = useTranslations("tools.contentDraft");
  // Default on; the stored preference is read after mount so the server and
  // the first client frame agree (localStorage does not exist on the server).
  const [annotate, setAnnotate] = useState(true);
  useEffect(() => {
    setAnnotate(readClaimsVisible());
  }, []);

  function toggle(next: boolean): void {
    setAnnotate(next);
    storeClaimsVisible(next);
  }

  return (
    <div data-content-draft-results data-run-mode={result.run.mode} className="mt-6 space-y-4">
      <DraftRunHeader result={result} locale={locale} t={t} />
      <DraftGeoProvenance result={result} />
      <CoverageCard result={result} brief={brief} t={t} />
      <DraftToolbar annotate={annotate} onToggle={toggle} t={t} />
      <DraftDoc result={result} annotate={annotate} rerun={rerun} locale={locale} t={t} />
      <VerifyList result={result} locale={locale} t={t} />
      <HandoffBar result={result} brief={brief} locale={locale} t={t} />
      <DraftWontSayFooter t={t} />
    </div>
  );
}
