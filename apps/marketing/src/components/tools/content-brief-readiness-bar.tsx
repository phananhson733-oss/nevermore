// @input  -- one ContentBrief's draft_readiness, its keyword block, and the tool translator
// @output -- "N sections writable · M gaps", the JSON export, and the (PR 3) draft button
// @pos    -- the confirmation gate in its v1 form; nothing is withdrawn, so only N and M print

import type { ContentBrief } from "@sf/public-tools/content-brief/contract";
import { isWhitespaceTokenizedLanguage } from "@sf/public-tools/content-brief/constants";

import {
  ACTION_BUTTON,
  BODY_TEXT,
  CARD,
  DATA_CHIP,
  PRIMARY_ACTION_BUTTON,
  chipTone,
  translated,
  type Translate,
} from "./content-brief-results-shared";

function fileSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "brief" : slug.slice(0, 48);
}

/**
 * The whole brief, fingerprint included, as a file.
 *
 * Nothing is saved on the server, so this file is the only copy that survives
 * the tab -- and it is the exact object the draft tool will re-parse and
 * re-fingerprint. Written through a Blob URL like keyword-map-results.tsx so
 * no route has to exist for a download of data the browser already holds.
 */
export function downloadBriefJson(brief: ContentBrief): void {
  const blob = new Blob([`${JSON.stringify(brief, null, 2)}\n`], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `content-brief-${fileSlug(brief.keyword.primary)}-${brief.keyword.market.toLowerCase()}-${brief.keyword.language.toLowerCase()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ReadinessBar({
  brief,
  t,
}: {
  readonly brief: ContentBrief;
  readonly t: Translate;
}) {
  const { writable, gaps } = brief.draft_readiness;
  const unsupported = !isWhitespaceTokenizedLanguage(brief.keyword.language);
  return (
    <section data-readiness-bar className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div
            data-readiness-summary
            className="font-mono text-[15px] font-semibold text-text-dark-primary"
          >
            {t("readiness.summary", {
              writable: writable.length,
              gaps: gaps.length,
            })}
          </div>
          {gaps.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {gaps.map((gap) => (
                <span
                  key={gap}
                  data-readiness-gap={gap}
                  className={`${DATA_CHIP} ${chipTone("caution")}`}
                >
                  {translated(t, `readiness.gaps.${gap}`)}
                </span>
              ))}
            </div>
          ) : null}
          {unsupported ? (
            <p data-readiness-unsupported className={`mt-2 ${BODY_TEXT}`}>
              {t("readiness.unsupportedLanguage")}
            </p>
          ) : writable.length === 0 ? (
            <p data-readiness-no-writable className={`mt-2 ${BODY_TEXT}`}>
              {t("readiness.noWritable")}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-export-json
            onClick={() => downloadBriefJson(brief)}
            className={ACTION_BUTTON}
          >
            {t("actions.exportJson")}
          </button>
          {/* PR 3 wires this to the Content Draft Writer handoff. Disabled
              rather than absent so the shape of the gate is already on the
              page; the title says why it does nothing yet. */}
          <button
            type="button"
            data-generate-draft
            disabled
            aria-disabled="true"
            title={t("actions.generateDraftPending")}
            className={`${PRIMARY_ACTION_BUTTON} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {t("actions.generateDraft")}
          </button>
        </div>
      </div>
      <p className={`mt-3 ${BODY_TEXT}`}>{t("actions.generateDraftPending")}</p>
    </section>
  );
}
