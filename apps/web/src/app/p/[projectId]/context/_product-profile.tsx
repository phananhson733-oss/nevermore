"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Database,
  ExternalLink,
  FileSearch,
  Globe2,
  LoaderCircle,
  PencilLine,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import type {
  ProductProfileCompetitorAnalysisScope,
  ProductProfileCompetitorCandidate,
  ProductProfileCompetitorRelationship,
  ProductProfileCompetitorReviewStatus,
  ProductProfileDraft,
  UpdateProductProfileDraftRequest,
} from "@sf/contracts";
import {
  ApiError,
  invalidateProductProfileQueries,
  useAddProductProfileCompetitor,
  useConfirmProductProfile,
  useCreateProductProfileSynthesisRun,
  useProductProfile,
  useProductProfileRun,
  useReviewProductProfileCompetitor,
  useUpdateProductProfileDraft,
} from "@/lib/api";
import {
  useCreateCollectionRun,
  useProjectRun,
} from "@/lib/api/hooks-sources";
import { useQueryClient } from "@tanstack/react-query";
import { setUnsavedContextChanges } from "../_context-navigation-guard";
import {
  buildProductProfileViewModel,
  getFieldFactState,
  type FieldFactState,
} from "./_product-profile-view-model";
import {
  audienceFields,
  buildEditorPatch,
  BUSINESS_MODELS,
  editorStateSignature,
  initialEditorState,
  isCompetitorReviewReady,
  PRODUCT_TYPES,
  type EditorState,
} from "./_product-profile-editor";
import styles from "./_product-profile.module.css";

const MARKET_CODES = [
  "US",
  "GB",
  "CA",
  "AU",
  "DE",
  "FR",
  "NL",
  "ES",
  "IT",
  "JP",
  "KR",
  "SG",
  "AE",
  "IN",
  "BR",
] as const;
const ANALYSIS_SCOPES = [
  "positioning",
  "product_capability",
  "keyword_gap",
  "content",
  "serp_visibility",
] as const satisfies readonly ProductProfileCompetitorAnalysisScope[];

type Feedback = {
  readonly tone: "success" | "error" | "progress";
  readonly title: string;
  readonly detail: string;
  readonly code?: string;
  readonly requestId?: string;
};

function isTerminal(status: string | undefined): boolean {
  return ["completed", "partial", "failed", "cancelled"].includes(status ?? "");
}

function errorFeedback(error: unknown, fallback: string): Feedback {
  if (error instanceof ApiError) {
    return {
      tone: "error",
      title: fallback,
      detail: error.message,
      code: error.code,
      requestId: error.problem.requestId,
    };
  }
  return {
    tone: "error",
    title: fallback,
    detail: error instanceof Error ? error.message : fallback,
  };
}

function formatDate(value: string | null, locale: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function focusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.getAttribute("aria-hidden") !== "true");
}

