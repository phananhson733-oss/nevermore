import type { ReactNode } from "react";

/**
 * One labelled form row: label on the left, an optional right-aligned meta note
 * (the prototype's `<i>`: a host name, a character count, "4 items"), control
 * below.
 *
 * `htmlFor` is required rather than optional-with-a-generated-id: the caller
 * owns the control's id anyway, and a `<label>` that wraps its control reads
 * fine but cannot be pointed at from a test or an error message.
 *
 * All copy arrives as props — no literal strings live here (next-intl in the
 * consuming view).
 */
export function Field({
  label,
  meta,
  htmlFor,
  children,
}: {
  readonly label: string;
  readonly meta?: ReactNode | undefined;
  readonly htmlFor: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-sm font-medium text-slate-600">
          {label}
        </label>
        {/* Not `meta ? …`: a meta of 0 or "" is a value the caller chose to show. */}
        {meta === undefined || meta === null ? null : (
          <span className="text-xs text-slate-500">{meta}</span>
        )}
      </div>
      {children}
    </div>
  );
}
