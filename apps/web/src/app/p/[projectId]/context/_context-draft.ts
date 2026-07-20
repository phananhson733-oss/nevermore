import type {
  BusinessProfile,
  ConversionType,
  CustomerModel,
  DraftIcpProfilePatch,
  Persona,
} from "@sf/contracts";

export interface PersonaDraft {
  readonly name: string;
  readonly roleOrContext: string;
  readonly jobs: string;
  readonly painPoints: string;
}

export interface FormState {
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

export function emptyPersona(): PersonaDraft {
  return { name: "", roleOrContext: "", jobs: "", painPoints: "" };
}

export const EMPTY_FORM: FormState = {
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

function parseLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

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

/**
 * Build a true PATCH against the last canonical form. Unchanged keys are
 * omitted, while a field the user deliberately emptied is sent as `null` (for
 * scalar/object fields) or `[]` (for list fields). This distinction is required
 * by the draft contract: an absent key inherits its previous value.
 */
export function buildDraftPatch(
  form: FormState,
  baseline: FormState,
): DraftIcpProfilePatch {
  const patch: DraftIcpProfilePatch = {};
  const scalar = (raw: string): string | null => {
    const value = raw.trim();
    return value.length > 0 ? value : null;
  };

  if (form.productName !== baseline.productName)
    patch.productName = scalar(form.productName);
  if (form.oneLineDescription !== baseline.oneLineDescription)
    patch.oneLineDescription = scalar(form.oneLineDescription);
  if (form.customerModel !== baseline.customerModel)
    patch.customerModel = form.customerModel
      ? (form.customerModel as CustomerModel)
      : null;
  if (form.businessProfile !== baseline.businessProfile)
    patch.businessProfile = form.businessProfile
      ? (form.businessProfile as BusinessProfile)
      : null;
  if (form.businessProfileNote !== baseline.businessProfileNote)
    patch.businessProfileNote = scalar(form.businessProfileNote);
  if (form.marketCodes !== baseline.marketCodes)
    patch.marketCodes = parseLines(form.marketCodes);
  if (form.siteLanguageCodes !== baseline.siteLanguageCodes)
    patch.siteLanguageCodes = parseLines(form.siteLanguageCodes);
  if (form.defaultDeliveryLocale !== baseline.defaultDeliveryLocale)
    patch.defaultDeliveryLocale = scalar(form.defaultDeliveryLocale);
  if (form.segments !== baseline.segments)
    patch.segments = parseLines(form.segments);
  if (JSON.stringify(form.personas) !== JSON.stringify(baseline.personas))
    patch.personas = validPersonas(form.personas);
  if (form.useCases !== baseline.useCases)
    patch.useCases = parseLines(form.useCases);
  if (form.offers !== baseline.offers)
    patch.offers = parseLines(form.offers);
  if (form.differentiators !== baseline.differentiators)
    patch.differentiators = parseLines(form.differentiators);

  const conversionChanged =
    form.conversionLabel !== baseline.conversionLabel ||
    form.conversionType !== baseline.conversionType ||
    form.conversionTargetUrl !== baseline.conversionTargetUrl;
  if (conversionChanged) {
    patch.primaryConversion =
      form.conversionLabel.trim() && form.conversionType
        ? {
            label: form.conversionLabel.trim(),
            type: form.conversionType as ConversionType,
            targetUrl: form.conversionTargetUrl.trim() || null,
          }
        : null;
  }

  if (form.priorityProductsOrServices !== baseline.priorityProductsOrServices)
    patch.priorityProductsOrServices = parseLines(
      form.priorityProductsOrServices,
    );
  if (form.priorityUrls !== baseline.priorityUrls)
    patch.priorityUrls = parseLines(form.priorityUrls);
  if (form.competitors !== baseline.competitors)
    patch.competitors = parseLines(form.competitors);
  if (form.brandConstraints !== baseline.brandConstraints)
    patch.brandConstraints = parseLines(form.brandConstraints);
  if (form.complianceConstraints !== baseline.complianceConstraints)
    patch.complianceConstraints = parseLines(form.complianceConstraints);
  if (form.technicalConstraints !== baseline.technicalConstraints)
    patch.technicalConstraints = parseLines(form.technicalConstraints);
  if (form.resourceConstraints !== baseline.resourceConstraints)
    patch.resourceConstraints = parseLines(form.resourceConstraints);
  if (form.growthQuestions !== baseline.growthQuestions)
    patch.growthQuestions = parseLines(form.growthQuestions);
  if (form.ninetyDayGoals !== baseline.ninetyDayGoals)
    patch.ninetyDayGoals = parseLines(form.ninetyDayGoals);
  return patch;
}

/** A partially filled Persona cannot be silently filtered from a draft save. */
export function incompletePersonaPointers(
  rows: readonly PersonaDraft[],
): readonly string[] {
  const pointers: string[] = [];
  rows.forEach((row, index) => {
    const values = {
      name: row.name.trim(),
      roleOrContext: row.roleOrContext.trim(),
      jobs: parseLines(row.jobs),
      painPoints: parseLines(row.painPoints),
    };
    const hasAnyValue =
      values.name.length > 0 ||
      values.roleOrContext.length > 0 ||
      values.jobs.length > 0 ||
      values.painPoints.length > 0;
    if (!hasAnyValue) return;
    if (!values.name) pointers.push(`/personas/${index}/name`);
    if (!values.roleOrContext)
      pointers.push(`/personas/${index}/roleOrContext`);
    if (values.jobs.length === 0) pointers.push(`/personas/${index}/jobs`);
    if (values.painPoints.length === 0)
      pointers.push(`/personas/${index}/painPoints`);
  });
  return pointers;
}

export type DraftSavePreparation =
  | { readonly ok: true; readonly profile: DraftIcpProfilePatch }
  | { readonly ok: false; readonly fieldPointers: readonly string[] };

/** Pure save decision shared by the UI and its regression tests. */
export function prepareDraftSave(
  form: FormState,
  baseline: FormState,
): DraftSavePreparation {
  const fieldPointers = incompletePersonaPointers(form.personas);
  if (fieldPointers.length > 0) return { ok: false, fieldPointers };
  return { ok: true, profile: buildDraftPatch(form, baseline) };
}
