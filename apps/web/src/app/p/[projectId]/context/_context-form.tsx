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
import {
  Button,
  Card,
  DarkPanel,
  EmptyState,
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

// Labels for fields the `context.fields.*` namespace does not carry.
const STATIC_LABELS = {
  marketCodes: "Target markets",
  siteLanguageCodes: "Site languages",
  defaultDeliveryLocale: "Default delivery locale",
  brandConstraints: "Brand constraints",
  complianceConstraints: "Compliance constraints",
  technicalConstraints: "Technical constraints",
  resourceConstraints: "Resource constraints",
  personaName: "Name",
  personaRole: "Role or context",
  personaJobs: "Jobs to be done",
  personaPains: "Pain points",
  conversionLabel: "Conversion label",
  conversionType: "Conversion type",
  conversionTargetUrl: "Target URL",
} as const;

const HELP = {
  perLine: "One item per line.",
  markets: "One per line — ISO-2 uppercase (e.g. US, GB).",
  languages: "One per line — BCP-47 tags (e.g. en, en-US).",
  locale: "A BCP-47 tag (e.g. en-US).",
  urls: "One URL per line.",
} as const;

interface SelectOption {
  readonly value: string;
  readonly label: string;
}

const CUSTOMER_MODELS: readonly SelectOption[] = [
  { value: "b2b", label: "B2B" },
  { value: "b2c", label: "B2C" },
  { value: "hybrid", label: "Hybrid" },
];

const BUSINESS_PROFILES: readonly SelectOption[] = [
  { value: "b2b_saas", label: "B2B SaaS" },
  { value: "b2b_services", label: "B2B services" },
  { value: "b2c_ecommerce", label: "B2C e-commerce" },
  { value: "b2c_subscription", label: "B2C subscription" },
  { value: "marketplace", label: "Marketplace" },
  { value: "publisher", label: "Publisher" },
  { value: "other", label: "Other" },
];

const CONVERSION_TYPES: readonly SelectOption[] = [
  { value: "demo", label: "Demo" },
  { value: "signup", label: "Sign up" },
  { value: "trial", label: "Trial" },
  { value: "purchase", label: "Purchase" },
  { value: "lead", label: "Lead" },
  { value: "contact", label: "Contact" },
  { value: "subscribe", label: "Subscribe" },
  { value: "offline", label: "Offline" },
  { value: "other", label: "Other" },
];

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
}

