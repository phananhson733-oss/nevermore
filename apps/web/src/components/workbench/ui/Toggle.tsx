"use client";

import { useId } from "react";
import { SWITCH_TRACK } from "./panel.ts";

/**
 * The notification preferences are a row of these (design §6.2). It is a real
 * `<input type="checkbox">` painted as a switch, not a `<div>` with an
 * `onClick`: Space, the disabled state, the label association and the focus ring
 * all come from the platform, and every one of them is something a hand-rolled
 * switch loses without looking any different.
 *
 * `role="switch"` keeps the announcement right ("switch, on") while the checked
 * state stays the native one — `aria-checked` is deliberately NOT written here,
 * because a second source for that state is a second thing to get out of sync.
 *
 * The size is `SWITCH_TRACK` in panel.ts so the 24px hit-area sweep there covers
 * it, and the input itself is the target: a visually-hidden input behind a big
 * label measures 1px to anything checking target size.
 *
 * The description is `aria-describedby`, not part of the label, so the
 * accessible name stays the short one while the sentence is still announced.
 */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  readonly checked: boolean;
  /** Receives the value being switched TO, so a caller cannot re-derive it wrongly. */
  readonly onChange: (next: boolean) => void;
  readonly label: string;
  readonly description?: string | undefined;
  readonly disabled?: boolean | undefined;
}) {
  const id = useId();
  const descriptionId = `${id}-description`;
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled === true}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className={SWITCH_TRACK}
        {...(description === undefined ? {} : { "aria-describedby": descriptionId })}
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-sm font-medium text-slate-900">
          {label}
        </label>
        {description === undefined ? null : (
          <p id={descriptionId} className="text-xs text-slate-500">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
