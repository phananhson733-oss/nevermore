"use client";

import { forwardRef } from "react";
import type { AriaAttributes, InputHTMLAttributes } from "react";
import { cx } from "./cx.ts";
import { useFieldControl } from "./Field.tsx";
import styles from "./ui.module.css";

type AriaInvalid = AriaAttributes["aria-invalid"];

function ariaInvalidToBool(value: AriaInvalid): boolean | undefined {
  if (value === undefined) return undefined;
  return value === true || value === "true" || value === "grammar" || value === "spelling";
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Force the invalid style. Otherwise inherited from an enclosing `Field`. */
  readonly invalid?: boolean;
}

/**
 * Single-line text control. When rendered inside a `Field` it inherits the
 * control id, `aria-describedby`, `aria-invalid`, and `required` automatically;
 * explicit props always win. Focus relies on the global focus-visible ring.
 */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  {
    id,
    className,
    invalid,
    required,
    "aria-describedby": ariaDescribedBy,
    "aria-invalid": ariaInvalid,
    ...rest
  },
  ref,
) {
  const field = useFieldControl();
  const resolvedId = id ?? field?.controlId;
  const resolvedDescribedBy = ariaDescribedBy ?? field?.describedBy;
  const resolvedRequired = required ?? field?.required;
  const isInvalid = invalid ?? ariaInvalidToBool(ariaInvalid) ?? field?.invalid ?? false;

  return (
    <input
      ref={ref}
      id={resolvedId}
      className={cx(styles.control, isInvalid && styles.controlInvalid, className)}
      aria-describedby={resolvedDescribedBy}
      aria-invalid={isInvalid || undefined}
      required={resolvedRequired}
      {...rest}
    />
  );
});
