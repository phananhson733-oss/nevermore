const FIELD_KEYS = [
  "productName",
  "productUrl",
  "customerModel",
  "primaryMarket",
  "growthObjectives",
  "businessHint",
] as const;

export type ProjectFieldKey = (typeof FIELD_KEYS)[number];

export type ProjectFieldErrors = Partial<Record<ProjectFieldKey, string>>;

export interface ProjectFieldError {
  readonly pointer: string;
}

function pointerToField(pointer: string): ProjectFieldKey | null {
  const seg = pointer.split("/")[1] ?? "";
  return (FIELD_KEYS as readonly string[]).includes(seg)
    ? (seg as ProjectFieldKey)
    : null;
}

export function mapProjectFieldErrors(
  errors: readonly ProjectFieldError[],
  messages: {
    readonly productUrlInvalid: string;
    readonly requiredField: string;
    readonly growthObjectivesRequired: string;
    readonly createError: string;
  },
): {
  readonly fieldErrors: ProjectFieldErrors;
  readonly generalError: string | null;
} {
  const fieldErrors: ProjectFieldErrors = {};
  let hasGeneral = false;

  for (const fieldError of errors) {
    const key = pointerToField(fieldError.pointer);
    if (!key) {
      hasGeneral = true;
      continue;
    }
    if (fieldErrors[key] !== undefined) continue;
    fieldErrors[key] =
      key === "productUrl"
        ? messages.productUrlInvalid
        : key === "growthObjectives"
          ? messages.growthObjectivesRequired
          : key === "businessHint"
            ? messages.createError
            : messages.requiredField;
  }

  return {
    fieldErrors,
    generalError:
      hasGeneral || Object.keys(fieldErrors).length === 0
        ? messages.createError
        : null,
  };
}
