"use client";

/**
 * Context (ICP profile) editor — spec §4.2. A two-column workbench: the editable
 * form on the left, a sticky dark "Profile Lens" summary on the right. Draft
 * saves persist the filled subset; Mark complete assembles the full
 * CompleteIcpProfileInput and surfaces pointer-level 422 errors inline (AC-008).
 * Optimistic concurrency rides on `baseVersion`; a 409 shows the conflict notice
 * and reloads the latest version.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  DarkPanel,
  Field,
  Panel,
  Spinner,
  StatusPill,
  TextArea,
  TextInput,
  cx,
  useFieldControl,
} from "@/components/ui";
import type { StatusTone } from "@/components/ui";
import { ApiError, useProjectContext, useUpdateContext } from "@/lib/api";
import type {
  BusinessProfile,
  CompleteIcpProfileInput,
  ConversionType,
  CustomerModel,
  DraftIcpProfilePatch,
  Persona,
  UpdateContextRequest,
} from "@sf/contracts";
import type { IcpProfile } from "@/lib/api/types";
import { ProblemNotice, ProblemState } from "../_problem-display";
import { setUnsavedContextChanges } from "../_context-navigation-guard";
import { mapContextFieldErrors } from "./_context-form-errors";
import styles from "./_context-form.module.css";

// --------------------------------------------------------------- Form model --

interface PersonaDraft {
  readonly name: string;
  readonly roleOrContext: string;
  readonly jobs: string; // one item per line
  readonly painPoints: string; // one item per line
}

interface FormState {
  readonly productName: string;
  readonly oneLineDescription: string;
  readonly customerModel: string;
  readonly businessProfile: string;
  readonly businessProfileNote: string;
  readonly marketCodes: string;
  readonly siteLanguageCodes: string;
  readonly defaultDeliveryLocale: string;
  readonly segments: string;
  readonly personas: readonly PersonaDraft[];
  readonly useCases: string;
  readonly offers: string;
  readonly differentiators: string;
  readonly conversionLabel: string;
  readonly conversionType: string;
  readonly conversionTargetUrl: string;
  readonly priorityProductsOrServices: string;
  readonly priorityUrls: string;
  readonly competitors: string;
  readonly brandConstraints: string;
  readonly complianceConstraints: string;
  readonly technicalConstraints: string;
  readonly resourceConstraints: string;
  readonly growthQuestions: string;
  readonly ninetyDayGoals: string;
}

function emptyPersona(): PersonaDraft {
  return { name: "", roleOrContext: "", jobs: "", painPoints: "" };
}

const EMPTY_FORM: FormState = {
  productName: "",
  oneLineDescription: "",
  customerModel: "",
  businessProfile: "",
  businessProfileNote: "",
  marketCodes: "",
  siteLanguageCodes: "",
  defaultDeliveryLocale: "",
  segments: "",
  personas: [emptyPersona()],
  useCases: "",
  offers: "",
  differentiators: "",
  conversionLabel: "",
  conversionType: "",
  conversionTargetUrl: "",
  priorityProductsOrServices: "",
  priorityUrls: "",
  competitors: "",
  brandConstraints: "",
  complianceConstraints: "",
  technicalConstraints: "",
  resourceConstraints: "",
  growthQuestions: "",
  ninetyDayGoals: "",
};

interface SelectOption {
  readonly value: string;
  readonly label: string;
}

// ------------------------------------------------------------- Profile I/O --

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readLines(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.filter((item): item is string => typeof item === "string").join("\n");
}

function readPersona(value: unknown): PersonaDraft {
  if (typeof value !== "object" || value === null) return emptyPersona();
  const record = value as Record<string, unknown>;
  return {
    name: readString(record.name),
    roleOrContext: readString(record.roleOrContext),
    jobs: readLines(record.jobs),
    painPoints: readLines(record.painPoints),
  };
}

function fromProfile(profile: Record<string, unknown>): FormState {
  const conversion =
    typeof profile.primaryConversion === "object" && profile.primaryConversion !== null
      ? (profile.primaryConversion as Record<string, unknown>)
      : {};
  const rawPersonas = Array.isArray(profile.personas) ? profile.personas : [];
  const personas = rawPersonas.length > 0 ? rawPersonas.map(readPersona) : [emptyPersona()];
  return {
    productName: readString(profile.productName),
    oneLineDescription: readString(profile.oneLineDescription),
    customerModel: readString(profile.customerModel),
    businessProfile: readString(profile.businessProfile),
    businessProfileNote: readString(profile.businessProfileNote),
    marketCodes: readLines(profile.marketCodes),
    siteLanguageCodes: readLines(profile.siteLanguageCodes),
    defaultDeliveryLocale: readString(profile.defaultDeliveryLocale),
    segments: readLines(profile.segments),
    personas,
    useCases: readLines(profile.useCases),
    offers: readLines(profile.offers),
    differentiators: readLines(profile.differentiators),
    conversionLabel: readString(conversion.label),
    conversionType: readString(conversion.type),
    conversionTargetUrl: readString(conversion.targetUrl),
    priorityProductsOrServices: readLines(profile.priorityProductsOrServices),
    priorityUrls: readLines(profile.priorityUrls),
    competitors: readLines(profile.competitors),
    brandConstraints: readLines(profile.brandConstraints),
    complianceConstraints: readLines(profile.complianceConstraints),
    technicalConstraints: readLines(profile.technicalConstraints),
    resourceConstraints: readLines(profile.resourceConstraints),
    growthQuestions: readLines(profile.growthQuestions),
    ninetyDayGoals: readLines(profile.ninetyDayGoals),
  };
}

function parseLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Personas that are fully specified (safe to persist against the strict schema). */
function validPersonas(rows: readonly PersonaDraft[]): Persona[] {
  const out: Persona[] = [];
  for (const row of rows) {
    const name = row.name.trim();
    const roleOrContext = row.roleOrContext.trim();
    const jobs = parseLines(row.jobs);
    const painPoints = parseLines(row.painPoints);
    if (name && roleOrContext && jobs.length > 0 && painPoints.length > 0) {
      out.push({ name, roleOrContext, jobs, painPoints });
    }
  }
  return out;
}

