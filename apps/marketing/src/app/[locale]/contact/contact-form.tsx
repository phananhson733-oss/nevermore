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
      className="text-center py-12"
      role="status"
      aria-live="polite"
    >
      <CheckCircle
        className="size-12 text-brand-success mx-auto mb-4"
        aria-hidden="true"
      />
      <h2 className="text-text-dark-primary font-semibold text-xl mb-2">
        {t("form.successTitle")}
      </h2>
      <p className="text-text-dark-secondary">{t("form.successDesc")}</p>
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
      className="space-y-6"
      noValidate
    >
      {/* Name (required) */}
      <div>
        <Label
          htmlFor="contact-name"
          className="text-text-dark-secondary text-sm"
        >
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
          className="mt-1 bg-brand-bg-alt border-brand-border text-text-dark-primary"
        />
      </div>

      {/* Email (required) */}
      <div>
        <Label
          htmlFor="contact-email"
          className="text-text-dark-secondary text-sm"
        >
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
          className="mt-1 bg-brand-bg-alt border-brand-border text-text-dark-primary"
        />
      </div>

      {/* Message (required, min 10 chars) */}
      <div>
        <Label
          htmlFor="contact-message"
          className="text-text-dark-secondary text-sm"
        >
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
          className="mt-1 bg-brand-bg-alt border-brand-border text-text-dark-primary min-h-32"
        />
      </div>

      {/* Error */}
      <div aria-live="polite">
        {errorMsg && (
          <p
            id="contact-form-error"
            role="alert"
            className="text-brand-error text-sm"
          >
            {errorMsg}
          </p>
        )}
      </div>

      {/* Submit */}
      <Button
        type="submit"
        disabled={status === "loading"}
        aria-busy={status === "loading"}
        className="w-full bg-brand-accent hover:brightness-110 text-white rounded-lg text-sm"
      >
        {status === "loading" ? t("form.submitting") : t("form.submit")}
      </Button>
    </motion.form>
  );
}
