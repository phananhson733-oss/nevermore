"use client";

import { forwardRef } from "react";
import type { AriaAttributes, TextareaHTMLAttributes } from "react";
import { cx } from "./cx.ts";
import { useFieldControl } from "./Field.tsx";
import styles from "./ui.module.css";

type AriaInvalid = AriaAttributes["aria-invalid"];

function ariaInvalidToBool(value: AriaInvalid): boolean | undefined {
  if (value === undefined) return undefined;
  return value === true || value === "true" || value === "grammar" || value === "spelling";
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Force the invalid style. Otherwise inherited from an enclosing `Field`. */
  readonly invalid?: boolean;
}

/**
 * Multi-line text control (min-height ~120px, vertically resizable). Inherits
 * `Field` wiring exactly like `TextInput`; focus uses the global ring.
 */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
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
    <textarea
      ref={ref}
      id={resolvedId}
      className={cx(styles.control, styles.controlTextarea, isInvalid && styles.controlInvalid, className)}
      aria-describedby={resolvedDescribedBy}
      aria-invalid={isInvalid || undefined}
      required={resolvedRequired}
      {...rest}
    />
  );
});
