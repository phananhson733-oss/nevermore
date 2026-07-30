// @input  — next-intl, ui/dialog, waitlist-form
// @output — WaitlistModal 组件（Dialog 弹窗包装 WaitlistForm）
// @pos    — 全局弹窗组件，由 Header/CTA 按钮触发，SPEC 2.4.2
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { WaitlistForm } from "./waitlist-form";

interface WaitlistModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WaitlistModal({ open, onOpenChange }: WaitlistModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-brand-bg-alt border-brand-border sm:max-w-md">
        <DialogTitle className="sr-only">Subscribe</DialogTitle>
        <WaitlistForm onSuccess={() => {}} />
      </DialogContent>
    </Dialog>
  );
}
