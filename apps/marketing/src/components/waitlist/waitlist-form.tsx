// @input  — next-intl, ui/button, ui/input, ui/label, waitlist-profile-step, /api/waitlist；可选 source 归因
// @output — WaitlistForm 组件（邮箱提交 + 渐进补充资料）
// @pos    — Waitlist 核心表单，支持两步流程，SPEC 2.4.2
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle } from "lucide-react";
import { WaitlistProfileStep } from "./waitlist-profile-step";

type Step = "email" | "profile" | "done";

interface WaitlistFormProps {
  onSuccess?: () => void;
  /** Recorded with the signup so the list can be segmented by entry point. */
  source?: string;
}

export function WaitlistForm({
  onSuccess,
  source = "website",
}: WaitlistFormProps) {
  const t = useTranslations("waitlist");
  const locale = useLocale();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [subscriberId, setSubscriberId] = useState<string | null>(null);

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
          source,
          landing_page: window.location.pathname,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        setError(t("genericError"));
        return;
      }

      const id = json.data?.id || null;
      setSubscriberId(id);
      if (id) {
        setStep("profile");
      } else {
        setStep("done");
        onSuccess?.();
      }
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
      onSuccess?.();
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
    onSuccess?.();
  };

  const handleSkip = () => {
    setStep("done");
    onSuccess?.();
  };

  if (step === "done") {
    return (
      <div className="py-8 text-center" role="status" aria-live="polite">
        <span className="mx-auto mb-4 flex size-11 items-center justify-center rounded-[10px] border border-brand-accent/25 bg-brand-accent-soft text-brand-accent">
          <CheckCircle className="size-[18px]" aria-hidden="true" />
        </span>
        <h3 className="mb-2 text-[16.5px] font-semibold text-text-dark-primary">
          {t("successTitle")}
        </h3>
        <p className="text-[13px] leading-[1.6] text-text-dark-secondary">
          {t("successDesc")}
        </p>
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

  return (
    <form onSubmit={handleEmailSubmit} className="space-y-5 py-2">
      <div>
        <Label
          htmlFor="waitlist-email"
          className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase"
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
          className="mt-2"
        />
      </div>

      <div aria-live="polite">
        {error && (
          <p
            id="waitlist-email-error"
            role="alert"
            className="text-[12.5px] leading-[1.6] text-brand-error"
          >
            {error}
          </p>
        )}
      </div>

      <Button
        type="submit"
        variant="cta"
        size="lg"
        disabled={loading}
        aria-busy={loading}
        className="w-full"
      >
        {loading ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
