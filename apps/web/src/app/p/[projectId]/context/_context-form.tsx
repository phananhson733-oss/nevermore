"use client";

/**
 * Context (ICP profile) editor — spec §4.2. A two-column workbench: the editable
 * form on the left, a sticky dark "Profile Lens" summary on the right. Draft
 * saves persist the filled subset; Mark complete assembles the full
 * CompleteIcpProfileInput and surfaces pointer-level 422 errors inline (AC-008).
 * Optimistic concurrency rides on `baseVersion`; a 409 shows the conflict notice
 * and reloads the latest version.
 */

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  BriefcaseBusiness,
  Check,
  Crosshair,
  Plus,
  Save,
  Sparkles,
  Target,
  UsersRound,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button,
  DarkPanel,
  Field,
  Spinner,
  StatusPill,
  TextArea,
  TextInput,
  cx,
  useFieldControl,
} from "@/components/ui";
import type {
  StatusTone,
  TextAreaProps,
  TextInputProps,
} from "@/components/ui";
import { ApiError, useProjectContext, useUpdateContext } from "@/lib/api";
import type {
  BusinessProfile,
  CompleteIcpProfileInput,
  ConversionType,
  CustomerModel,
  Persona,
  UpdateContextRequest,
} from "@sf/contracts";
import type { IcpProfile } from "@/lib/api/types";
import { ProblemNotice, ProblemState } from "../_problem-display";
import { setUnsavedContextChanges } from "../_context-navigation-guard";
import {
  EMPTY_FORM,
  emptyPersona,
  prepareDraftSave,
  type FormState,
  type PersonaDraft,
} from "./_context-draft";
import { mapContextFieldErrors } from "./_context-form-errors";
import styles from "./_context-form.module.css";

// --------------------------------------------------------------- Form model --

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

interface AdditionalControlA11y {
  readonly additionalDescribedBy?: string | undefined;
  readonly errorMessageId?: string | undefined;
  readonly forceInvalid?: boolean | undefined;
}

function mergeAriaIds(
  ...ids: readonly (string | undefined)[]
): string | undefined {
  const merged = ids.filter((id): id is string => id !== undefined && id.length > 0);
  return merged.length > 0 ? merged.join(" ") : undefined;
}

/** Preserve Field's local help/error wiring while appending a group-level error. */
function ConnectedTextInput({
  additionalDescribedBy,
  errorMessageId,
  forceInvalid = false,
  ...props
}: TextInputProps & AdditionalControlA11y) {
  const field = useFieldControl();
  return (
    <TextInput
      {...props}
      aria-describedby={mergeAriaIds(
        field?.describedBy,
        additionalDescribedBy,
      )}
      aria-errormessage={errorMessageId}
      invalid={Boolean(forceInvalid || field?.invalid)}
    />
  );
}

function ConnectedTextArea({
  additionalDescribedBy,
  errorMessageId,
  forceInvalid = false,
  ...props
}: TextAreaProps & AdditionalControlA11y) {
  const field = useFieldControl();
  return (
    <TextArea
      {...props}
      aria-describedby={mergeAriaIds(
        field?.describedBy,
        additionalDescribedBy,
      )}
      aria-errormessage={errorMessageId}
      invalid={Boolean(forceInvalid || field?.invalid)}
    />
  );
}

