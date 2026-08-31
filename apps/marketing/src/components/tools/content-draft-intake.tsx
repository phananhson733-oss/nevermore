// @input  -- the intake state (empty / parsing / rejected / loaded), the translator
// @output -- the empty-state copy, the paste + upload entrances, the rejection line, and the
//            loaded-brief summary with its replace control
// @pos    -- the three entrances of handoff §5.1 in one card; parsing itself happens in the
//            tool's version-specific parsers; this card collects input and offers local schema guidance

import { useId, useState } from "react";
import { geoGenerationLanguage, isGeoContentBrief, type SharedContentBrief as ContentBrief } from "@sf/public-tools/content-brief/geo-contract";
import {
  CONTENT_BRIEF_HANDOFF_MAX_BYTES,
  type ContentDraftErrorCode,
} from "@sf/public-tools/content-brief/contract";
import { isWhitespaceTokenizedLanguage } from "@sf/public-tools/content-brief/constants";
import { localePath } from "../../lib/locale-path";

import {
  ACTION_BUTTON,
  BADGE,
  BODY_TEXT,
  DATA_CHIP,
  chipTone,
  translated,
  type DraftTranslate,
} from "./content-draft-results-shared";

export type BriefSource = "handoff" | "paste" | "upload";

/** Local intake guidance stays separate from the paid API's error-code union. */
export type IntakeRejection =
  | { readonly code: ContentDraftErrorCode; readonly path: string }
  | { readonly code: "invalid_json"; readonly path: null }
  | { readonly code: "handoff_expired"; readonly path: null }
  | { readonly code: "geo_document" | "confirmation_required"; readonly path: null };

export type IntakeState =
  | { readonly phase: "empty" }
  | { readonly phase: "parsing" }
  | { readonly phase: "rejected"; readonly rejection: IntakeRejection }
  | { readonly phase: "loaded"; readonly brief: ContentBrief; readonly source: BriefSource };

const PANEL =
  "rounded-card border border-brand-border-card bg-brand-panel p-[22px] md:p-[26px]";
const FIELD_LABEL =
  "block font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase";
const TEXTAREA =
  "mt-2 min-h-32 w-full rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 py-3 font-mono text-[12px] leading-[1.5] text-text-dark-primary outline-none placeholder:text-text-dark-secondary focus-visible:border-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:opacity-60";

function rejectionCopy(t: DraftTranslate, rejection: IntakeRejection): string {
  if (rejection.code === "invalid_json") return t("intake.invalidJson");
  if (rejection.code === "handoff_expired") return t("intake.handoffExpired");
  if (rejection.code === "geo_document") return t("intake.geoDocument");
  if (rejection.code === "confirmation_required") return t("intake.confirmationRequired");
  if (rejection.code === "brief_schema_mismatch") return t("intake.supportedSchemas");
  return translated(t, `errors.${rejection.code}`);
}

