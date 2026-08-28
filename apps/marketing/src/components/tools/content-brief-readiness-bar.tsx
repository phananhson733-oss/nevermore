// @input  -- one ContentBrief's draft_readiness, its keyword block, the locale and the tool translator
// @output -- "N sections writable · M gaps", the JSON export, and the handoff link into the
//            Content Draft Writer
// @pos    -- the confirmation gate in its v1 form; nothing is withdrawn, so only N and M print

import { useState } from "react";
import {
  CONTENT_BRIEF_HANDOFF_MAX_BYTES,
  type ContentBrief,
} from "@sf/public-tools/content-brief/contract";
import { isWhitespaceTokenizedLanguage } from "@sf/public-tools/content-brief/constants";

import { localePath } from "../../lib/locale-path";
import {
  writeContentBriefHandoff,
  type ContentBriefHandoffWrite,
} from "../../lib/tools/content-brief-handoff";
import { TOOL_HANDOFF_LINK_PROPS } from "../../lib/tools/tool-handoff";
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

/** Storage itself can be unavailable, which is a browser state, not a defect. */
function storeHandoff(brief: ContentBrief): ContentBriefHandoffWrite {
  try {
    return writeContentBriefHandoff(window.sessionStorage, Date.now(), brief);
  } catch {
    return { ok: false, reason: "storage", bytes: 0 };
  }
}

export function ReadinessBar({
  brief,
  locale,
  t,
}: {
  readonly brief: ContentBrief;
  readonly locale: string;
  readonly t: Translate;
}) {
  const { writable, gaps } = brief.draft_readiness;
  const unsupported = !isWhitespaceTokenizedLanguage(brief.keyword.language);
  const [handoffFailure, setHandoffFailure] = useState<
    "too_large" | "storage" | null
  >(null);

  /**
   * The handoff is written before navigation, and navigation is cancelled
   * when it could not be written: the draft page would otherwise open on its
   * empty state and look like it lost the brief. No query-string fallback --
   * a brief does not fit a URL and must not leak into one (handoff §5.1).
   */
  function prepare(event: React.MouseEvent<HTMLAnchorElement>): void {
    const written = storeHandoff(brief);
    if (!written.ok) {
      event.preventDefault();
      setHandoffFailure(written.reason);
      return;
    }
    setHandoffFailure(null);
  }

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
          {/* Absent, not disabled, when nothing is writable: the draft page
              would only restate "no writable section" after a paid tab. */}
          {writable.length > 0 ? (
            <a
              data-generate-draft
              href={localePath(locale, "/tools/content-draft")}
              {...TOOL_HANDOFF_LINK_PROPS}
              onClick={prepare}
              className={PRIMARY_ACTION_BUTTON}
            >
              {t("actions.generateDraft")}
            </a>
          ) : null}
        </div>
      </div>
      {writable.length > 0 ? (
        <p className={`mt-3 ${BODY_TEXT}`}>{t("actions.generateDraftHelp")}</p>
      ) : null}
      {handoffFailure !== null ? (
        <p
          role="alert"
          data-generate-draft-failed={handoffFailure}
          className={`mt-2 ${BODY_TEXT} text-brand-error`}
        >
          {translated(t, `actions.generateDraftFailed.${handoffFailure}`, {
            maxKb: Math.round(CONTENT_BRIEF_HANDOFF_MAX_BYTES / 1024),
          })}
        </p>
      ) : null}
    </section>
  );
}
