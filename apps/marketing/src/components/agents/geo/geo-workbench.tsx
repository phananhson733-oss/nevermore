// @input  -- visitor context, the session probe, and the GEO run API
// @output -- a four-stage sampling workbench with a sign-in gate before any billing
// @pos    -- primary client workbench for the independent /agents/geo route

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Radar } from "lucide-react";

import { SignInDialog } from "../../auth/sign-in-dialog";
import {
  generateGeoQuestions,
  type GeneratedGeoQuestion,
} from "../../../lib/agents/geo-questions";
import {
  AGENT_GEO_REPORT_SCHEMA_VERSION,
  GEO_QUESTIONS_PER_RUN,
  GEO_SAMPLES_PER_QUESTION,
  isGeoReportSuccessEnvelope,
  type GeoReportData,
} from "../../../lib/agents/geo-report-contract";
import { GeoReportView } from "./geo-report-view";

type Stage = "context" | "questions" | "running" | "report";
type SessionStatus = "signed_in" | "signed_out" | "unavailable";

async function getSessionStatus(signal?: AbortSignal): Promise<SessionStatus> {
  const response = await fetch("/api/auth/session", {
    signal,
    cache: "no-store",
  });
  if (!response.ok) return "unavailable";
  const body = (await response.json()) as { readonly signedIn?: unknown };
  if (body.signedIn === true) return "signed_in";
  if (body.signedIn === false) return "signed_out";
  return "unavailable";
}

function splitList(value: string): readonly string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 6);
}

const FIELD_CLASS =
  "h-11 w-full rounded-[10px] border border-brand-border-strong bg-brand-panel-sunken px-3 text-[13.5px] text-text-dark-primary placeholder:text-text-dark-tertiary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";
const LABEL_CLASS = "block text-[12px] font-medium text-text-dark-primary";
const HINT_CLASS = "mt-1 text-[11.5px] leading-[1.55] text-text-dark-secondary";
const PRIMARY_BUTTON_CLASS =
  "inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-brand-accent/50 bg-brand-panel px-5 text-[13.5px] font-medium text-text-dark-primary transition-colors hover:border-brand-accent disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";
const GHOST_BUTTON_CLASS =
  "inline-flex h-11 items-center justify-center rounded-[10px] border border-brand-border-strong bg-transparent px-4 text-[13px] text-text-dark-secondary transition-colors hover:text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";

