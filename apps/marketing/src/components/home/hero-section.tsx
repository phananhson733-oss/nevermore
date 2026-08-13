// @input  — next-intl、next/navigation、Agent intent helper、localePath
// @output — HeroSection（URL + SEO/Tech Profile 准备入口，不自动运行审计）
// @pos    — 首页区块 1，深色背景，SPEC 2.5.2 / Signal Console 设计规范
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import {
  getSessionIntentStorage,
  storePendingAgentIntent,
} from "../agents/agent-intent";
import {
  AGENT_PATH,
  type AgentKind,
} from "../agents/agent-types";
import { localePath } from "../../lib/locale-path";

export function HeroSection() {
  const t = useTranslations("home.hero");
  const locale = useLocale();
  const router = useRouter();
  const [targetUrl, setTargetUrl] = useState("");

  function handleDestination(agent: AgentKind) {
    const url = targetUrl.trim();
    if (!url) return;

    const storage = getSessionIntentStorage();
    if (storage) {
      storePendingAgentIntent(storage, agent, url, "prepare_profile");
    }
    router.push(localePath(locale, AGENT_PATH[agent]));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    handleDestination(submitter?.value === "tech" ? "tech" : "seo");
  }

  return (
    <section className="relative overflow-hidden bg-brand-bg">
      {/* GLOW_01 — 48px 网格线 + 双色氛围光，全站仅首屏与页级 hero 出现 */}
      <div
        aria-hidden="true"
        className="bg-signal-grid absolute inset-0 opacity-45"
      />
      <div
        aria-hidden="true"
        className="absolute -top-55 left-[12%] h-115 w-160 rounded-full bg-[radial-gradient(ellipse,rgba(61,220,151,0.16),transparent_65%)] blur-[12px]"
      />
      <div
        aria-hidden="true"
        className="absolute -top-40 right-[6%] h-105 w-140 rounded-full bg-[radial-gradient(ellipse,rgba(76,195,250,0.12),transparent_65%)] blur-[12px]"
      />

      <div className="max-w-content relative mx-auto px-6 pt-21 text-center md:px-8">
        <p className="animate-hero-fade-in-up inline-flex items-center gap-2.5 rounded-md border border-brand-accent/25 bg-brand-accent/[0.06] px-3.5 py-[7px] font-mono text-[11.5px] tracking-[0.14em] text-brand-accent-text uppercase shadow-[0_0_24px_rgba(61,220,151,0.12)]">
          <span
            aria-hidden="true"
            className="animate-subtle-pulse size-1.5 rounded-full bg-brand-accent shadow-[0_0_8px_rgba(61,220,151,0.9)]"
          />
          {t("eyebrow")}
        </p>

        <h1 className="animate-hero-fade-in-up mx-auto mt-7 max-w-[880px] text-text-dark-primary">
          {t.rich("title", {
            hl: (chunks) => (
              <span className="text-brand-gradient">{chunks}</span>
            ),
          })}
        </h1>

        <p
          className="animate-hero-fade-in-up mx-auto mt-5.5 max-w-[640px] text-[17.5px] leading-[1.65] text-text-dark-secondary"
          style={{ animationDelay: "0.15s" }}
        >
          {t("subtitle")}
        </p>

        <form
          onSubmit={handleSubmit}
          className="animate-hero-fade-in-up mx-auto mt-8.5 max-w-[720px]"
          style={{ animationDelay: "0.3s" }}
        >
          <label htmlFor="homepage-agent-url" className="sr-only">
            {t("urlLabel")}
          </label>
          <input
            id="homepage-agent-url"
            type="text"
            inputMode="url"
            autoComplete="url"
            maxLength={2_048}
            required
            value={targetUrl}
            onChange={(event) => setTargetUrl(event.target.value)}
            placeholder={t("urlPlaceholder")}
            className="h-13 w-full rounded-[10px] border border-brand-border-strong bg-brand-panel-raised px-4 text-[15px] text-text-dark-primary shadow-panel outline-none transition-colors placeholder:text-text-dark-faint focus:border-brand-accent/60 focus:ring-2 focus:ring-brand-accent/20"
          />
          <div className="mt-3.5 flex flex-col items-stretch justify-center gap-3 sm:flex-row">
            {/* GLOW_02 — 一屏最多一个渐变主 CTA，次按钮靠描边分层，不带投影 */}
            <button
              type="submit"
              name="agent"
              value="seo"
              disabled={!targetUrl.trim()}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-[10px] bg-brand-gradient px-[26px] text-[14.5px] font-semibold text-brand-on-accent shadow-cta transition-shadow hover:shadow-cta-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("primaryCta")}
              <ArrowRight aria-hidden="true" className="size-[15px]" />
            </button>
            <button
              type="submit"
              name="agent"
              value="tech"
              disabled={!targetUrl.trim()}
              className="inline-flex h-12 items-center justify-center rounded-[10px] border border-brand-border-strong bg-brand-panel/60 px-6 text-[14.5px] font-medium text-text-dark-primary transition-colors hover:border-brand-accent/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("secondaryCta")}
            </button>
          </div>
        </form>

        {/*
         * 这是一句完整的正文，不是标签——mono + uppercase + faint 那一档留给
         * 编号和 chip。11px 的 faint 在页面底上只有 3.5:1，读不动。
         */}
        <p
          className="animate-hero-fade-in-up mt-5 pb-22 text-[13px] leading-[1.6] text-text-dark-secondary"
          style={{ animationDelay: "0.45s" }}
        >
          {t("socialProof")}
        </p>
      </div>
    </section>
  );
}
