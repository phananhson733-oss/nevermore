const FIELD_KEYS = ["productUrl", "businessHint"] as const;

type FieldKey = (typeof FIELD_KEYS)[number];

export type ProjectFieldErrors = Partial<Record<FieldKey, string>>;

export interface ProjectFieldError {
  readonly pointer: string;
}

function pointerToField(pointer: string): FieldKey | null {
  const seg = pointer.split("/")[1] ?? "";
  return (FIELD_KEYS as readonly string[]).includes(seg)
    ? (seg as FieldKey)
    : null;
}

export function mapProjectFieldErrors(
  errors: readonly ProjectFieldError[],
  messages: {
    readonly productUrlInvalid: string;
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
      key === "productUrl" ? messages.productUrlInvalid : messages.createError;
  }

  return {
    fieldErrors,
    generalError:
      hasGeneral || Object.keys(fieldErrors).length === 0
        ? messages.createError
        : null,
  };
}
