// @input  -- account-gated tool CTA label, styling, and shared sign-in dialog
// @output -- a semantic button that opens the existing Google sign-in flow
// @pos    -- tiny client boundary used by server-rendered connected-tool heroes

"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { SignInDialog } from "../auth/sign-in-dialog";

export function AccountSignInCta({
  label,
  className,
}: {
  readonly label: string;
  readonly className: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
      >
        {label}
        <ArrowRight aria-hidden="true" className="size-4" />
      </button>
      <SignInDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
