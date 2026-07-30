// @input  — next-intl, ui/button, ui/input, ui/label, waitlist-profile-step, Supabase API
// @output — WaitlistForm 组件（邮箱提交 + 渐进补充资料）
// @pos    — Waitlist 核心表单，支持两步流程，SPEC 2.4.2
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle } from "lucide-react";
import { WaitlistProfileStep } from "./waitlist-profile-step";

type Step = "email" | "profile" | "done";

interface WaitlistFormProps {
  onSuccess: () => void;
}

export function WaitlistForm({ onSuccess }: WaitlistFormProps) {
  const t = useTranslations("waitlist");
  const locale = useLocale();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [subscriberId, setSubscriberId] = useState<string | null>(null);

  // Profile fields
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");

  const handleEmailSubmit = async (e: React.SubmitEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          locale,
          source: "website",
          landing_page: window.location.pathname,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        if (json.error?.code === "DUPLICATE_EMAIL") {
          setError(t("duplicateError"));
        } else {
          setError(t("genericError"));
        }
        return;
      }

      setSubscriberId(json.data?.id || null);
      setStep("profile");
    } catch {
      setError(t("genericError"));
    } finally {
      setLoading(false);
    }
  };

  const handleProfileSubmit = async (e: React.SubmitEvent) => {
    e.preventDefault();
    if (!subscriberId) {
      setStep("done");
      onSuccess();
      return;
    }

    try {
      await fetch("/api/waitlist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscriber_id: subscriberId,
          name: name || undefined,
          company: company || undefined,
          role: role || undefined,
        }),
      });
    } catch {
      // Profile save failure is non-blocking
    }

    setStep("done");
    onSuccess();
  };

  const handleSkip = () => {
    setStep("done");
    onSuccess();
  };

  if (step === "done") {
    return (
      <div className="text-center py-6" role="status" aria-live="polite">
        <CheckCircle
          className="size-12 text-brand-success mx-auto mb-4"
          aria-hidden="true"
        />
        <h3 className="text-text-dark-primary font-semibold text-lg mb-2">
          {t("successTitle")}
        </h3>
        <p className="text-text-dark-secondary text-sm">{t("successDesc")}</p>
      </div>
    );
  }

  if (step === "profile") {
    return (
      <WaitlistProfileStep
        t={t}
        name={name}
        company={company}
        role={role}
        onNameChange={setName}
        onCompanyChange={setCompany}
        onRoleChange={setRole}
        onSubmit={handleProfileSubmit}
        onSkip={handleSkip}
      />
    );
  }

  // Step: email
  return (
    <form onSubmit={handleEmailSubmit} className="py-2 space-y-4">
      <div>
        <Label
          htmlFor="waitlist-email"
          className="text-text-dark-secondary text-sm"
        >
          {t("emailLabel")}
        </Label>
        <Input
          id="waitlist-email"
          type="email"
          required
          aria-required="true"
          aria-describedby={error ? "waitlist-email-error" : undefined}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("emailPlaceholder")}
          className="mt-1 bg-brand-bg border-brand-border text-text-dark-primary"
        />
      </div>

      <div aria-live="polite">
        {error && (
          <p
            id="waitlist-email-error"
            role="alert"
            className="text-brand-error text-sm"
          >
            {error}
          </p>
        )}
      </div>

      <Button
        type="submit"
        disabled={loading}
        aria-busy={loading}
        className="w-full bg-brand-accent hover:bg-brand-accent-hover text-white text-sm"
      >
        {loading ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
