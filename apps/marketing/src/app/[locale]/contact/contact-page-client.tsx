// @input  — next-intl, framer-motion, contact-form
// @output — Contact 联系页面客户端渲染（Hero + 表单 + 联系信息）
// @pos    — Contact 页 client wrapper，由 page.tsx server component 引用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/animations";
import { Mail } from "lucide-react";
import {
  type FormStatus,
  SuccessMessage,
  ContactForm,
} from "./contact-form";

export default function ContactPageClient() {
  const t = useTranslations("contact");
  const locale = useLocale();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<FormStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.SubmitEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setStatus("loading");

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message, locale }),
      });

      if (!res.ok) {
        const json = await res.json();
        setErrorMsg(json.error?.message || t("form.genericError"));
        setStatus("error");
        return;
      }

      setStatus("success");
    } catch {
      setErrorMsg(t("form.genericError"));
      setStatus("error");
    }
  };

  return (
    <>
      {/* Hero */}
      <section className="bg-brand-bg py-16 md:py-24">
        <div className="max-w-content mx-auto px-4 text-center">
          <motion.h1
            {...fadeInUp}
            className="text-text-dark-primary font-semibold mb-4"
          >
            {t("hero.title")}
          </motion.h1>
          <motion.p
            {...fadeInUp}
            transition={{ ...fadeInUp.transition, delay: 0.15 }}
            className="text-text-dark-secondary text-lg max-w-2xl mx-auto"
          >
            {t("hero.subtitle")}
          </motion.p>
        </div>
      </section>

      {/* Form + Info */}
      <section className="bg-brand-bg py-16">
        <div className="max-w-content mx-auto px-4">
          <div className="max-w-2xl mx-auto">
            {status === "success" ? (
              <SuccessMessage t={t} />
            ) : (
              <ContactForm
                t={t}
                name={name}
                email={email}
                message={message}
                status={status}
                errorMsg={errorMsg}
                onNameChange={setName}
                onEmailChange={setEmail}
                onMessageChange={setMessage}
                onSubmit={handleSubmit}
              />
            )}

            {/* Contact Info */}
            <motion.div
              {...fadeInUp}
              transition={{ ...fadeInUp.transition, delay: 0.3 }}
              className="mt-12 text-center"
            >
              <div className="flex items-center justify-center gap-2 text-text-dark-secondary">
                <Mail className="size-5" aria-hidden="true" />
                <a
                  href="mailto:hello@gengrowth.com"
                  className="text-brand-accent-text hover:brightness-110 transition-all"
                >
                  hello@gengrowth.com
                </a>
              </div>
            </motion.div>
          </div>
        </div>
      </section>
    </>
  );
}
