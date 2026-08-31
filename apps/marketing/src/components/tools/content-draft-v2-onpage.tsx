// @input -- an exact confirmed Brief v2 and a published URL explicitly entered by the visitor
// @output -- private, gesture-staged On-Page handoff; no publishing, HTTP or document in a URL
// @pos -- v2 result exit; never treats the observed rewrite target as the published draft
"use client";

import { useId, useState, type MouseEvent } from "react";
import { useTranslations } from "next-intl";
import type { ConfirmedBriefV2 } from "@sf/public-tools/content-brief/v2-generation-contract";
import { localePath } from "../../lib/locale-path";
import { resolveDraftV2Language } from "../../lib/tools/content-draft-v2-language";
import { TOOL_HANDOFF_LINK_PROPS, writeToolHandoff, type ToolHandoffPayload } from "../../lib/tools/tool-handoff";
import { BODY_TEXT, PRIMARY_ACTION_BUTTON, SECTION_TITLE } from "./content-brief-results-shared";
import { publishedUrl } from "./content-draft-handoff-bar";

export function ContentDraftV2OnPage({ confirmed, locale }: {
  readonly confirmed: ConfirmedBriefV2;
  readonly locale: string;
}) {
  const t = useTranslations("tools.contentDraft");
  const [urlInput, setUrlInput] = useState("");
  const [handoffFailed, setHandoffFailed] = useState(false);
  const inputId = useId();
  const helpId = `${inputId}-help`;
  const page = publishedUrl(urlInput);
  const language = resolveDraftV2Language(confirmed.brief.context.input.language);
  const invalid = urlInput.trim() !== "" && page === null;

  function prepare(event: MouseEvent<HTMLAnchorElement>) {
    let stored = false;
    if (page !== null && language !== null) {
      const payload: ToolHandoffPayload = {
        source: "content-draft", destination: "on-page-seo-check", scope: "query_page", property: null,
        query: confirmed.brief.context.input.primary, page, evidenceId: confirmed.fingerprint,
        marketCode: confirmed.brief.context.input.market, languageCode: language.code,
      };
      try { stored = writeToolHandoff(window.sessionStorage, Date.now(), payload); }
      catch { /* A denied storage getter is also a failed handoff, never permission to navigate. */ }
    }
    setHandoffFailed(!stored);
    if (!stored) event.preventDefault();
  }

  return <section data-draft-v2-onpage className="rounded-[4px] border border-brand-border-card bg-brand-panel p-4 md:p-5">
    <h2 className={SECTION_TITLE}>{t("handoff.title")}</h2>
    <label htmlFor={inputId} className="mt-4 block">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-dark-secondary">{t("handoff.publishedUrlLabel")}</span>
      <input id={inputId} data-published-url name="publishedUrl" type="url" autoComplete="off" value={urlInput}
        onChange={(event) => { setUrlInput(event.target.value); setHandoffFailed(false); }}
        aria-invalid={invalid || undefined} aria-describedby={helpId} placeholder={t("handoff.publishedUrlPlaceholder")}
        className="mt-2 h-11 w-full rounded-[4px] border border-brand-border-strong bg-brand-bg px-3 text-[13px] text-text-dark-primary placeholder:text-text-dark-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent" />
    </label>
    <p id={helpId} data-published-url-help className={`mt-2 ${BODY_TEXT}`}>{t("handoff.publishedUrlHelp")}</p>
    {invalid ? <p data-published-url-invalid className={`mt-1 ${BODY_TEXT} text-brand-error`}>{t("handoff.invalidUrl")}</p> : null}
    {page !== null && language !== null ? <a data-open-on-page href={localePath(locale, "/tools/on-page-seo-check")} {...TOOL_HANDOFF_LINK_PROPS}
      onClick={prepare} onMouseDown={prepare} onContextMenu={prepare} onAuxClick={prepare}
      className={`mt-3 ${PRIMARY_ACTION_BUTTON}`}>{t("actions.openOnPage")}</a> : null}
    {handoffFailed ? <p data-handoff-failed role="alert" className={`mt-2 ${BODY_TEXT} text-brand-error`}>{t("handoff.failed")}</p> : null}
  </section>;
}
