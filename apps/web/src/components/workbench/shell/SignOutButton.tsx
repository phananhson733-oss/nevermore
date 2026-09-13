"use client";

import { clearAllWorkbenchState, WORKBENCH_SWEPT_EVENT } from "@/lib/workbench/store/persistence";

/** Server action arrives as a prop (serializable); the storage sweep must run in the browser. */
export function SignOutButton({
  action,
  label,
}: {
  readonly action: () => Promise<void>;
  readonly label: string;
}) {
  return (
    <form
      action={action}
      onSubmit={() => {
        try {
          clearAllWorkbenchState(window.localStorage);
          // This document gets no `storage` event for its own writes, so the
          // provider mounted here has to be told the sweep happened.
          window.dispatchEvent(new Event(WORKBENCH_SWEPT_EVENT));
        } catch {
          // Storage unavailable: nothing persisted to clear.
        }
      }}
    >
      <button
        type="submit"
        aria-label={label}
        title={label}
        // Inverted fill: the default `currentColor` focus ring would be white
        // on the cream topbar. The monogram itself is decoration; `aria-label`
        // carries the accessible name.
        className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white focus-visible:outline-slate-900"
      >
        <span aria-hidden="true">GG</span>
      </button>
    </form>
  );
}
