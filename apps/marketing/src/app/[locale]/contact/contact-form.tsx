// @input  — next-intl, framer-motion, ui/input, ui/label, ui/textarea, ui/button, lucide-react
// @output — ContactForm + SuccessMessage sub-components for the contact page
// @pos    — Contact 表单子组件，由 contact-page-client.tsx 引用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { type useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/animations";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { CheckCircle } from "lucide-react";

export type FormStatus = "idle" | "loading" | "success" | "error";

// 字段标签走 mono 小标签；输入框走规范里的输入框配方（h-12.5 + 强描边 + 页面底色）
const FIELD_LABEL =
  "text-text-dark-secondary mb-2 block font-mono text-[10px] tracking-[0.12em] uppercase";

const FIELD_BOX =
  "border-brand-border-strong bg-brand-bg text-text-dark-primary placeholder:text-text-dark-secondary focus-visible:border-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent h-12.5 rounded-[10px] px-4 shadow-none transition-colors";

// ---------------------------------------------------------------------------
// SuccessMessage
// ---------------------------------------------------------------------------

export function SuccessMessage({
  t,
}: {
  t: ReturnType<typeof useTranslations<"contact">>;
}) {
  return (
    <motion.div
      {...fadeInUp}
      className="py-12 text-center"
      role="status"
      aria-live="polite"
    >
      <CheckCircle
        className="text-brand-success mx-auto mb-4 size-10"
        aria-hidden="true"
      />
      <h2 className="text-text-dark-primary mb-2 text-[21px] tracking-[-0.02em]">
        {t("form.successTitle")}
      </h2>
      <p className="text-text-dark-secondary text-[15px] leading-[1.65]">
        {t("form.successDesc")}
      </p>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// ContactForm
// ---------------------------------------------------------------------------

export interface ContactFormProps {
  t: ReturnType<typeof useTranslations<"contact">>;
  name: string;
  email: string;
  message: string;
  status: FormStatus;
  errorMsg: string;
  onNameChange: (v: string) => void;
  onEmailChange: (v: string) => void;
  onMessageChange: (v: string) => void;
  onSubmit: (e: React.SubmitEvent) => void;
}

export function ContactForm({
  t,
  name,
  email,
  message,
  status,
  errorMsg,
  onNameChange,
  onEmailChange,
  onMessageChange,
  onSubmit,
}: ContactFormProps) {
  return (
    <motion.form
      {...fadeInUp}
      transition={{ ...fadeInUp.transition, delay: 0.2 }}
      onSubmit={onSubmit}
      className="space-y-5"
      noValidate
    >
      {/* Name (required) */}
      <div>
        <Label htmlFor="contact-name" className={FIELD_LABEL}>
          {t("form.nameLabel")} *
        </Label>
        <Input
          id="contact-name"
          required
          aria-required="true"
          autoComplete="name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t("form.namePlaceholder")}
          className={`${FIELD_BOX} font-mono text-[14px]`}
        />
      </div>

      {/* Email (required) */}
      <div>
        <Label htmlFor="contact-email" className={FIELD_LABEL}>
          {t("form.emailLabel")} *
        </Label>
        <Input
          id="contact-email"
          type="email"
          required
          aria-required="true"
          autoComplete="email"
          aria-describedby={errorMsg ? "contact-form-error" : undefined}
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          placeholder={t("form.emailPlaceholder")}
          className={`${FIELD_BOX} font-mono text-[14px]`}
        />
      </div>

      {/* Message (required, min 10 chars) —— 成段正文不用 mono */}
      <div>
        <Label htmlFor="contact-message" className={FIELD_LABEL}>
          {t("form.messageLabel")} *
        </Label>
        <Textarea
          id="contact-message"
          required
          aria-required="true"
          minLength={10}
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          placeholder={t("form.messagePlaceholder")}
          className={`${FIELD_BOX} h-auto min-h-36 py-3 text-[14px] leading-[1.65]`}
        />
      </div>

      {/* Error */}
      <div aria-live="polite">
        {errorMsg && (
          <p
            id="contact-form-error"
            role="alert"
            className="border-brand-error/25 bg-brand-error/[0.08] text-brand-error rounded-[10px] border px-4 py-3 text-[13px]"
          >
            {errorMsg}
          </p>
        )}
      </div>

      {/* Submit — GLOW_02，本屏唯一的渐变主 CTA */}
      <Button
        type="submit"
        disabled={status === "loading"}
        aria-busy={status === "loading"}
        className="bg-brand-gradient text-brand-on-accent shadow-cta hover:shadow-cta-hover focus-visible:outline-brand-accent h-12 w-full rounded-[10px] text-[14.5px] font-semibold transition-shadow focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-70 disabled:shadow-none"
      >
        {status === "loading" ? t("form.submitting") : t("form.submit")}
      </Button>
    </motion.form>
  );
}