function ModalFrame({
  open,
  titleId,
  wide = false,
  onRequestClose,
  children,
}: {
  readonly open: boolean;
  readonly titleId: string;
  readonly wide?: boolean;
  readonly onRequestClose: () => void;
  readonly children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const background = Array.from(document.body.children).filter(
      (element) =>
        !element.hasAttribute("data-product-profile-modal-backdrop"),
    );
    const backgroundState = background.map((element) => ({
      element,
      ariaHidden: element.getAttribute("aria-hidden"),
      inert: element.hasAttribute("inert"),
    }));
    background.forEach((element) => {
      element.setAttribute("aria-hidden", "true");
      element.setAttribute("inert", "");
    });
    const focusFrame = requestAnimationFrame(() =>
      focusable(frameRef.current ?? document.body)[0]?.focus(),
    );
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onRequestClose();
        return;
      }
      if (event.key !== "Tab" || !frameRef.current) return;
      const items = focusable(frameRef.current);
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      backgroundState.forEach(({ element, ariaHidden, inert }) => {
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
        if (!inert) element.removeAttribute("inert");
      });
    };
  }, [onRequestClose, open]);
  if (!mounted || !open) return null;
  return createPortal(
    <div
      className={styles.modalBackdrop}
      data-product-profile-modal-backdrop=""
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onRequestClose();
      }}
    >
      <div
        ref={frameRef}
        className={wide ? styles.drawer : styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

function FactPill({ fact }: { readonly fact: FieldFactState }) {
  const t = useTranslations("productProfile");
  return (
    <span className={styles.factPill} data-fact-state={fact.state}>
      {fact.state === "supported" ? <Check size={13} aria-hidden="true" /> : null}
      {t(`facts.${fact.label}`)}
      {fact.state === "supported" && fact.confidence !== "unknown"
        ? ` · ${t(`confidence.${fact.confidence}`)}`
        : null}
    </span>
  );
}

function MissingValue() {
  const t = useTranslations("productProfile");
  return <span className={styles.missingValue}>{t("states.unconfirmed")}</span>;
}

function ValueList({ values }: { readonly values: readonly string[] }) {
  if (values.length === 0) return <MissingValue />;
  return (
    <ul className={styles.valueList}>
      {values.map((value) => (
        <li key={value}>{value}</li>
      ))}
    </ul>
  );
}

function SectionHeading({
  eyebrow,
  title,
  fact,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly fact?: FieldFactState;
}) {
  return (
    <header className={styles.sectionHeading}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {fact ? <FactPill fact={fact} /> : null}
    </header>
  );
}

function ProfileEditor({
  profile,
  open,
  saving,
  onClose,
  onSave,
}: {
  readonly profile: ProductProfileDraft;
  readonly open: boolean;
  readonly saving: boolean;
  readonly onClose: () => void;
  readonly onSave: (patch: UpdateProductProfileDraftRequest["patch"]) => Promise<void>;
}) {
  const t = useTranslations("productProfile");
  const [state, setState] = useState<EditorState>(() => initialEditorState(profile));
  const [discardOpen, setDiscardOpen] = useState(false);
  const baseline = useMemo(
    () => editorStateSignature(initialEditorState(profile)),
    [profile],
  );
  const dirty = editorStateSignature(state) !== baseline;
  const titleId = "product-profile-editor-title";
  useEffect(() => {
    if (open) setState(initialEditorState(profile));
  }, [open, profile]);
  useEffect(() => {
    setUnsavedContextChanges(open && dirty);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!open || !dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      setUnsavedContextChanges(false);
    };
  }, [dirty, open]);

  const requestClose = useCallback(() => {
    if (dirty) setDiscardOpen(true);
    else onClose();
  }, [dirty, onClose]);
  const set = <K extends keyof EditorState>(key: K, value: EditorState[K]) =>
    setState((current) => ({ ...current, [key]: value }));
  const currentAudience = profile.targetAudiences.find(
    (audience) => audience.candidateId === state.primaryAudienceId,
  );

  function switchAudience(id: string) {
    const audience = profile.targetAudiences.find((item) => item.candidateId === id) ?? null;
    setState((current) => ({
      ...current,
      primaryAudienceId: id,
      ...audienceFields(audience),
    }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!dirty) return;
    const patch = buildEditorPatch(profile, state);
    if (Object.keys(patch).length === 0) return;
    await onSave(patch);
  }

  return (
    <>
      <ModalFrame
        open={open && !discardOpen}
        titleId={titleId}
        wide
        onRequestClose={requestClose}
      >
        <form className={styles.editorForm} onSubmit={(event) => void submit(event)}>
          <header className={styles.drawerHeader}>
            <div>
              <p className={styles.eyebrow}>{t("editor.eyebrow")}</p>
              <h2 id={titleId}>{t("editor.title")}</h2>
              <p>{t("editor.description")}</p>
            </div>
            <button type="button" className={styles.iconButton} onClick={requestClose} aria-label={t("actions.close")}>
              <X size={22} aria-hidden="true" />
            </button>
          </header>

          <div className={styles.drawerBody}>
            <fieldset className={styles.formSection}>
              <legend>{t("editor.sections.product")}</legend>
              <label className={styles.field}>
                <span>{t("fields.businessHint")}</span>
                <textarea value={state.businessHint} onChange={(event) => set("businessHint", event.target.value)} rows={3} />
              </label>
              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span>{t("fields.productName")}</span>
                  <input value={state.productName} onChange={(event) => set("productName", event.target.value)} />
                </label>
                <label className={styles.field}>
                  <span>{t("fields.category")}</span>
                  <input value={state.category} onChange={(event) => set("category", event.target.value)} />
                </label>
              </div>
              <label className={styles.field}>
                <span>{t("fields.oneLiner")}</span>
                <textarea value={state.oneLiner} onChange={(event) => set("oneLiner", event.target.value)} rows={3} />
              </label>
              <label className={styles.field}>
                <span>{t("fields.productType")}</span>
                <select value={state.productType} onChange={(event) => set("productType", event.target.value)}>
                  <option value="">{t("editor.choose")}</option>
                  {PRODUCT_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
                  <option value="__custom__">{t("editor.custom")}</option>
                </select>
              </label>
              {state.productType === "__custom__" ? (
                <label className={styles.field}>
                  <span>{t("editor.customProductType")}</span>
                  <input value={state.customProductType} onChange={(event) => set("customProductType", event.target.value)} />
                </label>
              ) : null}
              <div className={styles.field}>
                <span>{t("fields.businessModels")}</span>
                <div className={styles.checkGrid}>
                  {BUSINESS_MODELS.map((model) => (
                    <label key={model} className={styles.checkChoice}>
                      <input
                        type="checkbox"
                        checked={state.businessModels.includes(model)}
                        onChange={(event) => set(
                          "businessModels",
                          event.target.checked
                            ? [...state.businessModels, model]
                            : state.businessModels.filter((item) => item !== model),
                        )}
                      />
                      <span>{model}</span>
                    </label>
                  ))}
                </div>
              </div>
              <label className={styles.field}>
                <span>{t("editor.otherBusinessModels")}</span>
                <textarea value={state.otherBusinessModels} onChange={(event) => set("otherBusinessModels", event.target.value)} rows={2} />
              </label>
              <label className={styles.field}>
                <span>{t("fields.valueProposition")}</span>
                <textarea value={state.valueProposition} onChange={(event) => set("valueProposition", event.target.value)} rows={4} />
              </label>
              <label className={styles.field}>
                <span>{t("fields.coreFeatures")}</span>
                <textarea value={state.coreFeatures} onChange={(event) => set("coreFeatures", event.target.value)} rows={5} />
                <small>{t("editor.onePerLine")}</small>
              </label>
            </fieldset>

            <fieldset className={styles.formSection}>
              <legend>{t("editor.sections.market")}</legend>
              <label className={styles.field}>
                <span>{t("fields.primaryMarket")}</span>
                <select value={state.primaryMarket} onChange={(event) => set("primaryMarket", event.target.value)}>
                  <option value="">{t("editor.choose")}</option>
                  {[...new Set([...MARKET_CODES, ...profile.targetMarkets.map((market) => market.marketCode)])].map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
              </label>
              <div className={styles.field}>
                <span>{t("fields.secondaryMarkets")}</span>
                <div className={styles.checkGrid}>
                  {[...new Set([...MARKET_CODES, ...profile.targetMarkets.map((market) => market.marketCode)])].map((code) => (
                    <label key={code} className={styles.checkChoice}>
                      <input
                        type="checkbox"
                        disabled={code === state.primaryMarket}
                        checked={state.secondaryMarkets.includes(code)}
                        onChange={(event) => set(
                          "secondaryMarkets",
                          event.target.checked
                            ? [...state.secondaryMarkets, code]
                            : state.secondaryMarkets.filter((item) => item !== code),
                        )}
                      />
                      <span>{code}</span>
                    </label>
                  ))}
                </div>
              </div>
            </fieldset>

            <fieldset className={styles.formSection}>
              <legend>{t("editor.sections.icp")}</legend>
              <label className={styles.field}>
                <span>{t("fields.primaryIcp")}</span>
                <select value={state.primaryAudienceId} onChange={(event) => switchAudience(event.target.value)}>
                  <option value="">{t("editor.chooseIcp")}</option>
                  {profile.targetAudiences.filter((audience) => audience.reviewStatus !== "excluded").map((audience) => (
                    <option key={audience.candidateId} value={audience.candidateId}>
                      {audience.targetCompanyOrAudience ?? t("states.unconfirmed")}
                    </option>
                  ))}
                  <option value="__new__">{t("editor.newIcp")}</option>
                </select>
              </label>
              {state.primaryAudienceId ? (
                <>
                  <label className={styles.field}>
                    <span>{t("fields.targetCompanyOrAudience")}</span>
                    <textarea value={state.targetCompanyOrAudience} onChange={(event) => set("targetCompanyOrAudience", event.target.value)} rows={3} />
                  </label>
                  {(["buyerRoles", "userRoles", "useCases", "triggers", "pains", "jtbd", "outcomes", "barriers", "qualificationSignals", "disqualifiers"] as const).map((key) => (
                    <label key={key} className={styles.field}>
                      <span>{t(`fields.${key}`)}</span>
                      <textarea value={state[key]} onChange={(event) => set(key, event.target.value)} rows={3} />
                      <small>{t("editor.onePerLine")}</small>
                    </label>
                  ))}
                </>
              ) : null}
              {currentAudience ? <p className={styles.formNote}>{t("editor.preserveOtherIcp")}</p> : null}
            </fieldset>
          </div>

          <footer className={styles.drawerFooter}>
            <span className={dirty ? styles.dirty : styles.clean} role="status">
              {dirty ? t("editor.unsaved") : t("editor.noChanges")}
            </span>
            <div>
              <button type="button" className={styles.secondaryButton} onClick={requestClose}>{t("actions.cancel")}</button>
              <button type="submit" className={styles.primaryButton} disabled={!dirty || saving}>
                {saving ? <LoaderCircle className={styles.spin} size={17} aria-hidden="true" /> : <Check size={17} aria-hidden="true" />}
                {saving ? t("actions.saving") : t("actions.save")}
              </button>
            </div>
          </footer>
        </form>
      </ModalFrame>

      <ModalFrame open={discardOpen} titleId="discard-profile-title" onRequestClose={() => setDiscardOpen(false)}>
        <div className={styles.confirmDialog}>
          <AlertTriangle size={24} aria-hidden="true" />
          <h2 id="discard-profile-title">{t("editor.discardTitle")}</h2>
          <p>{t("editor.discardDescription")}</p>
          <div className={styles.dialogActions}>
            <button type="button" className={styles.secondaryButton} onClick={() => setDiscardOpen(false)}>{t("actions.keepEditing")}</button>
            <button type="button" className={styles.dangerButton} onClick={() => { setDiscardOpen(false); onClose(); }}>{t("actions.discard")}</button>
          </div>
        </div>
      </ModalFrame>
    </>
  );
}

interface CompetitorFormState {
  readonly name: string;
  readonly domain: string;
  readonly reviewStatus: ProductProfileCompetitorReviewStatus;
  readonly relationship: ProductProfileCompetitorRelationship | "";
  readonly analysisScope: readonly ProductProfileCompetitorAnalysisScope[];
  readonly reason: string;
}

function CompetitorEditor({
  open,
  candidate,
  saving,
  onClose,
  onSubmit,
}: {
  readonly open: boolean;
  readonly candidate: ProductProfileCompetitorCandidate | null;
  readonly saving: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (state: CompetitorFormState) => Promise<void>;
}) {
  const t = useTranslations("productProfile");
  const [state, setState] = useState<CompetitorFormState>(() => ({
    name: candidate?.name ?? "",
    domain: candidate?.domain ?? "",
    reviewStatus: candidate?.reviewStatus ?? "approved",
    relationship: candidate?.relationship ?? "",
    analysisScope: candidate?.analysisScope ?? [],
    reason: candidate?.reason ?? "",
  }));
  useEffect(() => {
    setState({
      name: candidate?.name ?? "",
      domain: candidate?.domain ?? "",
      reviewStatus: candidate?.reviewStatus ?? "approved",
      relationship: candidate?.relationship ?? "",
      analysisScope: candidate?.analysisScope ?? [],
      reason: candidate?.reason ?? "",
    });
  }, [candidate, open]);
  const titleId = "competitor-editor-title";
  const valid = isCompetitorReviewReady(state);
  return (
    <ModalFrame open={open} titleId={titleId} onRequestClose={onClose}>
      <form className={styles.competitorForm} onSubmit={(event) => { event.preventDefault(); void onSubmit(state); }}>
        <header className={styles.dialogHeader}>
          <div>
            <p className={styles.eyebrow}>{candidate ? t("competitors.reviewEyebrow") : t("competitors.addEyebrow")}</p>
            <h2 id={titleId}>{candidate ? candidate.name : t("competitors.addTitle")}</h2>
          </div>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label={t("actions.close")}><X size={22} aria-hidden="true" /></button>
        </header>
        <div className={styles.dialogBody}>
          <label className={styles.field}>
            <span>{t("competitors.name")}</span>
            <input value={state.name} disabled={candidate !== null} onChange={(event) => setState((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label className={styles.field}>
            <span>{t("competitors.domain")}</span>
            <input value={state.domain} disabled={candidate !== null} inputMode="url" onChange={(event) => setState((current) => ({ ...current, domain: event.target.value.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") }))} />
          </label>
          {candidate ? (
            <label className={styles.field}>
              <span>{t("competitors.status")}</span>
              <select value={state.reviewStatus} onChange={(event) => setState((current) => ({ ...current, reviewStatus: event.target.value as ProductProfileCompetitorReviewStatus }))}>
                <option value="candidate">{t("competitors.statuses.candidate")}</option>
                <option value="approved">{t("competitors.statuses.approved")}</option>
                <option value="excluded">{t("competitors.statuses.excluded")}</option>
              </select>
            </label>
          ) : null}
          <label className={styles.field}>
            <span>{t("competitors.relationship")}</span>
            <select value={state.relationship} onChange={(event) => setState((current) => ({ ...current, relationship: event.target.value as ProductProfileCompetitorRelationship | "" }))}>
              <option value="">{t("editor.choose")}</option>
              <option value="direct">{t("competitors.relationships.direct")}</option>
              <option value="indirect">{t("competitors.relationships.indirect")}</option>
            </select>
          </label>
          <fieldset className={styles.scopeField}>
            <legend>{t("competitors.scope")}</legend>
            {ANALYSIS_SCOPES.map((scope) => (
              <label key={scope} className={styles.checkChoice}>
                <input type="checkbox" checked={state.analysisScope.includes(scope)} onChange={(event) => setState((current) => ({ ...current, analysisScope: event.target.checked ? [...current.analysisScope, scope] : current.analysisScope.filter((item) => item !== scope) }))} />
                <span>{t(`competitors.scopes.${scope}`)}</span>
              </label>
            ))}
          </fieldset>
          <label className={styles.field}>
            <span>{t("competitors.reason")}</span>
            <textarea value={state.reason} onChange={(event) => setState((current) => ({ ...current, reason: event.target.value }))} rows={3} />
          </label>
          {candidate ? <p className={styles.formNote}>{t("competitors.identityCorrection")}</p> : null}
        </div>
        <footer className={styles.dialogActions}>
          <button type="button" className={styles.secondaryButton} onClick={onClose}>{t("actions.cancel")}</button>
          <button type="submit" className={styles.primaryButton} disabled={!valid || saving}>
            {saving ? <LoaderCircle className={styles.spin} size={17} aria-hidden="true" /> : <Check size={17} aria-hidden="true" />}
            {saving ? t("actions.saving") : t("actions.apply")}
          </button>
        </footer>
      </form>
    </ModalFrame>
  );
}

export function ProductProfilePage({ projectId }: { readonly projectId: string }) {
  const t = useTranslations("productProfile");
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspaceQuery = useProductProfile(projectId);
  const updateMutation = useUpdateProductProfileDraft(projectId);
  const synthesisMutation = useCreateProductProfileSynthesisRun(projectId);
  const reviewMutation = useReviewProductProfileCompetitor(projectId);
  const addMutation = useAddProductProfileCompetitor(projectId);
  const confirmMutation = useConfirmProductProfile(projectId);
  const crawlMutation = useCreateCollectionRun(projectId);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [competitorEditor, setCompetitorEditor] = useState<
    ProductProfileCompetitorCandidate | "add" | null
  >(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [synthesisRunId, setSynthesisRunId] = useState("");
  const [crawlRunId, setCrawlRunId] = useState("");
  const [crawlRequired, setCrawlRequired] = useState(false);
  const completedRuns = useRef(new Set<string>());
  const overlayTrigger = useRef<HTMLButtonElement | null>(null);
  const workspace = workspaceQuery.data;
  const view = workspace ? buildProductProfileViewModel(workspace) : null;
  const profile = view?.profile ?? null;
  const row = view?.row ?? null;
  const activeSynthesisId = workspace?.activeSynthesisRun?.id ?? synthesisRunId;
  const synthesisRun = useProductProfileRun(projectId, activeSynthesisId);
  const crawlRun = useProjectRun(projectId, crawlRunId);
  const regionNames = useMemo(
    () => new Intl.DisplayNames([locale], { type: "region" }),
    [locale],
  );

  useEffect(() => {
    const run = synthesisRun.data;
    if (!run || !isTerminal(run.status) || completedRuns.current.has(run.id)) return;
    completedRuns.current.add(run.id);
    void invalidateProductProfileQueries(queryClient, projectId);
    setSynthesisRunId("");
    if (run.status === "completed") {
      setFeedback({ tone: "success", title: t("feedback.synthesisComplete"), detail: t("feedback.synthesisCompleteDetail") });
    } else {
      setFeedback({
        tone: "error",
        title: t("feedback.synthesisFailed"),
        detail:
          run.lastError?.summary ||
          t("feedback.runEnded", { status: run.status }),
        ...(run.lastError?.code ? { code: run.lastError.code } : {}),
      });
    }
  }, [projectId, queryClient, synthesisRun.data, t]);

  useEffect(() => {
    const run = crawlRun.data;
    if (!run || !isTerminal(run.status) || completedRuns.current.has(run.id)) return;
    completedRuns.current.add(run.id);
    setCrawlRunId("");
    void invalidateProductProfileQueries(queryClient, projectId);
    if (run.status === "completed" || run.status === "partial") {
      setCrawlRequired(false);
      setFeedback({ tone: "success", title: t("feedback.crawlComplete"), detail: t("feedback.crawlCompleteDetail") });
    } else {
      setFeedback({
        tone: "error",
        title: t("feedback.crawlFailed"),
        detail:
          run.lastError?.summary ||
          t("feedback.runEnded", { status: run.status }),
        ...(run.lastError?.code ? { code: run.lastError.code } : {}),
      });
    }
  }, [crawlRun.data, projectId, queryClient, t]);

  if (workspaceQuery.isPending) {
    return <div className={styles.statePanel} role="status"><LoaderCircle className={styles.spin} aria-hidden="true" /><h1>{t("loading.title")}</h1><p>{t("loading.detail")}</p></div>;
  }
  if (workspaceQuery.isError) {
    return <div className={styles.statePanel} role="alert"><AlertTriangle aria-hidden="true" /><h1>{t("errors.loadTitle")}</h1><p>{workspaceQuery.error.message}</p><button type="button" className={styles.primaryButton} onClick={() => void workspaceQuery.refetch()}>{t("actions.retry")}</button></div>;
  }
  if (!workspace || !view || !profile || !row) {
    return <div className={styles.statePanel}><FileSearch aria-hidden="true" /><h1>{t("empty.title")}</h1><p>{t("empty.detail")}</p></div>;
  }

  const editable = row.status === "draft";
  const currentRow = row;
  const activeRun = synthesisRun.data ?? workspace.activeSynthesisRun;
  const primaryAudience = view.primaryAudience;
  const fact = (path: string) => getFieldFactState(profile, path);
  const rememberTrigger = (trigger: HTMLButtonElement) => {
    overlayTrigger.current = trigger;
  };
  const restoreTrigger = () => {
    requestAnimationFrame(() => overlayTrigger.current?.focus());
  };
  const closeEditor = () => {
    setEditorOpen(false);
    restoreTrigger();
  };
  const closeCompetitorEditor = () => {
    setCompetitorEditor(null);
    restoreTrigger();
  };
  const closeConfirmation = () => {
    setConfirmOpen(false);
    restoreTrigger();
  };

  async function saveProfile(patch: UpdateProductProfileDraftRequest["patch"]) {
    try {
      await updateMutation.mutateAsync({ baseVersion: currentRow.version, patch });
      closeEditor();
      setFeedback({ tone: "success", title: t("feedback.saved"), detail: t("feedback.savedDetail") });
    } catch (error) {
      setFeedback(errorFeedback(error, t("feedback.saveFailed")));
    }
  }

  async function synthesize() {
    try {
      const accepted = await synthesisMutation.mutateAsync({
        baseVersion: currentRow.version,
      });
      setSynthesisRunId(accepted.run.id);
      setFeedback({ tone: "progress", title: t("feedback.synthesisQueued"), detail: t("feedback.synthesisQueuedDetail") });
    } catch (error) {
      if (error instanceof ApiError && error.code === "CRAWL_SNAPSHOT_REQUIRED") setCrawlRequired(true);
      setFeedback(errorFeedback(error, t("feedback.synthesisFailed")));
    }
  }

  async function startCrawl() {
    try {
      const accepted = await crawlMutation.mutateAsync({ provider: "crawl" });
      setCrawlRunId(accepted.run.id);
      setFeedback({ tone: "progress", title: t("feedback.crawlQueued"), detail: t("feedback.crawlQueuedDetail") });
    } catch (error) {
      setFeedback(errorFeedback(error, t("feedback.crawlFailed")));
    }
  }

  async function saveCompetitor(state: CompetitorFormState) {
    try {
      if (competitorEditor === "add") {
        await addMutation.mutateAsync({
          baseVersion: currentRow.version,
          name: state.name.trim(),
          domain: state.domain.trim(),
          relationship: state.relationship as ProductProfileCompetitorRelationship,
          analysisScope: [...state.analysisScope],
          ...(state.reason.trim() ? { reason: state.reason.trim() } : {}),
        });
      } else if (competitorEditor) {
        await reviewMutation.mutateAsync({
          candidateId: competitorEditor.candidateId,
          body: {
            baseVersion: currentRow.version,
            reviewStatus: state.reviewStatus,
            relationship: state.relationship || null,
            analysisScope: [...state.analysisScope],
            ...(state.reason.trim() ? { reason: state.reason.trim() } : {}),
          },
        });
      }
      closeCompetitorEditor();
      setFeedback({ tone: "success", title: t("feedback.competitorSaved"), detail: t("feedback.competitorSavedDetail") });
    } catch (error) {
      setFeedback(errorFeedback(error, t("feedback.competitorFailed")));
    }
  }

  async function confirmProfile() {
    try {
      await confirmMutation.mutateAsync({ baseVersion: currentRow.version });
      closeConfirmation();
      router.refresh();
      setFeedback({ tone: "success", title: t("feedback.confirmed"), detail: t("feedback.confirmedDetail") });
    } catch (error) {
      setFeedback(errorFeedback(error, t("feedback.confirmFailed")));
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>{t("heroEyebrow")}</p>
          <h1>{profile.productName ?? t("states.unconfirmed")}</h1>
          <p className={styles.heroLede}>{profile.oneLiner ?? t("states.unconfirmed")}</p>
          <a href={profile.sourcePageUrl} target="_blank" rel="noreferrer" className={styles.sourceLink}>
            {profile.sourcePageUrl}<ExternalLink size={15} aria-hidden="true" />
          </a>
        </div>
        <div className={styles.heroActions}>
          <span className={styles.versionPill} data-profile-status={view.profileState}>
            {view.profileState === "confirmed" ? <ShieldCheck size={15} aria-hidden="true" /> : <PencilLine size={15} aria-hidden="true" />}
            {view.profileState === "confirmed" ? t("states.confirmed") : t("states.draftVersion", { version: row.version })}
          </span>
          {editable ? <button type="button" className={styles.secondaryButton} disabled={Boolean(activeRun)} onClick={(event) => { rememberTrigger(event.currentTarget); setEditorOpen(true); }}><PencilLine size={16} aria-hidden="true" />{t("actions.edit")}</button> : null}
          {editable ? <button type="button" className={styles.primaryButton} onClick={() => void synthesize()} disabled={synthesisMutation.isPending || Boolean(activeRun)}><Sparkles size={16} aria-hidden="true" />{activeRun ? t("actions.synthesizing") : t("actions.synthesize")}</button> : null}
        </div>
      </header>

      {feedback ? (
        <section className={styles.feedback} data-tone={feedback.tone} role={feedback.tone === "error" ? "alert" : "status"}>
          {feedback.tone === "success" ? <CheckCircle2 aria-hidden="true" /> : feedback.tone === "progress" ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
          <div><strong>{feedback.title}</strong><p>{feedback.detail}</p>{feedback.code ? <small>{feedback.code}{feedback.requestId ? ` · ${feedback.requestId}` : ""}</small> : null}</div>
          <button type="button" className={styles.iconButton} onClick={() => setFeedback(null)} aria-label={t("actions.close")}><X size={19} aria-hidden="true" /></button>
        </section>
      ) : null}

      {activeRun ? (
        <section className={styles.runPanel} aria-live="polite">
          <LoaderCircle className={styles.spin} aria-hidden="true" />
          <div><strong>{t("run.synthesisTitle")}</strong><p>{t(`run.statuses.${activeRun.status}`)} · {activeRun.progress.phase}</p></div>
          <span>{activeRun.progress.total === null ? activeRun.progress.current : `${activeRun.progress.current}/${activeRun.progress.total}`}</span>
        </section>
      ) : null}
      {crawlRun.data && !isTerminal(crawlRun.data.status) ? (
        <section className={styles.runPanel} aria-live="polite"><RefreshCw className={styles.spin} aria-hidden="true" /><div><strong>{t("run.crawlTitle")}</strong><p>{t(`run.statuses.${crawlRun.data.status as "queued" | "running"}`)} · {crawlRun.data.progress.phase}</p></div><span>{crawlRun.data.progress.total === null ? crawlRun.data.progress.current : `${crawlRun.data.progress.current}/${crawlRun.data.progress.total}`}</span></section>
      ) : null}
      {crawlRequired ? (
        <section className={styles.recoveryPanel}>
          <Database aria-hidden="true" />
          <div><strong>{t("recovery.title")}</strong><p>{t("recovery.detail")}</p></div>
          <button type="button" className={styles.primaryButton} onClick={() => void startCrawl()} disabled={crawlMutation.isPending || Boolean(crawlRunId)}>{t("actions.runCrawl")}</button>
        </section>
      ) : null}

      <div className={styles.deliveryGrid}>
        <div className={styles.storyColumn}>
          <section className={styles.editorialCard}>
            <SectionHeading eyebrow={t("sections.identity.eyebrow")} title={t("sections.identity.title")} fact={fact("/productName")} />
            <div className={styles.identityGrid}>
              <div><span>{t("fields.category")}</span><strong>{profile.category ?? <MissingValue />}</strong></div>
              <div><span>{t("fields.productType")}</span><strong>{profile.productType ?? <MissingValue />}</strong></div>
            </div>
            <div className={styles.statement}><span>{t("fields.valueProposition")}</span><p>{profile.valueProposition ?? <MissingValue />}</p></div>
          </section>

          <section className={styles.editorialCard}>
            <SectionHeading eyebrow={t("sections.business.eyebrow")} title={t("sections.business.title")} fact={fact("/coreFeatures")} />
            <div className={styles.splitContent}>
              <div><h3>{t("fields.businessModels")}</h3><ValueList values={profile.businessModels} /></div>
              <div><h3>{t("fields.coreFeatures")}</h3><ValueList values={profile.coreFeatures} /></div>
            </div>
          </section>

          <section className={styles.editorialCard}>
            <SectionHeading eyebrow={t("sections.market.eyebrow")} title={t("sections.market.title")} fact={fact("/targetMarkets")} />
            {profile.targetMarkets.length ? <div className={styles.marketList}>{profile.targetMarkets.map((market) => <article key={market.marketCode} data-priority={market.priority}><Globe2 aria-hidden="true" /><div><strong>{regionNames.of(market.marketCode) ?? market.marketCode}</strong><span>{market.marketCode} · {market.priority === "primary" ? t("markets.primary") : t("markets.secondary")}</span></div></article>)}</div> : <MissingValue />}
          </section>

          <section className={styles.editorialCard}>
            <SectionHeading eyebrow={t("sections.icp.eyebrow")} title={t("sections.icp.title")} fact={fact("/targetAudiences")} />
            {primaryAudience ? (
              <div className={styles.icpContent}>
                <div className={styles.icpLead}><Target aria-hidden="true" /><div><span>{t("fields.targetCompanyOrAudience")}</span><strong>{primaryAudience.targetCompanyOrAudience ?? <MissingValue />}</strong></div></div>
                <div className={styles.icpMatrix}>
                  {(["buyerRoles", "userRoles", "useCases", "triggers", "pains", "jtbd", "outcomes", "barriers", "qualificationSignals", "disqualifiers"] as const).map((key) => <div key={key}><h3>{t(`fields.${key}`)}</h3><ValueList values={primaryAudience[key]} /></div>)}
                </div>
              </div>
            ) : <MissingValue />}
          </section>

          <section className={styles.editorialCard}>
            <SectionHeading eyebrow={t("sections.competitors.eyebrow")} title={t("sections.competitors.title")} fact={fact("/competitorCandidates")} />
            <div className={styles.competitorHeader}><p>{t("competitors.description")}</p>{editable ? <button type="button" className={styles.secondaryButton} disabled={Boolean(activeRun)} onClick={(event) => { rememberTrigger(event.currentTarget); setCompetitorEditor("add"); }}><Plus size={16} aria-hidden="true" />{t("actions.addCompetitor")}</button> : null}</div>
            {profile.competitorCandidates.length ? <div className={styles.competitorList}>{profile.competitorCandidates.map((candidate) => (
              <article className={styles.competitorRow} key={candidate.candidateId} data-review={candidate.reviewStatus}>
                <div className={styles.competitorIdentity}><strong>{candidate.name}</strong><a href={`https://${candidate.domain}`} target="_blank" rel="noreferrer">{candidate.domain}<ExternalLink size={13} aria-hidden="true" /></a></div>
                <div className={styles.competitorMeta}><span>{t(`competitors.statuses.${candidate.reviewStatus}`)}</span><span>{candidate.relationship ? t(`competitors.relationships.${candidate.relationship}`) : t("states.unconfirmed")}</span>{candidate.analysisScope.map((scope) => <span key={scope}>{t(`competitors.scopes.${scope}`)}</span>)}</div>
                <p>{candidate.reason}</p>
                {editable ? <button type="button" className={styles.textButton} disabled={Boolean(activeRun)} onClick={(event) => { rememberTrigger(event.currentTarget); setCompetitorEditor(candidate); }}>{t("actions.reviewCompetitor")}<ArrowRight size={15} aria-hidden="true" /></button> : null}
              </article>
            ))}</div> : <MissingValue />}
          </section>

          <section className={styles.evidenceCard}>
            <SectionHeading eyebrow={t("sections.evidence.eyebrow")} title={t("sections.evidence.title")} />
            <div className={styles.evidenceGrid}>
              <div><span>{t("evidence.source")}</span><strong>{profile.sourcePageUrl}</strong></div>
              <div><span>{t("evidence.snapshot")}</span><strong>{view.evidence.sourceSnapshotId ?? t("evidence.notFrozen")}</strong></div>
              <div><span>{t("evidence.invocation")}</span><strong>{view.evidence.analysisInvocationId ?? t("evidence.notGenerated")}</strong></div>
              <div><span>{t("evidence.generatedAt")}</span><strong>{formatDate(view.evidence.generatedAt, locale) ?? t("states.unconfirmed")}</strong></div>
            </div>
            <div className={styles.evidenceCounts}><span>{t("evidence.provenance", { count: view.evidence.provenanceCount })}</span><span data-warning={view.evidence.missingCount > 0}>{t("evidence.missing", { count: view.evidence.missingCount })}</span><span data-warning={view.evidence.conflictCount > 0}>{t("evidence.conflicts", { count: view.evidence.conflictCount })}</span></div>
            {(profile.missingFields.length || profile.conflictingFields.length) ? <details className={styles.evidenceDetails}><summary>{t("evidence.reviewDetails")}</summary>{profile.missingFields.length ? <div><strong>{t("evidence.missingTitle")}</strong><ValueList values={profile.missingFields} /></div> : null}{profile.conflictingFields.length ? <div><strong>{t("evidence.conflictTitle")}</strong><ValueList values={profile.conflictingFields} /></div> : null}</details> : null}
          </section>
        </div>

        <aside className={styles.reviewRail} aria-label={t("confirmation.railLabel")}>
          <div className={styles.reviewCard}>
            <p className={styles.eyebrow}>{t("confirmation.eyebrow")}</p>
            <h2>{t("confirmation.title")}</h2>
            <p>{view.profileState === "confirmed" ? t("confirmation.confirmedDetail") : t("confirmation.detail")}</p>
            <ul className={styles.checklist}>{view.confirmation.items.map((item) => <li key={item.id} data-complete={item.complete}>{item.complete ? <Check size={15} aria-hidden="true" /> : <span aria-hidden="true">—</span>}<span>{t(`confirmation.items.${item.id}`)}</span></li>)}</ul>
            {editable ? <button type="button" className={styles.confirmButton} disabled={!view.confirmation.ready} onClick={(event) => { rememberTrigger(event.currentTarget); setConfirmOpen(true); }}><ShieldCheck size={17} aria-hidden="true" />{view.confirmation.ready ? t("actions.confirm") : t("actions.confirmBlocked")}</button> : <div className={styles.confirmedStamp}><ShieldCheck aria-hidden="true" /><strong>{t("states.confirmed")}</strong></div>}
            {!view.confirmation.ready && editable ? <p className={styles.blockReason}>{activeRun ? t("confirmation.activeRunBlocked") : t("confirmation.blocked")}</p> : null}
          </div>
        </aside>
      </div>

      <ProfileEditor profile={profile} open={editorOpen} saving={updateMutation.isPending} onClose={closeEditor} onSave={saveProfile} />
      <CompetitorEditor open={competitorEditor !== null} candidate={competitorEditor === "add" ? null : competitorEditor} saving={addMutation.isPending || reviewMutation.isPending} onClose={closeCompetitorEditor} onSubmit={saveCompetitor} />
      <ModalFrame open={confirmOpen} titleId="confirm-profile-title" onRequestClose={closeConfirmation}>
        <div className={styles.confirmDialog}><ShieldCheck size={26} aria-hidden="true" /><h2 id="confirm-profile-title">{t("confirmation.dialogTitle")}</h2><p>{t("confirmation.dialogDetail")}</p><div className={styles.dialogActions}><button type="button" className={styles.secondaryButton} onClick={closeConfirmation}>{t("actions.cancel")}</button><button type="button" className={styles.primaryButton} disabled={confirmMutation.isPending} onClick={() => void confirmProfile()}>{confirmMutation.isPending ? <LoaderCircle className={styles.spin} size={17} aria-hidden="true" /> : <ShieldCheck size={17} aria-hidden="true" />}{t("actions.confirm")}</button></div></div>
      </ModalFrame>
    </div>
  );
}