/** All persona rows, indices preserved so pointer errors line up with the UI. */
function completePersonas(rows: readonly PersonaDraft[]): Persona[] {
  return rows.map((row) => ({
    name: row.name.trim(),
    roleOrContext: row.roleOrContext.trim(),
    jobs: parseLines(row.jobs),
    painPoints: parseLines(row.painPoints),
  }));
}

/** Draft patch of the currently-filled fields (never sends empty values). */
function buildDraftPatch(form: FormState): DraftIcpProfilePatch {
  const patch: DraftIcpProfilePatch = {};
  const scalar = (raw: string): string | undefined => {
    const value = raw.trim();
    return value.length > 0 ? value : undefined;
  };
  const list = (raw: string): string[] | undefined => {
    const items = parseLines(raw);
    return items.length > 0 ? items : undefined;
  };

  const productName = scalar(form.productName);
  if (productName !== undefined) patch.productName = productName;
  const oneLineDescription = scalar(form.oneLineDescription);
  if (oneLineDescription !== undefined) patch.oneLineDescription = oneLineDescription;
  if (form.customerModel) patch.customerModel = form.customerModel as CustomerModel;
  if (form.businessProfile) patch.businessProfile = form.businessProfile as BusinessProfile;
  const businessProfileNote = scalar(form.businessProfileNote);
  if (businessProfileNote !== undefined) patch.businessProfileNote = businessProfileNote;
  const marketCodes = list(form.marketCodes);
  if (marketCodes !== undefined) patch.marketCodes = marketCodes;
  const siteLanguageCodes = list(form.siteLanguageCodes);
  if (siteLanguageCodes !== undefined) patch.siteLanguageCodes = siteLanguageCodes;
  const defaultDeliveryLocale = scalar(form.defaultDeliveryLocale);
  if (defaultDeliveryLocale !== undefined) patch.defaultDeliveryLocale = defaultDeliveryLocale;
  const segments = list(form.segments);
  if (segments !== undefined) patch.segments = segments;
  const personas = validPersonas(form.personas);
  if (personas.length > 0) patch.personas = personas;
  const useCases = list(form.useCases);
  if (useCases !== undefined) patch.useCases = useCases;
  const offers = list(form.offers);
  if (offers !== undefined) patch.offers = offers;
  const differentiators = list(form.differentiators);
  if (differentiators !== undefined) patch.differentiators = differentiators;
  if (form.conversionLabel.trim() && form.conversionType) {
    patch.primaryConversion = {
      label: form.conversionLabel.trim(),
      type: form.conversionType as ConversionType,
      targetUrl: form.conversionTargetUrl.trim() || null,
    };
  }
  const priorityProductsOrServices = list(form.priorityProductsOrServices);
  if (priorityProductsOrServices !== undefined)
    patch.priorityProductsOrServices = priorityProductsOrServices;
  const priorityUrls = list(form.priorityUrls);
  if (priorityUrls !== undefined) patch.priorityUrls = priorityUrls;
  const competitors = list(form.competitors);
  if (competitors !== undefined) patch.competitors = competitors;
  const brandConstraints = list(form.brandConstraints);
  if (brandConstraints !== undefined) patch.brandConstraints = brandConstraints;
  const complianceConstraints = list(form.complianceConstraints);
  if (complianceConstraints !== undefined) patch.complianceConstraints = complianceConstraints;
  const technicalConstraints = list(form.technicalConstraints);
  if (technicalConstraints !== undefined) patch.technicalConstraints = technicalConstraints;
  const resourceConstraints = list(form.resourceConstraints);
  if (resourceConstraints !== undefined) patch.resourceConstraints = resourceConstraints;
  const growthQuestions = list(form.growthQuestions);
  if (growthQuestions !== undefined) patch.growthQuestions = growthQuestions;
  const ninetyDayGoals = list(form.ninetyDayGoals);
  if (ninetyDayGoals !== undefined) patch.ninetyDayGoals = ninetyDayGoals;
  return patch;
}

