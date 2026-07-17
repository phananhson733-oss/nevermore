"use client";

import { createContext, useContext, useId } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx.ts";
import styles from "./ui.module.css";

/**
 * Wiring a `Field` shares with the control it wraps: the id to bind the label
 * to, the `aria-describedby` list (help + error), the invalid flag, and whether
 * the control is required. `TextInput` / `TextArea` read this to auto-associate.
 */
export interface FieldControl {
  readonly controlId: string;
  readonly describedBy: string | undefined;
  readonly invalid: boolean;
  readonly required: boolean;
}

const FieldContext = createContext<FieldControl | null>(null);

/** Read the enclosing `Field`'s wiring, or `null` when used standalone. */
export function useFieldControl(): FieldControl | null {
  return useContext(FieldContext);
}

export interface FieldProps extends Omit<HTMLAttributes<HTMLDivElement>, "id"> {
  readonly label: ReactNode;
  readonly help?: ReactNode;
  readonly error?: ReactNode;
  readonly required?: boolean;
  /** Bind the label to a specific control id instead of the generated one. */
  readonly htmlFor?: string;
}

function isPresent(node: ReactNode): boolean {
  return node != null && node !== false && node !== "";
}

/**
 * Labeled form field. Associates label -> control via `htmlFor`/`id`, wires
 * `aria-describedby` to help + error text, and flags `aria-invalid` when an
 * error is present. Error copy uses the coral token.
 */
export function Field({
  label,
  help,
  error,
  required = false,
  htmlFor,
  className,
  children,
  ...rest
}: FieldProps) {
  const reactId = useId();
  const controlId = htmlFor ?? `${reactId}-control`;
  const helpId = `${reactId}-help`;
  const errorId = `${reactId}-error`;

  const hasHelp = isPresent(help);
  const hasError = isPresent(error);
  const describedBy =
    [hasHelp ? helpId : null, hasError ? errorId : null]
      .filter((value): value is string => value !== null)
      .join(" ") || undefined;

  const control: FieldControl = {
    controlId,
    describedBy,
    invalid: hasError,
    required,
  };

  return (
    <div className={cx(styles.field, className)} {...rest}>
      <label className={styles.fieldLabel} htmlFor={controlId}>
        {label}
        {required ? (
          <span className={styles.fieldRequired} aria-hidden="true">
            {" *"}
          </span>
        ) : null}
      </label>
      <FieldContext.Provider value={control}>{children}</FieldContext.Provider>
      {hasHelp ? (
        <p className={styles.fieldHelp} id={helpId}>
          {help}
        </p>
      ) : null}
      {hasError ? (
        <p className={styles.fieldError} id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