function LoadedBrief({
  brief,
  source,
  onReplace,
  disabled,
  t,
}: {
  readonly brief: ContentBrief;
  readonly source: BriefSource;
  readonly onReplace: () => void;
  readonly disabled: boolean;
  readonly t: DraftTranslate;
}) {
  const geo = isGeoContentBrief(brief);
  const unsupported = geo ? geoGenerationLanguage(brief.keyword.language) === null : !isWhitespaceTokenizedLanguage(brief.keyword.language);
  const { gaps } = brief.draft_readiness;
  const writable = unsupported ? [] : brief.draft_readiness.writable;
  return (
    <div data-brief-loaded data-brief-source={source}>
      {isGeoContentBrief(brief) ? <p data-geo-origin className={BODY_TEXT}>{t("intake.geoOrigin")}</p> : null}
      {source === "handoff" ? (
        <p data-handoff-loaded className={`${BODY_TEXT} mb-3`}>
          {t("intake.handoffLoaded")}
        </p>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={FIELD_LABEL}>{t("intake.keyword")}</div>
          <div data-brief-keyword className="mt-1 text-[17px] font-semibold text-text-dark-primary">
            {brief.keyword.primary}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className={BADGE}>{brief.keyword.market}</span>
            <span className={BADGE}>{brief.keyword.language}</span>
            <span data-brief-writable className={`${DATA_CHIP} ${chipTone(writable.length > 0 ? "positive" : "caution")}`}>
              {t("intake.writable", { count: writable.length })}
            </span>
            <span className={`${DATA_CHIP} ${chipTone(gaps.length > 0 ? "caution" : "muted")}`}>
              {t("intake.gaps", { count: gaps.length })}
            </span>
          </div>
        </div>
        <button
          type="button"
          data-replace-brief
          onClick={onReplace}
          disabled={disabled}
          className={`${ACTION_BUTTON} disabled:opacity-50`}
        >
          {t("intake.replace")}
        </button>
      </div>
      <div className="mt-3 space-y-1 font-mono text-[10.5px] text-text-dark-secondary">
        <div className="flex flex-wrap gap-x-2">
          <span className="uppercase tracking-[0.12em]">{t("intake.briefRun")}</span>
          <span data-brief-run-id>{brief.run.run_id}</span>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <span className="uppercase tracking-[0.12em]">{t("intake.fingerprint")}</span>
          <span data-brief-fingerprint className="break-all">{brief.run.fingerprint}</span>
        </div>
      </div>
      {unsupported ? (
        <p data-brief-unsupported-language role="status" className={`mt-3 ${BODY_TEXT}`}>
          {t(geo ? "intake.geoUnsupportedLanguage" : "intake.unsupportedLanguage", { language: brief.keyword.language })}
        </p>
      ) : writable.length === 0 ? (
        <p data-brief-no-writable role="status" className={`mt-3 ${BODY_TEXT}`}>
          {t("intake.noWritable")}
        </p>
      ) : null}
    </div>
  );
}

function Entrances({
  onSubmit,
  onUpload,
  disabled,
  t,
}: {
  readonly onSubmit: (raw: string, source: BriefSource) => void;
  readonly onUpload: (file: File) => void;
  readonly disabled: boolean;
  readonly t: DraftTranslate;
}) {
  const [pasted, setPasted] = useState("");
  const pasteId = useId();
  const uploadId = useId();

  return (
    <div className="mt-5 grid gap-4">
      <label htmlFor={pasteId} className="block">
        <span className={FIELD_LABEL}>{t("intake.pasteLabel")}</span>
        <textarea
          id={pasteId}
          data-paste-brief
          value={pasted}
          onChange={(event) => setPasted(event.target.value)}
          placeholder={t("intake.pastePlaceholder")}
          disabled={disabled}
          spellCheck={false}
          className={TEXTAREA}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-load-brief
          disabled={disabled || pasted.trim() === ""}
          onClick={() => onSubmit(pasted, "paste")}
          className={`${ACTION_BUTTON} disabled:opacity-50`}
        >
          {t("intake.load")}
        </button>
        <label htmlFor={uploadId} className={`${BODY_TEXT} inline-flex items-center gap-2`}>
          <span>{t("intake.uploadLabel")}</span>
          <input
            id={uploadId}
            data-upload-brief
            type="file"
            accept=".json,application/json"
            disabled={disabled}
            onChange={(event) => {
              // The file is read by the tool, which stamps the read with the
              // intake generation so a slow read cannot outrun a later paste.
              const file = event.target.files?.[0];
              if (file !== undefined) onUpload(file);
              event.target.value = "";
            }}
            className="text-[12px] text-text-dark-secondary"
          />
        </label>
      </div>
      <p className={BODY_TEXT}>
        {t("intake.maxBytes", { kb: Math.round(CONTENT_BRIEF_HANDOFF_MAX_BYTES / 1024) })}
      </p>
    </div>
  );
}

export function ContentDraftIntake({
  intake,
  onSubmit,
  onUpload,
  onReplace,
  disabled,
  locale = "en",
  t,
}: {
  readonly intake: IntakeState;
  readonly onSubmit: (raw: string, source: BriefSource) => void;
  readonly onUpload: (file: File) => void;
  readonly onReplace: () => void;
  readonly disabled: boolean;
  readonly locale?: string;
  readonly t: DraftTranslate;
}) {
  if (intake.phase === "loaded") {
    return (
      <section data-content-draft-intake data-intake-phase="loaded" className={PANEL}>
        <h2 className="text-[17px] font-semibold text-text-dark-primary">{t("intake.loaded")}</h2>
        <div className="mt-4">
          <LoadedBrief
            brief={intake.brief}
            source={intake.source}
            onReplace={onReplace}
            disabled={disabled}
            t={t}
          />
        </div>
      </section>
    );
  }
  return (
    <section data-content-draft-intake data-intake-phase={intake.phase} className={PANEL}>
      <h2 className="text-[17px] font-semibold text-text-dark-primary">{t("empty.title")}</h2>
      <p data-empty-state className="mt-2 max-w-3xl text-[13.5px] leading-[1.6] text-text-dark-primary">
        {t("empty.body")}
      </p>
      <p className={`mt-1 max-w-3xl ${BODY_TEXT}`}>{t("empty.hint")}</p>
      {intake.phase === "rejected" ? (
        <div
          role="alert"
          data-intake-rejected={intake.rejection.code}
          className="mt-4 rounded-[10px] border border-brand-error/25 bg-brand-error/[0.08] px-4 py-3 text-[12.5px] text-brand-error"
        >
          <p>{rejectionCopy(t, intake.rejection)}</p>
          {intake.rejection.code === "geo_document" || intake.rejection.code === "confirmation_required" ? (
            <a data-content-brief-entry href={localePath(locale, "/tools/content-brief")} className="mt-2 inline-block underline underline-offset-2">
              {t("intake.openContentBrief")}
            </a>
          ) : null}
          {intake.rejection.path !== null && intake.rejection.path !== "" ? (
            <p data-intake-rejected-path className="mt-1 font-mono text-[11px]">
              {t("intake.parseFailed", { path: intake.rejection.path })}
            </p>
          ) : null}
        </div>
      ) : null}
      {/* Not disabled while parsing: a later paste or file supersedes an
          earlier, slower one through the tool's intake generations. */}
      <Entrances onSubmit={onSubmit} onUpload={onUpload} disabled={disabled} t={t} />
    </section>
  );
}