/** The full complete-mode input. Enum casts fall through to server validation. */
function buildCompleteInput(form: FormState): CompleteIcpProfileInput {
  const note = form.businessProfileNote.trim();
  return {
    productName: form.productName.trim(),
    oneLineDescription: form.oneLineDescription.trim(),
    customerModel: form.customerModel as CustomerModel,
    businessProfile: form.businessProfile as BusinessProfile,
    businessProfileNote: note.length > 0 ? note : null,
    marketCodes: parseLines(form.marketCodes),
    siteLanguageCodes: parseLines(form.siteLanguageCodes),
    defaultDeliveryLocale: form.defaultDeliveryLocale.trim(),
    segments: parseLines(form.segments),
    personas: completePersonas(form.personas),
    useCases: parseLines(form.useCases),
    offers: parseLines(form.offers),
    differentiators: parseLines(form.differentiators),
    primaryConversion: {
      label: form.conversionLabel.trim(),
      type: form.conversionType as ConversionType,
      targetUrl: form.conversionTargetUrl.trim() || null,
    },
    priorityProductsOrServices: parseLines(form.priorityProductsOrServices),
    priorityUrls: parseLines(form.priorityUrls),
    competitors: parseLines(form.competitors),
    brandConstraints: parseLines(form.brandConstraints),
    complianceConstraints: parseLines(form.complianceConstraints),
    technicalConstraints: parseLines(form.technicalConstraints),
    resourceConstraints: parseLines(form.resourceConstraints),
    growthQuestions: parseLines(form.growthQuestions),
    ninetyDayGoals: parseLines(form.ninetyDayGoals),
  };
}

interface SectionFlags {
  readonly businessFrame: boolean;
  readonly idealCustomer: boolean;
  readonly commercialFocus: boolean;
  readonly successDefinition: boolean;
}

function sectionFlags(form: FormState): SectionFlags {
  const has = (raw: string): boolean => parseLines(raw).length > 0;
  const noteOk = form.businessProfile !== "other" || form.businessProfileNote.trim().length >= 3;
  return {
    businessFrame:
      form.productName.trim().length > 0 &&
      form.oneLineDescription.trim().length > 0 &&
      form.customerModel.length > 0 &&
      form.businessProfile.length > 0 &&
      noteOk &&
      has(form.marketCodes) &&
      has(form.siteLanguageCodes) &&
      form.defaultDeliveryLocale.trim().length > 0,
    idealCustomer:
      has(form.segments) && validPersonas(form.personas).length > 0 && has(form.useCases),
    commercialFocus:
      has(form.offers) &&
      has(form.differentiators) &&
      form.conversionLabel.trim().length > 0 &&
      form.conversionType.length > 0 &&
      has(form.priorityProductsOrServices),
    successDefinition: has(form.growthQuestions) && has(form.ninetyDayGoals),
  };
}

function serialize(form: FormState): string {
  return JSON.stringify(form);
}

function profileIdentity(profile: IcpProfile | null): string {
  return profile ? `${profile.id}@${profile.version}` : "missing";
}

// --------------------------------------------------------------- Controls ---

interface TextFieldProps {
  readonly label: ReactNode;
  readonly help?: ReactNode;
  readonly error?: ReactNode;
  readonly required?: boolean;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: string;
  readonly placeholder?: string;
}

function TextField({
  label,
  help,
  error,
  required,
  value,
  onChange,
  type,
  placeholder,
}: TextFieldProps) {
  return (
    <Field label={label} help={help} error={error} required={Boolean(required)}>
      <TextInput
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...(type !== undefined ? { type } : {})}
        {...(placeholder !== undefined ? { placeholder } : {})}
      />
    </Field>
  );
}

interface AreaFieldProps {
  readonly label: ReactNode;
  readonly help?: ReactNode;
  readonly error?: ReactNode;
  readonly required?: boolean;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly rows?: number;
}