interface TextFieldProps {
  readonly label: ReactNode;
  readonly help?: ReactNode;
  readonly error?: ReactNode;
  readonly required?: boolean;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: string;
  readonly placeholder?: string;
  readonly fieldClassName?: string | undefined;
  readonly controlClassName?: string | undefined;
  readonly controlId?: string | undefined;
  readonly additionalDescribedBy?: string | undefined;
  readonly errorMessageId?: string | undefined;
  readonly forceInvalid?: boolean | undefined;
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
  fieldClassName,
  controlClassName,
  controlId,
  additionalDescribedBy,
  errorMessageId,
  forceInvalid,
}: TextFieldProps) {
  return (
    <Field
      className={fieldClassName}
      label={label}
      help={help}
      error={error}
      required={Boolean(required)}
      {...(controlId !== undefined ? { htmlFor: controlId } : {})}
    >
      <ConnectedTextInput
        className={controlClassName}
        additionalDescribedBy={additionalDescribedBy}
        errorMessageId={errorMessageId}
        forceInvalid={forceInvalid}
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
  readonly fieldClassName?: string | undefined;
  readonly controlClassName?: string | undefined;
  readonly controlId?: string | undefined;
  readonly additionalDescribedBy?: string | undefined;
  readonly errorMessageId?: string | undefined;
  readonly forceInvalid?: boolean | undefined;
}

function AreaField({
  label,
  help,
  error,
  required,
  value,
  onChange,
  rows,
  fieldClassName,
  controlClassName,
  controlId,
  additionalDescribedBy,
  errorMessageId,
  forceInvalid,
}: AreaFieldProps) {
  return (
    <Field
      className={fieldClassName}
      label={label}
      help={help}
      error={error}
      required={Boolean(required)}
      {...(controlId !== undefined ? { htmlFor: controlId } : {})}
    >
      <ConnectedTextArea
        className={controlClassName}
        additionalDescribedBy={additionalDescribedBy}
        errorMessageId={errorMessageId}
        forceInvalid={forceInvalid}
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

interface NumberedListFieldProps {
  readonly label: string;
  readonly help: string;
  readonly error?: string | undefined;
  readonly required?: boolean;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly removeLabel: string;
}

/**
 * A line-list editor whose transport value stays the existing newline-delimited
 * string. The numbered rows mirror the editorial artifact without changing the
 * API's `string[]` semantics (empty rows are still discarded by `parseLines`).
 */
function NumberedListField({
  label,
  help,
  error,
  required = false,
  value,
  onChange,
  removeLabel,
}: NumberedListFieldProps) {
  const controlId = useId();
  const labelId = `${controlId}-label`;
  const helpId = `${controlId}-help`;
  const errorId = `${controlId}-error`;
  const items = value.split("\n");

  function updateItem(index: number, nextValue: string): void {
    const next = [...items];
    next[index] = nextValue;
    onChange(next.join("\n"));
  }

  function addItem(): void {
    onChange([...items, ""].join("\n"));
  }

  function removeItem(index: number): void {
    const next = items.filter((_, itemIndex) => itemIndex !== index);
    onChange(next.length > 0 ? next.join("\n") : "");
  }

  return (
    <div
      className={styles.numberedField}
      id={`${controlId}-group`}
      role="group"
      aria-labelledby={labelId}
      aria-describedby={helpId}
      data-numbered-list=""
    >
      <div className={styles.numberedFieldHead}>
        <h3 className={styles.numberedFieldTitle} id={labelId}>
          {label}
          {required ? (
            <span className={styles.requiredMark} aria-hidden="true">
              {" *"}
            </span>
          ) : null}
        </h3>
        <p className={styles.numberedFieldHelp} id={helpId}>
          {help}
        </p>
      </div>
      <div className={styles.numberedRows}>
        {items.map((item, index) => (
          <div className={styles.numberedRow} key={index}>
            <span className={styles.numberedIndex} aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <TextInput
              className={styles.numberedInput}
              id={`${controlId}-item-${index}`}
              aria-label={`${label} ${index + 1}`}
              aria-describedby={
                error === undefined ? helpId : `${helpId} ${errorId}`
              }
              aria-errormessage={error === undefined ? undefined : errorId}
              aria-invalid={error === undefined ? undefined : true}
              required={required && index === 0}
              value={item}
              onChange={(event) => updateItem(index, event.target.value)}
            />
            {items.length > 1 ? (
              <Button
                variant="text"
                size="sm"
                className={styles.removeListItem}
                onClick={() => removeItem(index)}
                aria-label={`${removeLabel} ${label} ${index + 1}`}
              >
                <X aria-hidden="true" size={15} strokeWidth={1.8} />
              </Button>
            ) : null}
          </div>
        ))}
      </div>
      {error !== undefined ? (
        <p className={styles.inlineError} id={errorId} role="alert">
          {error}
        </p>
      ) : null}
      <Button
        variant="text"
        size="sm"
        className={styles.addListItem}
        onClick={addItem}
      >
        <Plus aria-hidden="true" size={16} strokeWidth={1.9} />
        {label}
      </Button>
    </div>
  );
}

interface SectionProps {
  readonly index: number;
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly icon: ReactNode;
  readonly children: ReactNode;
}

function Section({ index, title, description, icon, children }: SectionProps) {
  return (
    <section className={styles.section} data-context-section={index}>
      <span className={styles.sectionNumber} aria-hidden="true">
        {String(index).padStart(2, "0")}
      </span>
      <div className={styles.sectionInner}>
        <header className={styles.sectionHead}>
          <div>
            <h2 className={styles.sectionTitle}>{title}</h2>
            <p className={styles.sectionDesc}>{description}</p>
          </div>
          <span className={styles.sectionIcon} aria-hidden="true">
            {icon}
          </span>
        </header>
        <div className={styles.sectionBody}>{children}</div>
      </div>
    </section>
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
  const personasControlId = useId();

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
  const [baselineForm, setBaselineForm] = useState<FormState>(() =>
    initialProfile ? fromProfile(initialProfile.profile) : EMPTY_FORM,
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
    setBaselineForm(next);
  }, [currentProfile]);

  const isDirty = serialize(form) !== serialize(baselineForm);
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
    const submittedSnapshot = serialize(form);
    try {
      const saved = await update.mutateAsync(body);
      const canonicalForm = fromProfile(saved.profile);
      syncedKey.current = `${saved.id}@${saved.version}`;
      // The API removes empty list rows and incomplete draft-only structures.
      // Reconcile an unchanged UI with that canonical response so "saved" can
      // never describe data that was not persisted. Preserve edits made while
      // the request was in flight and compare them against the server baseline.
      setForm((current) =>
        serialize(current) === submittedSnapshot ? canonicalForm : current,
      );
      setBaselineForm(canonicalForm);
      setJustSaved(true);
    } catch (error) {
      handleError(error);
    } finally {
      setSavingMode(null);
    }
  }

  function onSaveDraft(): void {
    const preparation = prepareDraftSave(form, baselineForm);
    if (!preparation.ok) {
      const message = t("qualificationIncomplete");
      setJustSaved(false);
      setTopAlert(message);
      setTopProblem(null);
      setFieldErrors(
        Object.fromEntries(
          preparation.fieldPointers.map((pointer) => [pointer, message]),
        ),
      );
      return;
    }
    const { profile } = preparation;
    if (Object.keys(profile).length === 0) return;
    void runSave("draft", { mode: "draft", baseVersion, profile });
  }

  function onMarkComplete(): void {
    const profile = buildCompleteInput(form);
    void runSave("complete", { mode: "complete", baseVersion, profile });
  }

  const errAt = (pointer: string): string | undefined => {
    // The API returns RFC 6901 paths rooted at `/profile`; retain support for
    // older tests/fixtures that used the profile-relative form.
    for (const candidate of [pointer, `/profile${pointer}`]) {
      const exact = fieldErrors[candidate];
      if (exact !== undefined) return exact;
      const prefix = `${candidate}/`;
      for (const key of Object.keys(fieldErrors)) {
        if (key.startsWith(prefix)) return fieldErrors[key];
      }
    }
    return undefined;
  };
  const personasError = errAt("/personas");
  const personasLabelId = `${personasControlId}-label`;
  const personasHelpId = `${personasControlId}-help`;
  const personasErrorId = `${personasControlId}-error`;
  const personasDescribedBy = mergeAriaIds(
    personasHelpId,
    personasError === undefined ? undefined : personasErrorId,
  );

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
  const segmentLines = form.segments.split("\n");
  const primarySegment = segmentLines[0] ?? "";
  const secondarySegments = segmentLines.slice(1).join("\n");

  function joinSegments(primary: string, secondary: string): string {
    return secondary.length > 0 ? `${primary}\n${secondary}` : primary;
  }

  const busy = savingMode !== null;
  const saveStatus: { text: string; className: string | undefined } = busy
    ? { text: t("saving"), className: undefined }
    : isDirty
      ? { text: t("unsavedChanges"), className: styles.saveStatusDirty }
      : justSaved
        ? { text: t("savedJustNow"), className: styles.saveStatusSaved }
        : { text: t("saved"), className: undefined };

  const checklist: readonly {
    readonly done: boolean;
    readonly label: string;
    readonly description: string;
  }[] = [
    {
      done: flags.businessFrame,
      label: t("sections.businessFrame.title"),
      description: t("sections.businessFrame.description"),
    },
    {
      done: flags.idealCustomer,
      label: t("sections.idealCustomer.title"),
      description: t("sections.idealCustomer.description"),
    },
    {
      done: flags.commercialFocus,
      label: t("sections.commercialFocus.title"),
      description: t("sections.commercialFocus.description"),
    },
    {
      done: flags.successDefinition,
      label: t("sections.successDefinition.title"),
      description: t("sections.successDefinition.description"),
    },
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
    <div className={styles.page} data-context-page="">
      <header className={styles.hero}>
        <div className={styles.heroText}>
          <div className={styles.heroMeta}>
            <span className="sf-eyebrow">{versionLabel}</span>
            <StatusPill tone={STATUS_TONE[statusKey]}>{tStatus(statusKey)}</StatusPill>
          </div>
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
              <Save aria-hidden="true" size={16} strokeWidth={2} />
              {t("markComplete")}
            </Button>
          </div>
        </div>
      </header>

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

      <div className={styles.grid} data-context-layout="">
        <div className={styles.formCol}>
          <Section
            index={1}
            title={
              form.productName.trim().length > 0
                ? `${form.productName.trim()} · ${t("sections.businessFrame.title")}`
                : t("sections.businessFrame.title")
            }
            description={t("sections.businessFrame.description")}
            icon={<BriefcaseBusiness size={23} strokeWidth={1.7} />}
          >
            <div className={styles.businessLead}>
              <TextField
                label={t("fields.productName")}
                required
                value={form.productName}
                onChange={(value) => patchForm({ productName: value })}
                error={errAt("/productName")}
                controlClassName={styles.leadInput}
              />
              <AreaField
                label={t("fields.oneLineDescription")}
                required
                rows={4}
                value={form.oneLineDescription}
                onChange={(value) => patchForm({ oneLineDescription: value })}
                error={errAt("/oneLineDescription")}
                controlClassName={styles.descriptionControl}
              />
            </div>

            <div className={styles.businessMetaCard}>
              <Field
                className={styles.metaCell}
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
                className={styles.metaCell}
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

            <div className={styles.marketGrid}>
              <AreaField
                label={t("fields.marketCodes")}
                help={t("help.markets")}
                required
                rows={3}
                value={form.marketCodes}
                onChange={(value) => patchForm({ marketCodes: value })}
                error={errAt("/marketCodes")}
                controlClassName={styles.compactArea}
              />
              <AreaField
                label={t("fields.siteLanguageCodes")}
                help={t("help.languages")}
                required
                rows={3}
                value={form.siteLanguageCodes}
                onChange={(value) => patchForm({ siteLanguageCodes: value })}
                error={errAt("/siteLanguageCodes")}
                controlClassName={styles.compactArea}
              />
              <TextField
                label={t("fields.defaultDeliveryLocale")}
                help={t("help.locale")}
                required
                value={form.defaultDeliveryLocale}
                onChange={(value) => patchForm({ defaultDeliveryLocale: value })}
                error={errAt("/defaultDeliveryLocale")}
              />
            </div>
          </Section>

          <Section
            index={2}
            title={t("sections.idealCustomer.title")}
            description={t("sections.idealCustomer.description")}
            icon={<UsersRound size={23} strokeWidth={1.7} />}
          >
            <div className={styles.segmentGrid} data-segment-cards="">
              <div
                className={cx(styles.segmentCard, styles.segmentCardPrimary)}
                data-icp-card="primary"
              >
                <span className={styles.cardEyebrow}>ICP 01</span>
                <AreaField
                  label={`${t("fields.segments")} · ICP 01`}
                  required
                  rows={3}
                  value={primarySegment}
                  onChange={(value) =>
                    patchForm({ segments: joinSegments(value, secondarySegments) })
                  }
                  error={errAt("/segments")}
                  controlClassName={styles.segmentControl}
                />
              </div>
              <div className={styles.segmentCard} data-icp-card="secondary">
                <span className={styles.cardEyebrow}>ICP 02</span>
                <AreaField
                  label={`${t("fields.segments")} · ICP 02`}
                  help={t("help.perLine")}
                  rows={3}
                  value={secondarySegments}
                  onChange={(value) =>
                    patchForm({ segments: joinSegments(primarySegment, value) })
                  }
                  controlClassName={styles.segmentControl}
                />
              </div>
            </div>

            <div
              className={styles.personaField}
              id={`${personasControlId}-group`}
              role="group"
              aria-labelledby={personasLabelId}
              aria-describedby={personasDescribedBy}
              aria-errormessage={
                personasError === undefined ? undefined : personasErrorId
              }
              aria-invalid={personasError === undefined ? undefined : true}
            >
              <div className={styles.personaFieldHead}>
                <h3 className={styles.personaFieldTitle} id={personasLabelId}>
                  {t("fields.personas")}
                  <span className={styles.requiredMark} aria-hidden="true">
                    {" *"}
                  </span>
                </h3>
                <p className={styles.personaFieldHelp} id={personasHelpId}>
                  {t("help.perLine")}
                </p>
              </div>
              {personasError !== undefined ? (
                <p className={styles.inlineError} id={personasErrorId} role="alert">
                  {personasError}
                </p>
              ) : null}
              <div
                className={styles.personaTable}
                role="table"
                aria-label={t("fields.personas")}
                data-persona-table=""
              >
                <div className={styles.personaTableHead} role="row">
                  <span
                    className={styles.personaIndexHead}
                    role="columnheader"
                    aria-label="№"
                  />
                  <span role="columnheader">
                    {t("fields.personaName")} / {t("fields.personaRole")}
                  </span>
                  <span role="columnheader">{t("fields.personaJobs")}</span>
                  <span role="columnheader">{t("fields.personaPains")}</span>
                </div>
                {form.personas.map((persona, index) => (
                  <div
                    className={styles.personaRow}
                    role="row"
                    key={index}
                    data-persona-row={index}
                  >
                    <span className={styles.personaOrdinal} role="cell">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className={styles.personaIdentity} role="cell">
                      <TextField
                        fieldClassName={styles.personaCell}
                        controlClassName={styles.personaInput}
                        controlId={`${personasControlId}-row-${index}-name`}
                        additionalDescribedBy={
                          personasError === undefined ? undefined : personasErrorId
                        }
                        errorMessageId={
                          personasError === undefined ? undefined : personasErrorId
                        }
                        forceInvalid={personasError !== undefined}
                        label={t("fields.personaName")}
                        required
                        value={persona.name}
                        onChange={(value) => updatePersona(index, { name: value })}
                        error={errAt(`/personas/${index}/name`)}
                      />
                      <TextField
                        fieldClassName={styles.personaCell}
                        controlClassName={styles.personaInput}
                        controlId={`${personasControlId}-row-${index}-role`}
                        additionalDescribedBy={
                          personasError === undefined ? undefined : personasErrorId
                        }
                        errorMessageId={
                          personasError === undefined ? undefined : personasErrorId
                        }
                        forceInvalid={personasError !== undefined}
                        label={t("fields.personaRole")}
                        required
                        value={persona.roleOrContext}
                        onChange={(value) => updatePersona(index, { roleOrContext: value })}
                        error={errAt(`/personas/${index}/roleOrContext`)}
                      />
                    </div>
                    <div className={styles.personaDataCell} role="cell">
                      <AreaField
                        fieldClassName={styles.personaCell}
                        controlClassName={styles.personaArea}
                        controlId={`${personasControlId}-row-${index}-jobs`}
                        additionalDescribedBy={
                          personasError === undefined ? undefined : personasErrorId
                        }
                        errorMessageId={
                          personasError === undefined ? undefined : personasErrorId
                        }
                        forceInvalid={personasError !== undefined}
                        label={t("fields.personaJobs")}
                        help={t("help.perLine")}
                        required
                        rows={3}
                        value={persona.jobs}
                        onChange={(value) => updatePersona(index, { jobs: value })}
                        error={errAt(`/personas/${index}/jobs`)}
                      />
                    </div>
                    <div className={styles.personaDataCell} role="cell">
                      <AreaField
                        fieldClassName={styles.personaCell}
                        controlClassName={styles.personaArea}
                        controlId={`${personasControlId}-row-${index}-pains`}
                        additionalDescribedBy={
                          personasError === undefined ? undefined : personasErrorId
                        }
                        errorMessageId={
                          personasError === undefined ? undefined : personasErrorId
                        }
                        forceInvalid={personasError !== undefined}
                        label={t("fields.personaPains")}
                        help={t("help.perLine")}
                        required
                        rows={3}
                        value={persona.painPoints}
                        onChange={(value) => updatePersona(index, { painPoints: value })}
                        error={errAt(`/personas/${index}/painPoints`)}
                      />
                      <div className={styles.personaAction}>
                        {form.personas.length > 1 ? (
                          <Button
                            variant="text"
                            size="sm"
                            className={styles.removePersona}
                            onClick={() => removePersona(index)}
                            aria-label={`${tCommon("close")} #${index + 1}`}
                          >
                            <X aria-hidden="true" size={16} strokeWidth={1.8} />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <Button
                variant="text"
                size="sm"
                className={styles.addPersona}
                onClick={addPersona}
              >
                <Plus aria-hidden="true" size={16} strokeWidth={1.9} />
                {t("fields.personas")}
              </Button>
            </div>

            <AreaField
              label={t("fields.useCases")}
              help={t("help.perLine")}
              required
              rows={4}
              value={form.useCases}
              onChange={(value) => patchForm({ useCases: value })}
              error={errAt("/useCases")}
              controlClassName={styles.compactArea}
            />
          </Section>

          <Section
            index={3}
            title={t("sections.commercialFocus.title")}
            description={t("sections.commercialFocus.description")}
            icon={<Crosshair size={23} strokeWidth={1.7} />}
          >
            <div className={styles.productCompetitionGrid}>
              <div className={styles.productCard} data-product-card="">
                <div className={styles.editorialCardHead}>
                  <span className={styles.editorialCardIcon} aria-hidden="true">
                    <Target size={18} strokeWidth={1.8} />
                  </span>
                  <h3>{t("fields.priorityProductsOrServices")}</h3>
                </div>
                <AreaField
                  fieldClassName={styles.darkField}
                  controlClassName={styles.darkControl}
                  label={t("fields.priorityProductsOrServices")}
                  help={t("help.perLine")}
                  required
                  rows={3}
                  value={form.priorityProductsOrServices}
                  onChange={(value) => patchForm({ priorityProductsOrServices: value })}
                  error={errAt("/priorityProductsOrServices")}
                />
                <div className={styles.productCardSplit}>
                  <AreaField
                    fieldClassName={styles.darkField}
                    controlClassName={styles.darkControl}
                    label={t("fields.offers")}
                    help={t("help.perLine")}
                    required
                    rows={3}
                    value={form.offers}
                    onChange={(value) => patchForm({ offers: value })}
                    error={errAt("/offers")}
                  />
                  <AreaField
                    fieldClassName={styles.darkField}
                    controlClassName={styles.darkControl}
                    label={t("fields.differentiators")}
                    help={t("help.perLine")}
                    required
                    rows={3}
                    value={form.differentiators}
                    onChange={(value) => patchForm({ differentiators: value })}
                    error={errAt("/differentiators")}
                  />
                </div>
              </div>

              <div className={styles.competitionCard} data-competition-card="">
                <div className={styles.editorialCardHead}>
                  <span className={styles.editorialCardIndex} aria-hidden="true">
                    03
                  </span>
                  <h3>{t("fields.competitors")}</h3>
                </div>
                <AreaField
                  label={t("fields.competitors")}
                  help={t("help.perLine")}
                  rows={4}
                  value={form.competitors}
                  onChange={(value) => patchForm({ competitors: value })}
                  error={errAt("/competitors")}
                  controlClassName={styles.compactArea}
                />
                <AreaField
                  label={t("fields.priorityUrls")}
                  help={t("help.urls")}
                  rows={3}
                  value={form.priorityUrls}
                  onChange={(value) => patchForm({ priorityUrls: value })}
                  error={errAt("/priorityUrls")}
                  controlClassName={styles.compactArea}
                />
              </div>
            </div>

            <div className={styles.conversionPanel}>
              <div className={styles.conversionHead}>
                <h3>
                  {t("fields.primaryConversion")}
                  <span className={styles.requiredMark} aria-hidden="true">
                    {" *"}
                  </span>
                </h3>
              </div>
              <div className={styles.conversionGrid}>
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
                <TextField
                  label={t("fields.conversionTargetUrl")}
                  type="url"
                  value={form.conversionTargetUrl}
                  onChange={(value) => patchForm({ conversionTargetUrl: value })}
                  error={errAt("/primaryConversion/targetUrl")}
                />
              </div>
              {errAt("/primaryConversion") !== undefined ? (
                <p className={styles.inlineError} role="alert">
                  {errAt("/primaryConversion")}
                </p>
              ) : null}
            </div>

            <div className={styles.constraintGrid}>
              <AreaField
                label={t("fields.brandConstraints")}
                help={t("help.perLine")}
                rows={3}
                value={form.brandConstraints}
                onChange={(value) => patchForm({ brandConstraints: value })}
                error={errAt("/brandConstraints")}
                controlClassName={styles.compactArea}
              />
              <AreaField
                label={t("fields.complianceConstraints")}
                help={t("help.perLine")}
                rows={3}
                value={form.complianceConstraints}
                onChange={(value) => patchForm({ complianceConstraints: value })}
                error={errAt("/complianceConstraints")}
                controlClassName={styles.compactArea}
              />
              <AreaField
                label={t("fields.technicalConstraints")}
                help={t("help.perLine")}
                rows={3}
                value={form.technicalConstraints}
                onChange={(value) => patchForm({ technicalConstraints: value })}
                error={errAt("/technicalConstraints")}
                controlClassName={styles.compactArea}
              />
              <AreaField
                label={t("fields.resourceConstraints")}
                help={t("help.perLine")}
                rows={3}
                value={form.resourceConstraints}
                onChange={(value) => patchForm({ resourceConstraints: value })}
                error={errAt("/resourceConstraints")}
                controlClassName={styles.compactArea}
              />
            </div>
          </Section>

          <Section
            index={4}
            title={t("sections.successDefinition.title")}
            description={t("sections.successDefinition.description")}
            icon={<Target size={23} strokeWidth={1.7} />}
          >
            <div className={styles.successGrid}>
              <AreaField
                label={t("fields.growthQuestions")}
                help={t("help.perLine")}
                required
                rows={5}
                value={form.growthQuestions}
                onChange={(value) => patchForm({ growthQuestions: value })}
                error={errAt("/growthQuestions")}
                controlClassName={styles.successQuestions}
              />
              <NumberedListField
                label={t("fields.ninetyDayGoals")}
                help={t("help.perLine")}
                required
                value={form.ninetyDayGoals}
                onChange={(value) => patchForm({ ninetyDayGoals: value })}
                error={errAt("/ninetyDayGoals")}
                removeLabel={tCommon("close")}
              />
            </div>
          </Section>
        </div>

        <aside className={styles.aside} data-context-rail="">
          <DarkPanel padding="none" className={styles.lensPanel} aria-label={t("title")}>
            <div className={styles.lens}>
              <div className={styles.lensIntro}>
                <span className={styles.lensMark} aria-hidden="true">
                  <Sparkles size={19} strokeWidth={1.8} />
                </span>
                <div>
                  <span className={styles.lensEyebrow}>{t("title")}</span>
                  <p className={styles.lensName}>
                    {form.productName.trim() || tCommon("empty")}
                  </p>
                </div>
              </div>
              <p className={styles.lensDesc}>
                {form.oneLineDescription.trim() || tCommon("empty")}
              </p>

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
                      {item.done ? <Check size={13} strokeWidth={2.4} /> : null}
                    </span>
                    <span className={styles.lensCheckCopy}>
                      <strong>{item.label}</strong>
                      <span>{item.description}</span>
                    </span>
                  </li>
                ))}
              </ul>

              <div className={styles.lensSnapshot}>
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
                  <span className={styles.lensMetaLabel}>
                    {t("fields.siteLanguageCodes")}
                  </span>
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
              </div>

              <div className={styles.lensCallout}>
                <span>{t("sections.successDefinition.title")}</span>
                <p>{t("sections.successDefinition.description")}</p>
              </div>

              <div className={styles.lensStatusRow}>
                <span className={styles.lensStatusLabel}>{t("title")}</span>
                <StatusPill tone={STATUS_TONE[statusKey]}>{tStatus(statusKey)}</StatusPill>
              </div>
            </div>
          </DarkPanel>
        </aside>
      </div>
    </div>
  );
}
