export interface ContextFieldError {
  readonly pointer: string;
}

export function mapContextFieldErrors(
  errors: readonly ContextFieldError[],
  localizedMessage: string,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const fieldError of errors) {
    if (!(fieldError.pointer in map)) {
      map[fieldError.pointer] = localizedMessage;
    }
  }
  return map;
}