function AreaField({ label, help, error, required, value, onChange, rows }: AreaFieldProps) {
  return (
    <Field label={label} help={help} error={error} required={Boolean(required)}>
      <TextArea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...(rows !== undefined ? { rows } : {})}
      />
    </Field>
  );
}

interface NativeSelectProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly SelectOption[];
  readonly placeholder: string;
}

function NativeSelect({ value, onChange, options, placeholder }: NativeSelectProps) {
  const field = useFieldControl();
  return (
    <select
      className={cx(styles.select, field?.invalid && styles.selectInvalid)}
      id={field?.controlId}
      aria-describedby={field?.describedBy}
      aria-invalid={field?.invalid || undefined}
      required={field?.required ?? false}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="" disabled>
        {placeholder}
      </option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

interface SectionProps {
  readonly index: number;
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly children: ReactNode;
}

function Section({ index, title, description, children }: SectionProps) {
  return (
    <Panel padding="lg" className={styles.section}>
      <header className={styles.sectionHead}>
        <span className={styles.sectionNumber} aria-hidden="true">
          {index}
        </span>
        <div>
          <h2 className={styles.sectionTitle}>{title}</h2>
          <p className={styles.sectionDesc}>{description}</p>
        </div>
      </header>
      <div className={styles.sectionBody}>{children}</div>
    </Panel>
  );
}

// ------------------------------------------------------------------ Screen --

type SaveMode = "draft" | "complete";

const STATUS_TONE: Record<"missing" | "draft" | "complete", StatusTone> = {
  missing: "neutral",
  draft: "warning",
  complete: "success",
};

export interface ContextFormProps {
  readonly projectId: string;
  /** Canonical server read; `undefined` is reserved for the mock browser harness. */
  readonly initialProfile?: IcpProfile | null;
}

export function ContextForm({ projectId, initialProfile }: ContextFormProps) {
  const t = useTranslations("context");
  const tCommon = useTranslations("common");
  const tStatus = useTranslations("contextStatus");

  const query = useProjectContext(projectId, initialProfile);
  const queryClient = useQueryClient();
  const update = useUpdateContext(projectId);
  const queriedProfile = query.data ?? null;
  const initialHandoffToken =
    initialProfile === undefined
      ? null
      : `${projectId}:${profileIdentity(initialProfile)}`;
  const queryMatchesInitial =
    initialProfile !== undefined &&
    profileIdentity(queriedProfile) === profileIdentity(initialProfile);
  const [handedOffInitialToken, setHandedOffInitialToken] = useState<string | null>(
    () => (queryMatchesInitial ? initialHandoffToken : null),
  );
  const initialHandoffComplete =
    initialHandoffToken === null ||
    handedOffInitialToken === initialHandoffToken ||
    queryMatchesInitial;
  const currentProfile = initialHandoffComplete
    ? queriedProfile
    : (initialProfile ?? null);

  const [form, setForm] = useState<FormState>(() =>
    initialProfile ? fromProfile(initialProfile.profile) : EMPTY_FORM,
  );
  const [baseline, setBaseline] = useState<string>(() =>
    serialize(initialProfile ? fromProfile(initialProfile.profile) : EMPTY_FORM),
  );
  const [justSaved, setJustSaved] = useState<boolean>(false);
  const [savingMode, setSavingMode] = useState<SaveMode | null>(null);
  const [topAlert, setTopAlert] = useState<string | null>(null);
  const [topProblem, setTopProblem] = useState<unknown | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const syncedKey = useRef<string | null>(
    initialProfile ? `${initialProfile.id}@${initialProfile.version}` : null,
  );

  // `initialData` initializes an empty Query cache but deliberately does not
  // replace an older cache entry. Seed the canonical server read after mount in
  // that revisit case, while rendering it immediately so stale cached content
  // can never flash or become the form's concurrency baseline.
  useEffect(() => {
    if (
      initialHandoffToken === null ||
      handedOffInitialToken === initialHandoffToken
    ) {
      return;
    }
    if (!queryMatchesInitial) {
      queryClient.setQueryData(["context", projectId], initialProfile);
    }
    setHandedOffInitialToken(initialHandoffToken);
  }, [
    handedOffInitialToken,
    initialHandoffToken,
    initialProfile,
    projectId,
    queryClient,
    queryMatchesInitial,
  ]);

  // Prefill (and reload-on-conflict) from the server, once per version. Our own
  // saves pre-mark `syncedKey`, so the post-save refetch never clobbers edits.
  useEffect(() => {
    if (!currentProfile) return;
    const key = `${currentProfile.id}@${currentProfile.version}`;
    if (syncedKey.current === key) return;
    syncedKey.current = key;
    const next = fromProfile(currentProfile.profile);
    setForm(next);
    setBaseline(serialize(next));
  }, [currentProfile]);

  const isDirty = serialize(form) !== baseline;
  const baseVersion = currentProfile?.version ?? 0;

  useEffect(() => {
    setUnsavedContextChanges(isDirty);
    if (!isDirty) return () => setUnsavedContextChanges(false);

    const warnBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      setUnsavedContextChanges(false);
    };
  }, [isDirty]);

  function clearFeedback(): void {
    setJustSaved(false);
    setTopAlert(null);
    setTopProblem(null);
    setFieldErrors({});
  }

  function patchForm(patch: Partial<FormState>): void {
    setForm((prev) => ({ ...prev, ...patch }));
    clearFeedback();
  }

  function updatePersona(index: number, patch: Partial<PersonaDraft>): void {
    setForm((prev) => ({
      ...prev,
      personas: prev.personas.map((persona, idx) =>
        idx === index ? { ...persona, ...patch } : persona,
      ),
    }));
    clearFeedback();
  }

  function addPersona(): void {
    setForm((prev) => ({ ...prev, personas: [...prev.personas, emptyPersona()] }));
    clearFeedback();
  }

  function removePersona(index: number): void {
    setForm((prev) => ({
      ...prev,
      personas:
        prev.personas.length > 1
          ? prev.personas.filter((_, idx) => idx !== index)
          : prev.personas,
    }));
    clearFeedback();
  }

  function handleError(error: unknown): void {
    if (error instanceof ApiError) {
      if (error.code === "VERSION_CONFLICT") {
        setTopAlert(t("conflictError"));
        setTopProblem(error);
        void query.refetch();
        return;
      }
      const errors = error.fieldErrors();
      if (errors.length > 0) {
        setFieldErrors(mapContextFieldErrors(errors, t("qualificationIncomplete")));
        setTopAlert(t("qualificationIncomplete"));
        setTopProblem(error);
        return;
      }
      setTopAlert(tCommon("error"));
      setTopProblem(error);
      return;
    }
    setTopAlert(tCommon("error"));
    setTopProblem(null);
  }

  async function runSave(mode: SaveMode, body: UpdateContextRequest): Promise<void> {
    setSavingMode(mode);
    setTopAlert(null);
    setTopProblem(null);
    setFieldErrors({});
    const snapshot = serialize(form);
    try {
      const saved = await update.mutateAsync(body);
      syncedKey.current = `${saved.id}@${saved.version}`;
      setBaseline(snapshot);
      setJustSaved(true);
    } catch (error) {
      handleError(error);
    } finally {
      setSavingMode(null);
    }
  }

  function onSaveDraft(): void {
    const profile = buildDraftPatch(form);
    if (Object.keys(profile).length === 0) return;
    void runSave("draft", { mode: "draft", baseVersion, profile });
  }

  function onMarkComplete(): void {
    const profile = buildCompleteInput(form);
    void runSave("complete", { mode: "complete", baseVersion, profile });
  }

  const errAt = (pointer: string): string | undefined => {
    const exact = fieldErrors[pointer];
    if (exact !== undefined) return exact;
    const prefix = `${pointer}/`;
    for (const key of Object.keys(fieldErrors)) {
      if (key.startsWith(prefix)) return fieldErrors[key];
    }
    return undefined;
  };

  if (query.isLoading) {
    return (
      <div className={styles.centered}>
        <Spinner size="lg" label={tCommon("loading")} />
        <span>{tCommon("loading")}</span>
      </div>
    );
  }

  if (query.isError && !currentProfile) {
    return <ProblemState error={query.error} onRetry={() => void query.refetch()} />;
  }

  const versionLabel = currentProfile
    ? t("version", { version: currentProfile.version })
    : t("newVersion");
  const statusKey = currentProfile?.status ?? "missing";
  const flags = sectionFlags(form);
  const marketBadges = parseLines(form.marketCodes);
  const languageBadges = parseLines(form.siteLanguageCodes);

  const busy = savingMode !== null;
  const saveStatus: { text: string; className: string | undefined } = busy
    ? { text: t("saving"), className: undefined }
    : isDirty
      ? { text: t("unsavedChanges"), className: styles.saveStatusDirty }
      : justSaved
        ? { text: t("savedJustNow"), className: styles.saveStatusSaved }
        : { text: t("saved"), className: undefined };

  const checklist: readonly { readonly done: boolean; readonly label: string }[] = [
    { done: flags.businessFrame, label: t("sections.businessFrame.title") },
    { done: flags.idealCustomer, label: t("sections.idealCustomer.title") },
    { done: flags.commercialFocus, label: t("sections.commercialFocus.title") },
    { done: flags.successDefinition, label: t("sections.successDefinition.title") },
  ];
  const customerModels: readonly SelectOption[] = [
    { value: "b2b", label: t("options.customerModel.b2b") },
    { value: "b2c", label: t("options.customerModel.b2c") },
    { value: "hybrid", label: t("options.customerModel.hybrid") },
  ];
  const businessProfiles: readonly SelectOption[] = [
    { value: "b2b_saas", label: t("options.businessProfile.b2b_saas") },
    { value: "b2b_services", label: t("options.businessProfile.b2b_services") },
    { value: "b2c_ecommerce", label: t("options.businessProfile.b2c_ecommerce") },
    {
      value: "b2c_subscription",
      label: t("options.businessProfile.b2c_subscription"),
    },
    { value: "marketplace", label: t("options.businessProfile.marketplace") },
    { value: "publisher", label: t("options.businessProfile.publisher") },
    { value: "other", label: t("options.businessProfile.other") },
  ];
  const conversionTypes: readonly SelectOption[] = [
    { value: "demo", label: t("options.conversionType.demo") },
    { value: "signup", label: t("options.conversionType.signup") },
    { value: "trial", label: t("options.conversionType.trial") },
    { value: "purchase", label: t("options.conversionType.purchase") },
    { value: "lead", label: t("options.conversionType.lead") },
    { value: "contact", label: t("options.conversionType.contact") },
    { value: "subscribe", label: t("options.conversionType.subscribe") },
    { value: "offline", label: t("options.conversionType.offline") },
    { value: "other", label: t("options.conversionType.other") },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div className={styles.heroText}>
          <span className="sf-eyebrow">{versionLabel}</span>
          <h1 className={styles.title}>{t("title")}</h1>
          <p className={styles.subtitle}>{t("subtitle")}</p>
        </div>
        <div className={styles.saveBlock}>
          <div className={cx(styles.saveStatus, saveStatus.className)} aria-live="polite">
            {busy ? <Spinner size="sm" label={t("saving")} /> : null}
            <span>{saveStatus.text}</span>
          </div>
          <div className={styles.saveButtons}>
            <Button variant="secondary" onClick={onSaveDraft} disabled={busy || !isDirty}>
              {t("saveDraft")}
            </Button>
            <Button variant="primary" onClick={onMarkComplete} disabled={busy}>
              {t("markComplete")}
            </Button>
          </div>
        </div>
      </div>

      {topAlert !== null ? (
        topProblem !== null ? (
          <ProblemNotice
            className={styles.alert}
            error={topProblem}
            message={topAlert}
            compact
          />
        ) : (
          <p className={styles.alert} role="alert">
            {topAlert}
          </p>
        )
      ) : null}

      <div className={styles.grid}>
        <div className={styles.formCol}>
          <Section
            index={1}
            title={t("sections.businessFrame.title")}
            description={t("sections.businessFrame.description")}
          >
            <TextField
              label={t("fields.productName")}
              required
              value={form.productName}
              onChange={(value) => patchForm({ productName: value })}
              error={errAt("/productName")}
            />
            <AreaField
              label={t("fields.oneLineDescription")}
              required
              rows={3}
              value={form.oneLineDescription}
              onChange={(value) => patchForm({ oneLineDescription: value })}
              error={errAt("/oneLineDescription")}
            />
            <div className={styles.row2}>
              <Field
                label={t("fields.customerModel")}
                required
                error={errAt("/customerModel")}
              >
                <NativeSelect
                  value={form.customerModel}
                  onChange={(value) => patchForm({ customerModel: value })}
                  options={customerModels}
                  placeholder={tCommon("none")}
                />
              </Field>
              <Field
                label={t("fields.businessProfile")}
                required
                error={errAt("/businessProfile")}
              >
                <NativeSelect
                  value={form.businessProfile}
                  onChange={(value) => patchForm({ businessProfile: value })}
                  options={businessProfiles}
                  placeholder={tCommon("none")}
                />
              </Field>
            </div>
            {form.businessProfile === "other" ? (
              <AreaField
                label={t("fields.businessProfileNote")}
                required
                rows={3}
                value={form.businessProfileNote}
                onChange={(value) => patchForm({ businessProfileNote: value })}
                error={errAt("/businessProfileNote")}
              />
            ) : null}
            <div className={styles.row2}>
              <AreaField
                label={t("fields.marketCodes")}
                help={t("help.markets")}
                required
                value={form.marketCodes}
                onChange={(value) => patchForm({ marketCodes: value })}
                error={errAt("/marketCodes")}
              />
              <AreaField
                label={t("fields.siteLanguageCodes")}
                help={t("help.languages")}
                required
                value={form.siteLanguageCodes}
                onChange={(value) => patchForm({ siteLanguageCodes: value })}
                error={errAt("/siteLanguageCodes")}
              />
            </div>
            <TextField
              label={t("fields.defaultDeliveryLocale")}
              help={t("help.locale")}
              required
              value={form.defaultDeliveryLocale}
              onChange={(value) => patchForm({ defaultDeliveryLocale: value })}
              error={errAt("/defaultDeliveryLocale")}
            />
          </Section>

          <Section
            index={2}
            title={t("sections.idealCustomer.title")}
            description={t("sections.idealCustomer.description")}
          >
            <AreaField
              label={t("fields.segments")}
              help={t("help.perLine")}
              required
              value={form.segments}
              onChange={(value) => patchForm({ segments: value })}
              error={errAt("/segments")}
            />
            <Field label={t("fields.personas")} required error={errAt("/personas")}>
              <div className={styles.personaList}>
                {form.personas.map((persona, index) => (
                  <Card key={index} padding="md" className={styles.personaCard}>
                    <div className={styles.personaHead}>
                      <span className={styles.personaTitle}>{`#${index + 1}`}</span>
                      {form.personas.length > 1 ? (
                        <Button
                          variant="text"
                          size="sm"
                          onClick={() => removePersona(index)}
                          aria-label={`${tCommon("close")} #${index + 1}`}
                        >
                          {tCommon("close")}
                        </Button>
                      ) : null}
                    </div>
                    <div className={styles.personaBody}>
                      <TextField
                        label={t("fields.personaName")}
                        required
                        value={persona.name}
                        onChange={(value) => updatePersona(index, { name: value })}
                        error={errAt(`/personas/${index}/name`)}
                      />
                      <TextField
                        label={t("fields.personaRole")}
                        required
                        value={persona.roleOrContext}
                        onChange={(value) => updatePersona(index, { roleOrContext: value })}
                        error={errAt(`/personas/${index}/roleOrContext`)}
                      />
                      <AreaField
                        label={t("fields.personaJobs")}
                        help={t("help.perLine")}
                        required
                        value={persona.jobs}
                        onChange={(value) => updatePersona(index, { jobs: value })}
                        error={errAt(`/personas/${index}/jobs`)}
                      />
                      <AreaField
                        label={t("fields.personaPains")}
                        help={t("help.perLine")}
                        required
                        value={persona.painPoints}
                        onChange={(value) => updatePersona(index, { painPoints: value })}
                        error={errAt(`/personas/${index}/painPoints`)}
                      />
                    </div>
                  </Card>
                ))}
                <Button
                  variant="secondary"
                  size="sm"
                  className={styles.addPersona}
                  onClick={addPersona}
                >
                  {`+ ${t("fields.personas")}`}
                </Button>
              </div>
            </Field>
            <AreaField
              label={t("fields.useCases")}
              help={t("help.perLine")}
              required
              value={form.useCases}
              onChange={(value) => patchForm({ useCases: value })}
              error={errAt("/useCases")}
            />
          </Section>

          <Section
            index={3}
            title={t("sections.commercialFocus.title")}
            description={t("sections.commercialFocus.description")}
          >
            <div className={styles.row2}>
              <AreaField
                label={t("fields.offers")}
                help={t("help.perLine")}
                required
                value={form.offers}
                onChange={(value) => patchForm({ offers: value })}
                error={errAt("/offers")}
              />
              <AreaField
                label={t("fields.differentiators")}
                help={t("help.perLine")}
                required
                value={form.differentiators}
                onChange={(value) => patchForm({ differentiators: value })}
                error={errAt("/differentiators")}
              />
            </div>
            <Field
              label={t("fields.primaryConversion")}
              required
              error={errAt("/primaryConversion")}
            >
              <div className={styles.row2}>
                <TextField
                  label={t("fields.conversionLabel")}
                  required
                  value={form.conversionLabel}
                  onChange={(value) => patchForm({ conversionLabel: value })}
                  error={errAt("/primaryConversion/label")}
                />
                <Field
                  label={t("fields.conversionType")}
                  required
                  error={errAt("/primaryConversion/type")}
                >
                  <NativeSelect
                    value={form.conversionType}
                    onChange={(value) => patchForm({ conversionType: value })}
                    options={conversionTypes}
                    placeholder={tCommon("none")}
                  />
                </Field>
              </div>
            </Field>
            <TextField
              label={t("fields.conversionTargetUrl")}
              type="url"
              value={form.conversionTargetUrl}
              onChange={(value) => patchForm({ conversionTargetUrl: value })}
              error={errAt("/primaryConversion/targetUrl")}
            />
            <AreaField
              label={t("fields.priorityProductsOrServices")}
              help={t("help.perLine")}
              required
              value={form.priorityProductsOrServices}
              onChange={(value) => patchForm({ priorityProductsOrServices: value })}
              error={errAt("/priorityProductsOrServices")}
            />
            <div className={styles.row2}>
              <AreaField
                label={t("fields.priorityUrls")}
                help={t("help.urls")}
                value={form.priorityUrls}
                onChange={(value) => patchForm({ priorityUrls: value })}
                error={errAt("/priorityUrls")}
              />
              <AreaField
                label={t("fields.competitors")}
                help={t("help.perLine")}
                value={form.competitors}
                onChange={(value) => patchForm({ competitors: value })}
                error={errAt("/competitors")}
              />
            </div>
            <div className={styles.row2}>
              <AreaField
                label={t("fields.brandConstraints")}
                help={t("help.perLine")}
                value={form.brandConstraints}
                onChange={(value) => patchForm({ brandConstraints: value })}
                error={errAt("/brandConstraints")}
              />
              <AreaField
                label={t("fields.complianceConstraints")}
                help={t("help.perLine")}
                value={form.complianceConstraints}
                onChange={(value) => patchForm({ complianceConstraints: value })}
                error={errAt("/complianceConstraints")}
              />
            </div>
            <div className={styles.row2}>
              <AreaField
                label={t("fields.technicalConstraints")}
                help={t("help.perLine")}
                value={form.technicalConstraints}
                onChange={(value) => patchForm({ technicalConstraints: value })}
                error={errAt("/technicalConstraints")}
              />
              <AreaField
                label={t("fields.resourceConstraints")}
                help={t("help.perLine")}
                value={form.resourceConstraints}
                onChange={(value) => patchForm({ resourceConstraints: value })}
                error={errAt("/resourceConstraints")}
              />
            </div>
          </Section>

          <Section
            index={4}
            title={t("sections.successDefinition.title")}
            description={t("sections.successDefinition.description")}
          >
            <AreaField
              label={t("fields.growthQuestions")}
              help={t("help.perLine")}
              required
              value={form.growthQuestions}
              onChange={(value) => patchForm({ growthQuestions: value })}
              error={errAt("/growthQuestions")}
            />
            <AreaField
              label={t("fields.ninetyDayGoals")}
              help={t("help.perLine")}
              required
              value={form.ninetyDayGoals}
              onChange={(value) => patchForm({ ninetyDayGoals: value })}
              error={errAt("/ninetyDayGoals")}
            />
          </Section>
        </div>

        <DarkPanel padding="lg" className={styles.aside} aria-label={t("title")}>
          <div className={styles.lens}>
            <div>
              <span className={styles.lensEyebrow}>{t("title")}</span>
              <p className={styles.lensName}>{form.productName.trim() || tCommon("empty")}</p>
              {form.oneLineDescription.trim().length > 0 ? (
                <p className={styles.lensDesc}>{form.oneLineDescription.trim()}</p>
              ) : null}
            </div>

            <div className={styles.lensMeta}>
              <span className={styles.lensMetaLabel}>{t("fields.marketCodes")}</span>
              {marketBadges.length > 0 ? (
                <div className={styles.lensBadges}>
                  {marketBadges.map((code) => (
                    <span key={code} className={styles.lensBadge}>
                      {code}
                    </span>
                  ))}
                </div>
              ) : (
                <span className={styles.lensEmpty}>{tCommon("none")}</span>
              )}
            </div>

            <div className={styles.lensMeta}>
              <span className={styles.lensMetaLabel}>{t("fields.siteLanguageCodes")}</span>
              {languageBadges.length > 0 ? (
                <div className={styles.lensBadges}>
                  {languageBadges.map((code) => (
                    <span key={code} className={styles.lensBadge}>
                      {code}
                    </span>
                  ))}
                </div>
              ) : (
                <span className={styles.lensEmpty}>{tCommon("none")}</span>
              )}
            </div>

            <div className={styles.lensDivider} aria-hidden="true" />

            <ul className={styles.lensChecklist}>
              {checklist.map((item) => (
                <li key={item.label} className={styles.lensCheckItem}>
                  <span
                    className={cx(
                      styles.lensCheckMark,
                      item.done && styles.lensCheckMarkDone,
                    )}
                    aria-hidden="true"
                  >
                    {"✓"}
                  </span>
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>

            <div className={styles.lensDivider} aria-hidden="true" />

            <div className={styles.lensStatusRow}>
              <span className={styles.lensStatusLabel}>{t("title")}</span>
              <StatusPill tone={STATUS_TONE[statusKey]}>{tStatus(statusKey)}</StatusPill>
            </div>
          </div>
        </DarkPanel>
      </div>
    </div>
  );
}
