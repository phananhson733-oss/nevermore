"use client";

// @input  -- a frozen knowledge-base version and one question, chosen by a signed-in visitor
// @output -- one brief rendered from message keys, exportable as text
// @pos    -- the only client surface of /tools/geo-brief; it renders, it does not judge

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import {
  GEO_BRIEF_SCHEMA_VERSION,
  type GeoBrief,
  type GeoBriefFact,
} from "../../lib/geo-tools/brief-contract.ts";
import {
  geoBriefFileName,
  geoBriefMarkdown,
} from "../../lib/geo-tools/brief-export.ts";

const LOAD_ENDPOINT = "/api/tools/geo-brief/load";
const RUN_ENDPOINT = "/api/tools/geo-brief/run";
const MAX_QUESTION_CHARS = 300;

/**
 * Every code this page can render a sentence for.
 *
 * Anything outside it renders as the network message rather than as its own
 * key path - next-intl prints a missing key as the key, so an unlisted code
 * would put `tools.geoBrief.errors.something` on the page.
 */
const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set([
  "auth_required",
  "auth_unavailable",
  "cross_origin",
  "invalid_request",
  "payload_too_large",
  "unsupported_media_type",
  "not_found",
  "daily_limit",
  "provider_unconfigured",
  "store_unavailable",
  "brief_unavailable",
  "internal_error",
  "network",
  "unknown",
]);

interface FrozenQuestion {
  readonly id: string;
  readonly text: string;
  readonly layer: string;
  readonly roleId: string | null;
}

interface FrozenChoice {
  readonly kbId: string;
  readonly host: string;
  readonly snapshotId: string;
  readonly revision: number;
  readonly frozenAt: string;
  readonly questions: readonly FrozenQuestion[];
}

interface LoadedChoices {
  readonly choices: readonly FrozenChoice[];
  readonly runsPerDay: number;
  readonly providerConfigured: boolean;
}

type LoadState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly value: LoadedChoices }
  | { readonly kind: "failed"; readonly code: string };

type RunState =
  | { readonly kind: "idle" }
  | { readonly kind: "running" }
  | { readonly kind: "done"; readonly brief: GeoBrief }
  | { readonly kind: "failed"; readonly code: string; readonly limit: number | null };

type CopyState = "idle" | "done" | "failed";

/* ------------------------------------------------------------------ */
/* Runtime shape checks                                                */
/* ------------------------------------------------------------------ */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asQuestion(value: unknown): FrozenQuestion | null {
  const row = asRecord(value);
  if (row === null) return null;
  const id = row["id"];
  const text = row["text"];
  const layer = row["layer"];
  const roleId = row["roleId"];
  if (typeof id !== "string" || typeof text !== "string") return null;
  if (typeof layer !== "string") return null;
  if (roleId !== null && typeof roleId !== "string") return null;
  return { id, text, layer, roleId };
}

/**
 * Validated field by field rather than asserted.
 *
 * A bare `as` is what let a sibling tool read `data.versions` while its server
 * sent `data.choices` - typecheck clean, and every visitor saw an error page.
 * A shape that does not match becomes a stated load failure here.
 */
function asChoice(value: unknown): FrozenChoice | null {
  const row = asRecord(value);
  if (row === null) return null;
  const kbId = row["kbId"];
  const host = row["host"];
  const snapshotId = row["snapshotId"];
  const revision = row["revision"];
  const frozenAt = row["frozenAt"];
  const questions = row["questions"];
  if (typeof kbId !== "string" || typeof host !== "string") return null;
  if (typeof snapshotId !== "string" || typeof frozenAt !== "string") return null;
  if (typeof revision !== "number" || !Number.isFinite(revision)) return null;
  if (!Array.isArray(questions)) return null;
  const parsed: FrozenQuestion[] = [];
  for (const entry of questions) {
    const question = asQuestion(entry);
    if (question === null) return null;
    parsed.push(question);
  }
  return { kbId, host, snapshotId, revision, frozenAt, questions: parsed };
}

