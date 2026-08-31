"use client";
// @input -- exact frozen selectors or a single-use owned-gap handoff
// @output -- Artifact input/result views over the unchanged shared GEO Brief
// @pos -- current /tools/geo-brief client; display context never changes exported evidence
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { GEO_CONTENT_BRIEF_SCHEMA, type GeoContentBrief } from "@sf/public-tools/content-brief/geo-contract";
import { parseGeoContentBrief } from "@sf/public-tools/content-brief/parse-geo-brief";
import { consumeGeoGapHandoff, type GeoGapHandoff } from "../../lib/geo-tools/gap-handoff.ts";
import { localePath } from "../../lib/locale-path.ts";
import { parseLoadedBriefChoices, record, type LoadedBriefChoices, type BriefInputContext } from "./geo-brief-load.ts";
import { SharedGeoBriefResults } from "./geo-brief-shared-results.tsx";
import styles from "./geo-brief-workspace.module.css";

export { SharedGeoBriefResults } from "./geo-brief-shared-results.tsx";

const ERRORS = new Set(["auth_required", "auth_unavailable", "invalid_request", "not_found", "daily_limit", "provider_unconfigured", "unsupported_language", "store_unavailable", "brief_unavailable", "internal_error", "network", "gap_not_eligible", "run_evidence_unavailable", "handoff_invalid"]);
function failure(payload: unknown): string {
  const code = record(record(payload)?.error)?.code;
  return typeof code === "string" && ERRORS.has(code) ? code : "unknown";
}