export function ContextForm({ projectId }: ContextFormProps) {
  const t = useTranslations("context");
  const tCommon = useTranslations("common");
  const tStatus = useTranslations("contextStatus");

  const query = useProjectContext(projectId);
  const update = useUpdateContext(projectId);
  const currentProfile = query.data ?? null;

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [baseline, setBaseline] = useState<string>(serialize(EMPTY_FORM));
  const [justSaved, setJustSaved] = useState<boolean>(false);
  const [savingMode, setSavingMode] = useState<SaveMode | null>(null);
  const [topAlert, setTopAlert] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const syncedKey = useRef<string | null>(null);

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

  function clearFeedback(): void {
    setJustSaved(false);
    setTopAlert((prev) => (prev === null ? prev : null));
    setFieldErrors((prev) => (Object.keys(prev).length === 0 ? prev : {}));
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
        void query.refetch();
        return;
      }
      const errors = error.fieldErrors();
      if (errors.length > 0) {
        const map: Record<string, string> = {};
        for (const fieldError of errors) {
          if (!(fieldError.pointer in map)) map[fieldError.pointer] = fieldError.message;
        }
        setFieldErrors(map);
        setTopAlert(t("qualificationIncomplete"));
        return;
      }
      setTopAlert(error.message);
      return;
    }
    setTopAlert(tCommon("error"));
  }

  async function runSave(mode: SaveMode, body: UpdateContextRequest): Promise<void> {
    setSavingMode(mode);
    setTopAlert(null);
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
    return (
      <EmptyState title={tCommon("error")} description={query.error?.message}>
        <Button variant="secondary" onClick={() => void query.refetch()}>
          {tCommon("retry")}
        </Button>
      </EmptyState>
    );
  }

  const versionLabel = currentProfile ? `Version ${currentProfile.version}` : "New";
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
        <p className={styles.alert} role="alert">
          {topAlert}
        </p>
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
                  options={CUSTOMER_MODELS}
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
                  options={BUSINESS_PROFILES}
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
                label={STATIC_LABELS.marketCodes}
                help={HELP.markets}
                required
                value={form.marketCodes}
                onChange={(value) => patchForm({ marketCodes: value })}
                error={errAt("/marketCodes")}
              />
              <AreaField
                label={STATIC_LABELS.siteLanguageCodes}
                help={HELP.languages}
                required
                value={form.siteLanguageCodes}
                onChange={(value) => patchForm({ siteLanguageCodes: value })}
                error={errAt("/siteLanguageCodes")}
              />
            </div>
            <TextField
              label={STATIC_LABELS.defaultDeliveryLocale}
              help={HELP.locale}
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
              help={HELP.perLine}
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
                        label={STATIC_LABELS.personaName}
                        required
                        value={persona.name}
                        onChange={(value) => updatePersona(index, { name: value })}
                        error={errAt(`/personas/${index}/name`)}
                      />
                      <TextField
                        label={STATIC_LABELS.personaRole}
                        required
                        value={persona.roleOrContext}
                        onChange={(value) => updatePersona(index, { roleOrContext: value })}
                        error={errAt(`/personas/${index}/roleOrContext`)}
                      />
                      <AreaField
                        label={STATIC_LABELS.personaJobs}
                        help={HELP.perLine}
                        required
                        value={persona.jobs}
                        onChange={(value) => updatePersona(index, { jobs: value })}
                        error={errAt(`/personas/${index}/jobs`)}
                      />
                      <AreaField
                        label={STATIC_LABELS.personaPains}
                        help={HELP.perLine}
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
              help={HELP.perLine}
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
                help={HELP.perLine}
                required
                value={form.offers}
                onChange={(value) => patchForm({ offers: value })}
                error={errAt("/offers")}
              />
              <AreaField
                label={t("fields.differentiators")}
                help={HELP.perLine}
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
                  label={STATIC_LABELS.conversionLabel}
                  required
                  value={form.conversionLabel}
                  onChange={(value) => patchForm({ conversionLabel: value })}
                  error={errAt("/primaryConversion/label")}
                />
                <Field
                  label={STATIC_LABELS.conversionType}
                  required
                  error={errAt("/primaryConversion/type")}
                >
                  <NativeSelect
                    value={form.conversionType}
                    onChange={(value) => patchForm({ conversionType: value })}
                    options={CONVERSION_TYPES}
                    placeholder={tCommon("none")}
                  />
                </Field>
              </div>
            </Field>
            <TextField
              label={STATIC_LABELS.conversionTargetUrl}
              type="url"
              value={form.conversionTargetUrl}
              onChange={(value) => patchForm({ conversionTargetUrl: value })}
              error={errAt("/primaryConversion/targetUrl")}
            />
            <AreaField
              label={t("fields.priorityProductsOrServices")}
              help={HELP.perLine}
              required
              value={form.priorityProductsOrServices}
              onChange={(value) => patchForm({ priorityProductsOrServices: value })}
              error={errAt("/priorityProductsOrServices")}
            />
            <div className={styles.row2}>
              <AreaField
                label={t("fields.priorityUrls")}
                help={HELP.urls}
                value={form.priorityUrls}
                onChange={(value) => patchForm({ priorityUrls: value })}
                error={errAt("/priorityUrls")}
              />
              <AreaField
                label={t("fields.competitors")}
                help={HELP.perLine}
                value={form.competitors}
                onChange={(value) => patchForm({ competitors: value })}
                error={errAt("/competitors")}
              />
            </div>
            <div className={styles.row2}>
              <AreaField
                label={STATIC_LABELS.brandConstraints}
                help={HELP.perLine}
                value={form.brandConstraints}
                onChange={(value) => patchForm({ brandConstraints: value })}
                error={errAt("/brandConstraints")}
              />
              <AreaField
                label={STATIC_LABELS.complianceConstraints}
                help={HELP.perLine}
                value={form.complianceConstraints}
                onChange={(value) => patchForm({ complianceConstraints: value })}
                error={errAt("/complianceConstraints")}
              />
            </div>
            <div className={styles.row2}>
              <AreaField
                label={STATIC_LABELS.technicalConstraints}
                help={HELP.perLine}
                value={form.technicalConstraints}
                onChange={(value) => patchForm({ technicalConstraints: value })}
                error={errAt("/technicalConstraints")}
              />
              <AreaField
                label={STATIC_LABELS.resourceConstraints}
                help={HELP.perLine}
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
              help={HELP.perLine}
              required
              value={form.growthQuestions}
              onChange={(value) => patchForm({ growthQuestions: value })}
              error={errAt("/growthQuestions")}
            />
            <AreaField
              label={t("fields.ninetyDayGoals")}
              help={HELP.perLine}
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
              <span className={styles.lensMetaLabel}>{STATIC_LABELS.marketCodes}</span>
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
              <span className={styles.lensMetaLabel}>{STATIC_LABELS.siteLanguageCodes}</span>
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