function asLoaded(value: unknown): LoadedChoices | null {
  const row = asRecord(value);
  if (row === null) return null;
  const choices = row["choices"];
  const runsPerDay = row["runsPerDay"];
  const providerConfigured = row["providerConfigured"];
  if (!Array.isArray(choices)) return null;
  if (typeof runsPerDay !== "number" || !Number.isFinite(runsPerDay)) return null;
  if (typeof providerConfigured !== "boolean") return null;
  const parsed: FrozenChoice[] = [];
  for (const entry of choices) {
    const choice = asChoice(entry);
    if (choice === null) return null;
    parsed.push(choice);
  }
  return { choices: parsed, runsPerDay, providerConfigured };
}

function asBrief(value: unknown): GeoBrief | null {
  const row = asRecord(value);
  if (row === null) return null;
  if (row["schemaVersion"] !== GEO_BRIEF_SCHEMA_VERSION) return null;
  for (const key of ["origin", "leadAnswer"]) {
    if (asRecord(row[key]) === null) return null;
  }
  for (const key of ["mustAnswer", "outline", "facts", "wontSay", "citedDomains", "limits"]) {
    if (!Array.isArray(row[key])) return null;
  }
  if (typeof row["generatedAt"] !== "string") return null;
  return row as unknown as GeoBrief;
}