export function GeoBriefSharedTool() {
  const t = useTranslations("tools.geoBrief");
  const locale = useLocale();
  const [choices, setChoices] = useState<LoadedBriefChoices | null>(null);
  const [snapshotId, setSnapshotId] = useState("");
  const [questionId, setQuestionId] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [handoff, setHandoff] = useState<GeoGapHandoff | null>(null);
  const [context, setContext] = useState<BriefInputContext | null>(null);
  const [brief, setBrief] = useState<GeoContentBrief | null>(null);
  const [view, setView] = useState<"input" | "result">("input");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const inFlight = useRef(false);
  const resultRegion = useRef<HTMLDivElement>(null);
  const choice = useMemo(() => choices?.choices.find(item => item.snapshotId === snapshotId) ?? null, [choices, snapshotId]);
  const question = choice?.questions.find(item => item.id === questionId) ?? null;

  const loadChoices = useCallback(async (pointer: GeoGapHandoff | null = null) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); setBrief(null); setView("input");
    try {
      const body = pointer === null ? {} : {
        schema: GEO_CONTENT_BRIEF_SCHEMA, kbId: pointer.kbId, snapshotId: pointer.snapshotId,
        questionId: pointer.questionId, runId: pointer.runId, gapId: pointer.gapId,
      };
      const response = await fetch("/api/tools/geo-brief/load", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const payload: unknown = await response.json();
      const data = response.ok ? parseLoadedBriefChoices(record(payload)?.data) : null;
      if (data === null) { setError(failure(payload)); return; }
      const first = pointer === null ? data.choices[0] : data.choices.find(item => item.kbId === pointer.kbId && item.snapshotId === pointer.snapshotId);
      if (pointer && (!first || !first.questions.some(item => item.id === pointer.questionId) || data.context?.runRef.id !== pointer.runId)) {
        setError("handoff_invalid"); return;
      }
      setChoices(data); setSnapshotId(first?.snapshotId ?? "");
      setQuestionId(pointer?.questionId ?? first?.questions[0]?.id ?? null);
      setHandoff(pointer); setContext(pointer ? data.context : null);
    } catch { setError("network"); }
    finally { inFlight.current = false; setBusy(false); }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    try {
      const pointer = consumeGeoGapHandoff(window.sessionStorage);
      if (pointer) void loadChoices(pointer);
    } catch { /* The explicit manual entrance remains usable if storage is blocked. */ }
  }, [loadChoices]);
  useEffect(() => { if (brief) resultRegion.current?.focus(); }, [brief]);

  const invalidate = () => {
    setBrief(null); setView("input"); setHandoff(null); setContext(null); setError(null);
  };
  const run = async () => {
    if (inFlight.current || !choice || !choices?.providerConfigured || (questionId === null && !manual.trim())) return;
    inFlight.current = true; setBusy(true); setError(null); setBrief(null);
    try {
      const response = await fetch("/api/tools/geo-brief/run", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schema: GEO_CONTENT_BRIEF_SCHEMA, kbId: choice.kbId, snapshotId: choice.snapshotId, questionId,
          manualQuestion: questionId === null ? manual.trim() : null, runId: handoff?.runId ?? null, gapId: handoff?.gapId ?? null,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) { setError(failure(payload)); return; }
      const parsed = await parseGeoContentBrief(record(record(payload)?.data)?.brief);
      if (!parsed.ok) { setError("brief_unavailable"); return; }
      setBrief(parsed.value); setView("result");
    } catch { setError("network"); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const displayRole = brief && choice?.snapshotId === brief.geo_origin.kb_ref.snapshot_id && question?.id === brief.geo_origin.question.id
    ? question.role?.label : undefined;

  return <div data-geo-workspace className={styles.workspace} aria-busy={busy}>
    <div className={styles.context}>
      <span className={styles.brand}>GENGROWTH · GEO</span>
      {choice ? <>
        <span className={styles.badge}>{choice.host}</span>
        <span className={[styles.badge, styles.frozen].join(" ")}>{t("artifact.frozen", { revision: choice.revision })}</span>
        <span className={styles.badge}>{t("artifact.questions", { count: choice.questions.length })}</span>
      </> : null}
    </div>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>{localePath(locale, "/tools/geo-brief")} · {t("artifact.output")}</p>
        <h1 className={styles.title}>{t("title")}</h1>
      </div>
      <div className={styles.viewControls} role="group" aria-label={t("artifact.viewLabel")}>
        <button className={styles.viewButton} type="button" data-geo-view="input" aria-pressed={view === "input"} onClick={() => setView("input")}>{t("artifact.input")}</button>
        <button className={styles.viewButton} type="button" data-geo-view="result" aria-pressed={view === "result"} disabled={!brief} onClick={() => setView("result")}>{t("artifact.result")}</button>
      </div>
    </header>

    {view === "input" ? <div>
      <aside className={styles.notice}>
        <h2 className={styles.noticeTitle}>{t("artifact.noticeTitle")}</h2>
        <p>{t("artifact.noticeBody")}</p>
      </aside>
      {!choices ? <button type="button" data-load-geo-brief disabled={busy} onClick={() => void loadChoices()} className={styles.primary}>{t(busy ? "form.loading" : "form.load")}</button> : null}
      {choices?.choices.length === 0 ? <div className={styles.notice}>
        <p>{t("form.noFrozen")}</p>
        <a className={styles.secondary} href={localePath(locale, "/tools/geo-knowledge-base")}>{t("artifact.createKnowledge")}</a>
      </div> : null}
      {choice ? <form onSubmit={event => { event.preventDefault(); void run(); }}>
        <h2 className={styles.sectionTitle}>{t("artifact.input")}</h2>
        <div className={styles.panel}>
          <div className={styles.row}>
            <label className={styles.label} htmlFor="geo-brief-question">{t("artifact.question")} <span className={styles.required}>*</span></label>
            <div className={styles.rowContent}>
              <select id="geo-brief-question" disabled={busy} className={styles.field} value={questionId ?? ""} onChange={event => { invalidate(); setQuestionId(event.target.value || null); }}>
                {choice.questions.map(item => <option key={item.id} value={item.id}>{item.text}</option>)}
                <option value="">{t("form.typeYourOwn")}</option>
              </select>
              {question ? <p data-geo-question-preview className={styles.questionPreview}>{question.text}</p> : null}
              {questionId === null ? <>
                <label className={styles.hint} htmlFor="geo-brief-manual">{t("form.typedQuestion")}</label>
                <textarea id="geo-brief-manual" required disabled={busy} className={styles.field} maxLength={300} value={manual} onChange={event => { invalidate(); setManual(event.target.value); }} />
                <p className={styles.hint}>{t("shared.manualNote")}</p>
              </> : <p className={styles.hint}>{t("artifact.questionHint", { layer: question?.layer ?? "—", id: questionId })}</p>}
            </div>
          </div>
          <div className={styles.row}>
            <div className={styles.label}>{t("artifact.gap")}</div>
            <div className={styles.rowContent}>
              <div data-geo-gap className={styles.value}>{context ? t(context.gap === "A" ? "artifact.gapA" : "artifact.gapD") : t("artifact.noGap")}</div>
              <p className={styles.hint}>{t("artifact.gapHint")}</p>
              {context ? <details className={styles.hint}>
                <summary>{t("artifact.evidencePointer")} · {context.samples.length}</summary>
                <p>run: {context.runRef.id}</p>
                <p>{context.runRef.fingerprint}</p>
                {context.samples.map(sample => <p key={sample.id}>{sample.id} · {sample.engine} · {sample.status} · {sample.collectedAt}</p>)}
              </details> : null}
            </div>
          </div>
          <div className={styles.row}>
            <div className={styles.label}>{t("artifact.role")}</div>
            <div className={styles.rowContent}>
              <div data-geo-role className={styles.value}>
                {question?.role ? question.role.label + (question.role.segment ? " · " + question.role.segment : "") : question?.roleId ?? t("artifact.noRole")}
              </div>
              <p className={styles.hint}>{questionId === null ? t("shared.manualNote") : t("artifact.roleHint")}</p>
            </div>
          </div>
          <div className={styles.row}>
            <label className={styles.label} htmlFor="geo-brief-version">{t("artifact.knowledge")} <span className={styles.required}>*</span></label>
            <div className={styles.rowContent}>
              <select id="geo-brief-version" disabled={busy} className={styles.field} value={snapshotId} onChange={event => {
                const next = choices?.choices.find(item => item.snapshotId === event.target.value);
                invalidate(); setSnapshotId(event.target.value); setQuestionId(next?.questions[0]?.id ?? null);
              }}>
                {choices?.choices.map(item => <option key={item.snapshotId} value={item.snapshotId}>{t("form.versionOption", { host: item.host, revision: item.revision })}</option>)}
              </select>
              <p className={styles.hint}>{choice.promptsetRef ? choice.promptsetRef.schema + " · " + choice.promptsetRef.registryVersion : t("artifact.noMetadata")}</p>
              <p className={styles.hint}>{t("artifact.knowledgeHint")}</p>
              <details className={styles.hint}>
                <summary>{t("artifact.exactReferences")}</summary>
                <dl>
                  <div><dt>snapshot_id</dt><dd>{choice.snapshotId}</dd></div>
                  <div><dt>content_hash</dt><dd>{choice.contentHash ?? "—"}</dd></div>
                  <div><dt>promptset_hash</dt><dd>{choice.promptsetRef?.hash ?? "—"}</dd></div>
                  <div><dt>frozen_at</dt><dd><time dateTime={choice.frozenAt}>{choice.frozenAt}</time></dd></div>
                </dl>
              </details>
            </div>
          </div>
        </div>
        <div className={styles.actions}>
          <button data-run-geo-brief type="submit" className={styles.primary} disabled={busy || !choices?.providerConfigured || (questionId === null && !manual.trim())}>{t(busy ? "form.submitting" : "artifact.submit")}</button>
          <p className={styles.hint}>{t("form.estimate", { runs: choices?.runsPerDay ?? 20 })}</p>
        </div>
        {!choices?.providerConfigured ? <p role="status" className={styles.hint}>{t("errors.provider_unconfigured")}</p> : null}
      </form> : null}
    </div> : brief ? <div ref={resultRegion} tabIndex={-1} aria-label={t("artifact.result")}>
      <SharedGeoBriefResults brief={brief} {...(displayRole ? { roleLabel: displayRole } : {})} />
    </div> : null}
    {error ? <p role="alert" className={styles.error}>{t("errors." + error, { limit: choices?.runsPerDay ?? 20 })}</p> : null}
  </div>;
}
