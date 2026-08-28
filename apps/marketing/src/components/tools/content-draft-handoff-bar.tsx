// @input  -- one DraftResult, the brief it came from, the viewer locale and the translator
// @output -- copy Markdown, export JSON, and the published-URL field that unlocks the
//            On-Page SEO Checker handoff
// @pos    -- the exit of the draft page (handoff §5.6); every artifact it hands out is a
//            projection of the same DraftResult the screen shows

import { useState } from "react";
import type {
  ContentBrief,
  DraftResult,
} from "@sf/public-tools/content-brief/contract";

import { localePath } from "../../lib/locale-path";
import {
  TOOL_HANDOFF_LINK_PROPS,
  writeToolHandoff,
  type ToolHandoffPayload,
} from "../../lib/tools/tool-handoff";
import {
  draftExportJson,
  draftMarkdown,
  type MarkdownNotes,
} from "./content-draft-markdown";
import {
  ACTION_BUTTON,
  BODY_TEXT,
  CARD,
  PRIMARY_ACTION_BUTTON,
  SECTION_TITLE,
  translated,
  type DraftTranslate,
} from "./content-draft-results-shared";

const FIELD =
  "mt-2 h-11 w-full rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 text-[13px] text-text-dark-primary outline-none placeholder:text-text-dark-secondary focus-visible:border-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";

/** http(s) only, never credentialed; the same bar tool-handoff.ts applies before it stores a page. */
export function publishedUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  try {
    const url = new URL(trimmed);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname !== "" &&
      url.username === "" &&
      url.password === ""
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function fileSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "draft" : slug.slice(0, 48);
}

/** The exact object the screen renders, fingerprint included, as a file (see downloadBriefJson). */
export function downloadDraftJson(result: DraftResult): void {
  const blob = new Blob([draftExportJson(result)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `content-draft-${fileSlug(result.brief_ref.keyword)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function markdownNotes(t: DraftTranslate): MarkdownNotes {
  return {
    failed: (reason) => translated(t, `sectionFail.${reason}`),
    skipped: t("doc.skippedBody"),
  };
}

/** Storage itself can be unavailable, which is a browser state, not a defect. */
function stored(payload: ToolHandoffPayload): boolean {
  try {
    return writeToolHandoff(window.sessionStorage, Date.now(), payload);
  } catch {
    return false;
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function HandoffBar({
  result,
  brief,
  locale,
  t,
}: {
  readonly result: DraftResult;
  readonly brief: ContentBrief;
  readonly locale: string;
  readonly t: DraftTranslate;
}) {
  const [urlInput, setUrlInput] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [handoffFailed, setHandoffFailed] = useState(false);
  const page = publishedUrl(urlInput);
  const urlInvalid = urlInput.trim() !== "" && page === null;

  function prepare(event: React.MouseEvent<HTMLAnchorElement>): void {
    if (page === null) {
      event.preventDefault();
      return;
    }
    // The tool never learned a property: the visitor's own published page is
    // not something a Search Console property returned, so `property` is
    // null and the checker leaves its property select unpicked.
    const payload: ToolHandoffPayload = {
      source: "content-draft",
      destination: "on-page-seo-check",
      scope: "query_page",
      property: null,
      query: brief.keyword.primary,
      page,
      evidenceId: brief.run.fingerprint,
      marketCode: brief.keyword.market,
      languageCode: brief.keyword.language,
    };
    if (!stored(payload)) {
      event.preventDefault();
      setHandoffFailed(true);
      return;
    }
    setHandoffFailed(false);
  }

  return (
    <section data-handoff-bar className={CARD}>
      <h3 className={SECTION_TITLE}>{t("handoff.title")}</h3>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-copy-markdown
          onClick={() => {
            void copyText(draftMarkdown(result, markdownNotes(t))).then((ok) =>
              setCopyState(ok ? "copied" : "failed"),
            );
          }}
          className={ACTION_BUTTON}
        >
          {copyState === "copied" ? t("actions.copied") : t("actions.copyMarkdown")}
        </button>
        <button
          type="button"
          data-export-json
          onClick={() => downloadDraftJson(result)}
          className={ACTION_BUTTON}
        >
          {t("actions.exportJson")}
        </button>
      </div>
      {copyState === "failed" ? (
        <p role="alert" data-copy-failed className={`mt-2 ${BODY_TEXT} text-brand-error`}>
          {t("actions.copyFailed")}
        </p>
      ) : null}
      <div className="mt-5">
        <label htmlFor="content-draft-published-url" className="block">
          <span className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
            {t("handoff.publishedUrlLabel")}
          </span>
          <input
            id="content-draft-published-url"
            name="publishedUrl"
            type="url"
            autoComplete="off"
            value={urlInput}
            onChange={(event) => {
              setUrlInput(event.target.value);
              setHandoffFailed(false);
            }}
            aria-invalid={urlInvalid || undefined}
            aria-describedby="content-draft-published-url-help"
            placeholder={t("handoff.publishedUrlPlaceholder")}
            className={FIELD}
          />
        </label>
        <p id="content-draft-published-url-help" className={`mt-2 ${BODY_TEXT}`}>
          {t("handoff.publishedUrlHelp")}
        </p>
        {urlInvalid ? (
          <p data-published-url-invalid className={`mt-1 ${BODY_TEXT} text-brand-error`}>
            {t("handoff.invalidUrl")}
          </p>
        ) : null}
        {page !== null ? (
          <div className="mt-3">
            <a
              data-open-on-page
              href={localePath(locale, "/tools/on-page-seo-check")}
              {...TOOL_HANDOFF_LINK_PROPS}
              onClick={prepare}
              className={PRIMARY_ACTION_BUTTON}
            >
              {t("actions.openOnPage")}
            </a>
          </div>
        ) : null}
        {handoffFailed ? (
          <p role="alert" data-handoff-failed className={`mt-2 ${BODY_TEXT} text-brand-error`}>
            {t("handoff.failed")}
          </p>
        ) : null}
      </div>
    </section>
  );
}