function errorCode(payload: unknown, fallback: string): string {
  const error = asRecord(asRecord(payload)?.["error"]);
  const code = error?.["code"];
  return typeof code === "string" && KNOWN_ERROR_CODES.has(code)
    ? code
    : fallback;
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function SourceChip({ source }: { readonly source: string }) {
  const t = useTranslations("tools.geoBrief");
  return (
    <span className="rounded-full border border-brand-border-card px-2 py-0.5 text-[11px] text-text-dark-secondary">
      {t(`sources.${source}`)}
    </span>
  );
}

function FactRow({ fact }: { readonly fact: GeoBriefFact }) {
  const t = useTranslations("tools.geoBrief");
  return (
    <li className="grid gap-1 border-t border-brand-border-card py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13.5px] text-text-dark-primary">{fact.key}</span>
        <SourceChip source={fact.source} />
      </div>
      {fact.value === null ? (
        // Named, never blank. A blank cell in a fact table reads like a value.
        <p className="text-[13.5px] text-text-dark-secondary">
          {t("facts.notVerified", {
            reason: t(`facts.reasons.${fact.reason ?? "lowConfidence"}`),
          })}
        </p>
      ) : (
        <p className="text-[13.5px] text-text-dark-primary">{fact.value}</p>
      )}
      {fact.sourceUrl === null ? null : (
        <a
          className="text-[12.5px] text-brand-accent-text underline"
          href={fact.sourceUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          {fact.sourceUrl}
        </a>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* The tool                                                            */
/* ------------------------------------------------------------------ */

export function LegacyGeoBriefTool() {
  const t = useTranslations("tools.geoBrief");
  const [load, setLoad] = useState<LoadState>({ kind: "idle" });
  const [kbId, setKbId] = useState("");
  const [questionId, setQuestionId] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [run, setRun] = useState<RunState>({ kind: "idle" });
  const [copied, setCopied] = useState<CopyState>("idle");
  const typedInput = useRef<HTMLTextAreaElement | null>(null);

  const loadChoices = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const response = await fetch(LOAD_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const payload: unknown = await response.json().catch(() => null);
      const value = response.ok ? asLoaded(asRecord(payload)?.["data"]) : null;
      if (value === null) {
        setLoad({ kind: "failed", code: errorCode(payload, "unknown") });
        return;
      }
      setLoad({ kind: "ready", value });
      const first = value.choices[0];
      if (first !== undefined) {
        setKbId(first.kbId);
        setQuestionId(first.questions[0]?.id ?? null);
      }
    } catch {
      setLoad({ kind: "failed", code: "network" });
    }
  }, []);

  const ready = load.kind === "ready" ? load.value : null;
  const choice = useMemo(
    () => ready?.choices.find((entry) => entry.kbId === kbId) ?? null,
    [kbId, ready],
  );

  const questionText =
    questionId === null
      ? typed.trim()
      : (choice?.questions.find((entry) => entry.id === questionId)?.text ?? "");

  const submit = useCallback(async () => {
    if (choice === null) return;
    if (questionId === null && typed.trim().length === 0) {
      typedInput.current?.focus();
      return;
    }
    setRun({ kind: "running" });
    setCopied("idle");
    try {
      const response = await fetch(RUN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kbId: choice.kbId,
          snapshotId: choice.snapshotId,
          questionId,
          questionText,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const brief = response.ok
        ? asBrief(asRecord(asRecord(payload)?.["data"])?.["brief"])
        : null;
      if (brief !== null) {
        setRun({ kind: "done", brief });
        return;
      }
      const limit = asRecord(payload)?.["limit"];
      setRun({
        kind: "failed",
        code: errorCode(payload, response.ok ? "brief_unavailable" : "unknown"),
        limit: typeof limit === "number" ? limit : null,
      });
    } catch {
      setRun({ kind: "failed", code: "network", limit: null });
    }
  }, [choice, questionId, questionText, typed]);

  const brief = run.kind === "done" ? run.brief : null;

  const markdown = useMemo(() => {
    if (brief === null) return "";
    return geoBriefMarkdown(brief, {
      title: t("title"),
      question: t("export.question"),
      leadAnswer: t("leadAnswer.title"),
      requiredEntities: t("leadAnswer.entities"),
      mustAnswer: t("mustAnswer.title"),
      outline: t("outline.title"),
      facts: t("facts.title"),
      wontSay: t("wontSay.title"),
      citedDomains: t("citedDomains.title"),
      limits: t("limitsTitle"),
      notVerified: t("export.notVerified"),
      sourceKb: t("sources.kb"),
      sourceCrawl: t("sources.crawl"),
      sourceSample: t("sources.ai_sample"),
      sourceModel: t("sources.model"),
      generatedAt: t("export.generatedAt"),
      limitLines: brief.limits.map((limit) => t(`limits.${limit}`)),
    });
  }, [brief, t]);

  const copyBrief = useCallback(async () => {
    if (markdown.length === 0) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied("done");
    } catch {
      // Silent failure is worse than none: the visitor pastes whatever was on
      // the clipboard before and never learns this button did nothing.
      setCopied("failed");
    }
  }, [markdown]);

  const download = useCallback(
    (extension: "md" | "json") => {
      if (brief === null) return;
      const body = extension === "md" ? markdown : JSON.stringify(brief, null, 2);
      const blob = new Blob([body], {
        type: extension === "md" ? "text/markdown" : "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = geoBriefFileName(brief, extension);
      anchor.click();
      URL.revokeObjectURL(url);
    },
    [brief, markdown],
  );

  return (
    <div className="mt-10 grid gap-10">
      <p aria-live="polite" className="sr-only" role="status">
        {run.kind === "running" ? t("running") : ""}
      </p>

      {load.kind === "idle" ? (
        <button
          className="justify-self-start rounded-full bg-brand-accent px-5 py-2.5 text-[14px] text-brand-accent-contrast"
          onClick={() => void loadChoices()}
          type="button"
        >
          {t("form.load")}
        </button>
      ) : null}

      {load.kind === "loading" ? (
        <p className="text-[13.5px] text-text-dark-secondary">{t("form.loading")}</p>
      ) : null}

      {load.kind === "failed" ? (
        <p className="text-[13.5px] text-brand-error">
          {t(`errors.${load.code}`)}
        </p>
      ) : null}

      {ready !== null && ready.choices.length === 0 ? (
        <p className="text-[13.5px] text-text-dark-secondary">{t("form.noFrozen")}</p>
      ) : null}

      {ready !== null && ready.choices.length > 0 ? (
        <section className="grid gap-4">
          <label className="grid gap-2">
            <span className="text-[13px] text-text-dark-secondary">
              {t("form.version")}
            </span>
            <select
              className="rounded-xl border border-brand-border-card bg-transparent px-3 py-2 text-[14px] text-text-dark-primary"
              onChange={(event) => {
                setKbId(event.target.value);
                const next = ready.choices.find(
                  (entry) => entry.kbId === event.target.value,
                );
                setQuestionId(next?.questions[0]?.id ?? null);
              }}
              value={kbId}
            >
              {ready.choices.map((entry) => (
                <option key={entry.kbId} value={entry.kbId}>
                  {t("form.versionOption", {
                    host: entry.host,
                    revision: entry.revision,
                  })}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2">
            <span className="text-[13px] text-text-dark-secondary">
              {t("form.question")}
            </span>
            <select
              className="rounded-xl border border-brand-border-card bg-transparent px-3 py-2 text-[14px] text-text-dark-primary"
              onChange={(event) =>
                setQuestionId(event.target.value === "" ? null : event.target.value)
              }
              value={questionId ?? ""}
            >
              {(choice?.questions ?? []).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.text}
                </option>
              ))}
              <option value="">{t("form.typeYourOwn")}</option>
            </select>
          </label>

          {questionId === null ? (
            <label className="grid gap-2">
              <span className="text-[13px] text-text-dark-secondary">
                {t("form.typedQuestion")}
              </span>
              <textarea
                className="min-h-[80px] rounded-xl border border-brand-border-card bg-transparent px-3 py-2 text-[14px] text-text-dark-primary"
                maxLength={MAX_QUESTION_CHARS}
                onChange={(event) => setTyped(event.target.value)}
                ref={typedInput}
                value={typed}
              />
              <span className="text-[12.5px] text-text-dark-secondary">
                {t("form.typedNote")}
              </span>
            </label>
          ) : null}

          <p className="text-[13px] text-text-dark-secondary">
            {t("form.estimate", { runs: ready.runsPerDay })}
          </p>

          {ready.providerConfigured ? null : (
            <p className="text-[13.5px] text-brand-error">
              {t("errors.provider_unconfigured")}
            </p>
          )}

          <button
            className="justify-self-start rounded-full bg-brand-accent px-5 py-2.5 text-[14px] text-brand-accent-contrast disabled:opacity-50"
            disabled={!ready.providerConfigured || run.kind === "running"}
            onClick={() => void submit()}
            type="button"
          >
            {run.kind === "running" ? t("form.submitting") : t("form.submit")}
          </button>
        </section>
      ) : null}

      {run.kind === "failed" ? (
        <p className="text-[13.5px] text-brand-error">
          {t(`errors.${run.code}`, { limit: run.limit ?? 0 })}
        </p>
      ) : null}

      {brief === null ? null : (
        <section className="grid gap-8">
          <div className="grid gap-2">
            <h2 className="text-[18px] text-text-dark-primary">
              {t("leadAnswer.title")}
            </h2>
            <p className="text-[14px] leading-[1.7] text-text-dark-primary">
              {brief.leadAnswer.requirement}
            </p>
            {brief.leadAnswer.requiredEntities.length === 0 ? null : (
              <>
                <p className="text-[13px] text-text-dark-secondary">
                  {t("leadAnswer.entities")}
                </p>
                <ul className="flex flex-wrap gap-2">
                  {brief.leadAnswer.requiredEntities.map((entity) => (
                    <li
                      className="rounded-full border border-brand-border-card px-2.5 py-1 text-[12.5px] text-text-dark-primary"
                      key={entity}
                    >
                      {entity}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="grid gap-2">
            <h2 className="text-[18px] text-text-dark-primary">
              {t("mustAnswer.title")}
            </h2>
            <ul className="grid gap-2">
              {brief.mustAnswer.map((item) => (
                <li className="flex flex-wrap items-center gap-2" key={item.id}>
                  <span className="text-[13.5px] text-text-dark-primary">
                    {item.text}
                  </span>
                  <SourceChip source={item.source} />
                </li>
              ))}
            </ul>
          </div>

          {brief.outline.length === 0 ? null : (
            <div className="grid gap-2">
              <h2 className="text-[18px] text-text-dark-primary">
                {t("outline.title")}
              </h2>
              <ol className="grid gap-3">
                {brief.outline.map((section) => (
                  <li className="grid gap-1" key={section.id}>
                    <span className="text-[14px] text-text-dark-primary">
                      {section.heading}
                    </span>
                    <ul className="grid gap-1 pl-4">
                      {section.answers.map((id) => {
                        const item = brief.mustAnswer.find(
                          (entry) => entry.id === id,
                        );
                        return item === undefined ? null : (
                          <li
                            className="text-[13px] text-text-dark-secondary"
                            key={id}
                          >
                            {item.text}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="grid gap-2">
            <h2 className="text-[18px] text-text-dark-primary">
              {t("facts.title")}
            </h2>
            <p className="text-[13px] text-text-dark-secondary">
              {t("facts.note")}
            </p>
            <ul className="grid">
              {brief.facts.map((fact) => (
                <FactRow fact={fact} key={fact.key} />
              ))}
            </ul>
          </div>

          {brief.wontSay.length === 0 ? null : (
            <div className="grid gap-2">
              <h2 className="text-[18px] text-text-dark-primary">
                {t("wontSay.title")}
              </h2>
              <p className="text-[13px] text-text-dark-secondary">
                {t("wontSay.note")}
              </p>
              <ul className="flex flex-wrap gap-2">
                {brief.wontSay.map((key) => (
                  <li
                    className="rounded-full border border-brand-border-card px-2.5 py-1 text-[12.5px] text-text-dark-primary"
                    key={key}
                  >
                    {key}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {brief.citedDomains.length === 0 ? null : (
            <div className="grid gap-2">
              <h2 className="text-[18px] text-text-dark-primary">
                {t("citedDomains.title")}
              </h2>
              <p className="text-[13px] text-text-dark-secondary">
                {t("citedDomains.note")}
              </p>
              <ul className="grid gap-2">
                {brief.citedDomains.map((domain) => (
                  <li className="grid gap-1" key={domain.domain}>
                    <span className="text-[13.5px] text-text-dark-primary">
                      {domain.domain}
                      {domain.isOwn ? ` — ${t("citedDomains.own")}` : ""}
                      {domain.isCompetitor
                        ? ` — ${t("citedDomains.competitor")}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-2">
            <h2 className="text-[18px] text-text-dark-primary">
              {t("limitsTitle")}
            </h2>
            <ul className="grid gap-1">
              {brief.limits.map((limit) => (
                <li className="text-[13px] text-text-dark-secondary" key={limit}>
                  {t(`limits.${limit}`)}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-full border border-brand-border-card px-4 py-2 text-[13.5px] text-text-dark-primary"
              onClick={() => void copyBrief()}
              type="button"
            >
              {copied === "done"
                ? t("actions.copied")
                : copied === "failed"
                  ? t("actions.copyFailed")
                  : t("actions.copy")}
            </button>
            <button
              className="rounded-full border border-brand-border-card px-4 py-2 text-[13.5px] text-text-dark-primary"
              onClick={() => download("md")}
              type="button"
            >
              {t("actions.downloadMarkdown")}
            </button>
            <button
              className="rounded-full border border-brand-border-card px-4 py-2 text-[13.5px] text-text-dark-primary"
              onClick={() => download("json")}
              type="button"
            >
              {t("actions.downloadJson")}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

export { GeoBriefSharedTool as GeoBriefTool } from "./geo-brief-shared-tool.tsx";
