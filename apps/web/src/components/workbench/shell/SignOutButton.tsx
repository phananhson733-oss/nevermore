"use client";

import { clearAllWorkbenchState } from "@/lib/workbench/store/persistence";

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
        } catch {
          // Storage unavailable: nothing persisted to clear.
        }
      }}
    >
      <button
        type="submit"
        aria-label={label}
        title={label}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white"
      >
        GG
      </button>
    </form>
  );
}
