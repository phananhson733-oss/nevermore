"use client";
// @input -- an actual V2 report, or two explicit user-chosen local files
// @output -- per-engine metrics and portable evidence, never trusted run authority
// @pos -- secondary local-file comparison; report rendering owns exports and measurements
import { useState } from "react";
import { useTranslations } from "next-intl";
import { compareVisibilityReportsV2, parseVisibilityImport } from "../../lib/geo-tools/visibility-export.ts";
import type { VisibilityComparison } from "../../lib/geo-tools/visibility-contract.ts";
import type { VisibilityReportV2 } from "../../lib/geo-tools/visibility-v2-contract.ts";

const PANEL = "rounded-xl border border-brand-border-card bg-brand-panel p-6 md:p-7";
const BUTTON = "rounded-lg border border-brand-border-card px-3 py-2 text-[13px] text-text-dark-primary disabled:opacity-50";
export function VisibilityPortableRuns({ onComparison }: { readonly onComparison: (comparison: VisibilityComparison | null) => void }) {
  const t = useTranslations("tools.aiVisibility");
  const [base, setBase] = useState<VisibilityReportV2 | null>(null);
  const [current, setCurrent] = useState<VisibilityReportV2 | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function read(file: File | undefined, side: "base" | "current"): Promise<void> {
    onComparison(null); setError(null);
    const set = side === "base" ? setBase : setCurrent;
    set(null);
    if (file === undefined) return;
    if (file.size > 4 * 1024 * 1024) { setError(t("v2.invalidFile")); return; }
    try {
      const parsed = parseVisibilityImport(await file.text());
      if (!parsed.ok) { setError(t("v2.invalidFile")); return; }
      set(parsed.report);
    } catch { setError(t("v2.invalidFile")); }
  }
  return <details className={PANEL}>
    <summary className="cursor-pointer text-sm font-medium text-text-dark-primary">{t("methodology.importTitle")}</summary>
    <h3 className="sr-only">{t("v2.importTitle")}</h3>
    <p className="mt-2 text-sm text-text-dark-secondary">{t("v2.imported")}</p>
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <label className="text-sm text-text-dark-primary">{t("v2.importBase")}<input className="mt-2 block w-full" type="file" accept="application/json,.json" onChange={(event) => { void read(event.target.files?.[0], "base"); }} />{base !== null && <span>{t("v2.loaded", { id: base.manifest.runId })}</span>}</label>
      <label className="text-sm text-text-dark-primary">{t("v2.importCurrent")}<input className="mt-2 block w-full" type="file" accept="application/json,.json" onChange={(event) => { void read(event.target.files?.[0], "current"); }} />{current !== null && <span>{t("v2.loaded", { id: current.manifest.runId })}</span>}</label>
    </div>
    <button type="button" className={`mt-4 ${BUTTON}`} disabled={base === null || current === null} onClick={() => {
      if (base === null || current === null) return;
      const result = compareVisibilityReportsV2(base, current);
      if (!result.compatible) { setError(t("v2.incompatible", { reason: result.reason })); onComparison(null); }
      else { setError(null); onComparison(result.comparison); }
    }}>{t("v2.compare")}</button>
    {error !== null && <p className="mt-3 text-sm text-brand-error" role="alert">{error}</p>}
  </details>;
}
