// @input  -- next-intl, ui/dialog, trial-wizard
// @output -- TrialModal component (Dialog wrapping TrialWizard)
// @pos    -- Global modal, triggered by CTA buttons, SPEC 2.4.2
// Once this file is updated, update header comment and folder _DIR.md
"use client";

import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { TrialWizard } from "./trial-wizard";

interface TrialModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TrialModal({ open, onOpenChange }: TrialModalProps) {
  const t = useTranslations("trial");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-brand-border-card bg-brand-panel sm:max-w-lg">
        <DialogTitle className="text-[16.5px] leading-snug font-semibold text-text-dark-primary">
          {t("modalTitle")}
        </DialogTitle>
        <DialogDescription className="text-[13px] leading-[1.6] text-text-dark-secondary">
          {t("modalDesc")}
        </DialogDescription>
        <TrialWizard />
      </DialogContent>
    </Dialog>
  );
}