export function GeoWorkbench({ locale }: { readonly locale: string }) {
  const t = useTranslations("agents.geo");
  const [stage, setStage] = useState<Stage>("context");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState("");
  const [buyer, setBuyer] = useState("");
  const [rivals, setRivals] = useState("");
  const [rivalDomains, setRivalDomains] = useState("");
  const [questions, setQuestions] = useState<readonly GeneratedGeoQuestion[]>(
    [],
  );
  const [report, setReport] = useState<GeoReportData | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);

  // Concurrency control lives in refs so a second submit cannot start a second
  // paid run, and so an unmounted component never writes state.
  const mounted = useRef(true);
  const busy = useRef(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);

  const errorMessage = useCallback(
    (code: string | null): string | null => {
      if (code === null) return null;
      const known = [
        "auth_required",
        "auth_unavailable",
        "invalid_request",
        "geo_client_outdated",
        "geo_budget_exhausted",
        "geo_budget_unavailable",
        "geo_report_invalid",
      ];
      return t(`errors.${known.includes(code) ? code : "unknown"}`);
    },
    [t],
  );

  const handleGenerate = useCallback(() => {
    setErrorCode(null);
    setQuestions(
      generateGeoQuestions({
        category,
        buyer,
        rivals: splitList(rivals),
      }),
    );
    setStage("questions");
  }, [buyer, category, rivals]);

  const handleQuestionEdit = useCallback((id: string, value: string) => {
    setQuestions((current) =>
      current.map((question) =>
        question.questionId === id
          ? { ...question, question: value }
          : question,
      ),
    );
  }, []);

  const handleRun = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setErrorCode(null);

    try {
      // Checked before the request so a signed-out visitor sees the dialog
      // instead of a 401, and so no paid call is ever attempted for them.
      const session = await getSessionStatus();
      if (session !== "signed_in") {
        if (!mounted.current) return;
        setErrorCode(session === "unavailable" ? "auth_unavailable" : null);
        if (session === "signed_out") setSignInOpen(true);
        return;
      }

      if (!mounted.current) return;
      setStage("running");

      const controller = new AbortController();
      abort.current = controller;
      const response = await fetch("/api/agents/geo/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          // Declares which contract this bundle can read. A tab left open
          // across a deploy still runs the previous guard, and the server
          // refuses the run on this field alone rather than after billing 24
          // provider calls for a report this client would then discard.
          schemaVersion: AGENT_GEO_REPORT_SCHEMA_VERSION,
          targetUrl: url.trim(),
          marketCode: "US",
          languageCode: locale === "zh" ? "zh" : "en",
          // Left to the server, which derives the brand token from the target
          // host. Sending one from here would make "was the brand named?"
          // depend on what this form remembered to include.
          brandTokens: [],
          competitorHosts: splitList(rivalDomains),
          questions: questions.map((question) => ({
            questionId: question.questionId,
            question: question.question.trim(),
          })),
        }),
      });

      const envelope: unknown = await response.json().catch(() => null);
      if (!mounted.current) return;

      if (!response.ok) {
        const code =
          typeof envelope === "object" &&
          envelope !== null &&
          "error" in envelope &&
          typeof (envelope as { error?: { code?: unknown } }).error?.code ===
            "string"
            ? (envelope as { error: { code: string } }).error.code
            : "unknown";
        setErrorCode(code);
        setStage("questions");
        return;
      }

      // Validated with the same guard the server used. A payload that fails
      // here is a contract break, not a report, and is never rendered.
      if (!isGeoReportSuccessEnvelope(envelope)) {
        setErrorCode("geo_report_invalid");
        setStage("questions");
        return;
      }

      setReport(envelope.data);
      setStage("report");
    } catch {
      if (!mounted.current) return;
      setErrorCode("unknown");
      setStage("questions");
    } finally {
      busy.current = false;
      abort.current = null;
    }
  }, [category, locale, questions, rivalDomains, url]);

  const contextReady =
    url.trim().length > 3 &&
    category.trim().length > 1 &&
    buyer.trim().length > 1;
  const questionsReady =
    questions.length > 0 &&
    questions.length <= GEO_QUESTIONS_PER_RUN &&
    questions.every(
      (question) =>
        question.question.trim().length > 5 &&
        question.question.trim().length <= 500,
    );
  const sampleCount = questions.length * GEO_SAMPLES_PER_QUESTION;
  const message = errorMessage(errorCode);

  return (
    <div id="geo-agent-workbench" className="scroll-mt-24">
      {message !== null && (
        <p
          role="alert"
          className="mb-4 rounded-row border border-brand-border-dashed bg-brand-panel-sunken px-4 py-3 text-[12.5px] text-text-dark-primary"
        >
          {message}
        </p>
      )}

      {stage === "context" && (
        <section className="rounded-card border border-brand-border-card bg-brand-panel-sunken p-5 md:p-6">
          <h2 className="text-[16px] font-semibold text-text-dark-primary">
            {t("workbench.contextTitle")}
          </h2>
          <p className={HINT_CLASS}>{t("workbench.contextHint")}</p>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <label className={LABEL_CLASS} htmlFor="geo-url">
                {t("workbench.urlLabel")}
              </label>
              <input
                id="geo-url"
                className={`${FIELD_CLASS} mt-1.5`}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={t("workbench.urlPlaceholder")}
                autoComplete="url"
                inputMode="url"
              />
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="geo-category">
                {t("workbench.categoryLabel")}
              </label>
              <input
                id="geo-category"
                className={`${FIELD_CLASS} mt-1.5`}
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder={t("workbench.categoryPlaceholder")}
              />
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="geo-buyer">
                {t("workbench.buyerLabel")}
              </label>
              <input
                id="geo-buyer"
                className={`${FIELD_CLASS} mt-1.5`}
                value={buyer}
                onChange={(event) => setBuyer(event.target.value)}
                placeholder={t("workbench.buyerPlaceholder")}
              />
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="geo-rivals">
                {t("workbench.rivalsLabel")}
              </label>
              <input
                id="geo-rivals"
                className={`${FIELD_CLASS} mt-1.5`}
                value={rivals}
                onChange={(event) => setRivals(event.target.value)}
              />
              <p className={HINT_CLASS}>{t("workbench.rivalsHint")}</p>
            </div>
            <div className="md:col-span-2">
              <label className={LABEL_CLASS} htmlFor="geo-rival-domains">
                {t("workbench.rivalDomainsLabel")}
              </label>
              <input
                id="geo-rival-domains"
                className={`${FIELD_CLASS} mt-1.5`}
                value={rivalDomains}
                onChange={(event) => setRivalDomains(event.target.value)}
              />
              <p className={HINT_CLASS}>{t("workbench.rivalDomainsHint")}</p>
            </div>
          </div>

          <button
            type="button"
            className={`${PRIMARY_BUTTON_CLASS} mt-5`}
            disabled={!contextReady}
            onClick={handleGenerate}
          >
            {t("workbench.generate")}
            <Radar aria-hidden="true" className="size-4" />
          </button>
        </section>
      )}

      {(stage === "questions" || stage === "running") && (
        <section className="rounded-card border border-brand-border-card bg-brand-panel-sunken p-5 md:p-6">
          <h2 className="text-[16px] font-semibold text-text-dark-primary">
            {t("workbench.questionsTitle")}
          </h2>
          <p className={HINT_CLASS}>{t("workbench.questionsHint")}</p>
          <p className="mt-1 font-mono text-[11px] text-brand-accent-text">
            {t("workbench.questionCount", {
              count: questions.length,
              samples: sampleCount,
            })}
          </p>

          <ol className="mt-5 grid gap-3">
            {questions.map((question, index) => (
              <li key={question.questionId} className="grid gap-1.5">
                <label
                  className="font-mono text-[10.5px] tracking-[0.1em] text-text-dark-tertiary uppercase"
                  htmlFor={`geo-q-${question.questionId}`}
                >
                  {`0${index + 1}`.slice(-2)} ·{" "}
                  {t(
                    `workbench.stage${
                      question.stage.charAt(0).toUpperCase() +
                      question.stage.slice(1)
                    }`,
                  )}
                </label>
                <input
                  id={`geo-q-${question.questionId}`}
                  className={FIELD_CLASS}
                  value={question.question}
                  maxLength={500}
                  disabled={stage === "running"}
                  onChange={(event) =>
                    handleQuestionEdit(question.questionId, event.target.value)
                  }
                />
              </li>
            ))}
          </ol>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={PRIMARY_BUTTON_CLASS}
              disabled={!questionsReady || stage === "running"}
              onClick={() => {
                void handleRun();
              }}
            >
              {stage === "running" ? (
                <>
                  <Loader2
                    aria-hidden="true"
                    className="size-4 motion-safe:animate-spin"
                  />
                  {t("workbench.running")}
                </>
              ) : (
                t("workbench.run", { samples: sampleCount })
              )}
            </button>
            {stage === "questions" && (
              <button
                type="button"
                className={GHOST_BUTTON_CLASS}
                onClick={() => setStage("context")}
              >
                {t("workbench.back")}
              </button>
            )}
          </div>
          {stage === "running" && (
            <p className={`${HINT_CLASS} mt-3`}>{t("workbench.runningHint")}</p>
          )}
        </section>
      )}

      {stage === "report" && report !== null && (
        <GeoReportView
          report={report}
          locale={locale}
          onRestart={() => {
            setReport(null);
            setStage("questions");
          }}
        />
      )}

      <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
    </div>
  );
}
