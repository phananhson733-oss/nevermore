"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { SeoAuditRecord } from "@sf/public-tools";
import type { AgentAuditEvaluatedCheck } from "@sf/public-tools/agent-audit";

import type { AgentProfileDraft } from "./agent-profile";
import type { AgentSolutionTemplate } from "./agent-solution-templates";
import {
  buildSeoAiActionCopy,
  type SeoAiActionCopyContent,
} from "../../lib/agents/seo-ai-action-copy";

const BUTTON_CLASS =
  "inline-flex h-10 items-center justify-center rounded-[10px] border border-brand-border-strong bg-brand-panel-raised px-4 text-[12px] leading-[1.4] font-medium text-text-dark-primary transition-colors hover:border-brand-accent/40 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";

export interface AgentAiActionCopyProps {
  readonly locale: "en" | "zh";
  readonly selectedCheck: AgentAuditEvaluatedCheck;
  readonly evidenceRecords: readonly SeoAuditRecord[];
  readonly targetUrl: string;
  readonly profile: AgentProfileDraft;
  readonly solution: AgentSolutionTemplate;
  readonly content: SeoAiActionCopyContent;
  readonly className?: string;
}

type CopyTarget = "chatbot" | "code_agent";
type CopyState = "idle" | "done" | "failed";

export function AgentAiActionCopy({
  locale,
  selectedCheck,
  evidenceRecords,
  targetUrl,
  profile,
  solution,
  content,
  className = "",
}: AgentAiActionCopyProps) {
  const t = useTranslations("agents.workbench.recommendations");
  const [copied, setCopied] = useState<CopyTarget | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [fallback, setFallback] = useState<string | null>(null);

  const chatbot = useMemo(
    () =>
      buildSeoAiActionCopy({
        audience: "chatbot",
        locale,
        selectedCheck,
        evidenceRecords,
        targetUrl,
        profile,
        solution,
        content,
      }),
    [content, evidenceRecords, locale, profile, selectedCheck, solution, targetUrl],
  );
  const codeAgent = useMemo(
    () =>
      buildSeoAiActionCopy({
        audience: "code_agent",
        locale,
        selectedCheck,
        evidenceRecords,
        targetUrl,
        profile,
        solution,
        content,
      }),
    [content, evidenceRecords, locale, profile, selectedCheck, solution, targetUrl],
  );
  const investigationOnly =
    chatbot.ok &&
    !codeAgent.ok &&
    codeAgent.reason === "evidence_unavailable";
  const copyUnavailable = !chatbot.ok && !codeAgent.ok;

  const copy = useCallback(async (target: CopyTarget) => {
    const built = target === "chatbot" ? chatbot : codeAgent;
    if (!built.ok) return;
    try {
      await navigator.clipboard.writeText(built.markdown);
      setCopied(target);
      setCopyState("done");
      setFallback(null);
    } catch {
      setCopied(target);
      setCopyState("failed");
      setFallback(built.markdown);
    }
  }, [chatbot, codeAgent]);

  return (
    <section
      data-testid="agent-ai-action-copy"
      className={`rounded-row border border-brand-border bg-brand-panel-sunken p-4 ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-[14px] leading-[1.4] font-semibold text-text-dark-primary">
            {t("copyTaskTitle")}
          </h4>
          <p className="mt-1 text-[13px] leading-[1.65] text-text-dark-secondary">
            {t("copyTaskIntro")}
          </p>
        </div>
        {investigationOnly ? (
          <span
            data-testid="agent-ai-copy-investigation-badge"
            className="rounded border border-brand-warning/30 bg-brand-warning/10 px-2.5 py-1 text-[11px] font-medium text-brand-warning"
          >
            {t("copyTaskInvestigationOnly")}
          </span>
        ) : copyUnavailable ? (
          <span className="rounded border border-brand-border-card bg-brand-panel px-2.5 py-1 text-[11px] font-medium text-text-dark-secondary">
            {t("copyTaskUnavailable")}
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3">
        <details className="min-w-0">
          <summary className="cursor-pointer text-[12px] leading-[1.5] text-text-dark-secondary">
            {t("copyTaskPreviewChatbot")}
          </summary>
          <pre
            data-testid="agent-ai-copy-preview-chatbot"
            className="mt-2 max-h-72 overflow-auto rounded-row border border-brand-border-card bg-brand-panel p-3 font-mono text-[12px] leading-[1.65] text-text-dark-secondary whitespace-pre-wrap"
          >
            {chatbot.ok ? chatbot.markdown : t(`copyTaskRefusal.${chatbot.reason}`)}
          </pre>
        </details>

        <details className="min-w-0">
          <summary className="cursor-pointer text-[12px] leading-[1.5] text-text-dark-secondary">
            {t("copyTaskPreviewCodeAgent")}
          </summary>
          <pre
            data-testid="agent-ai-copy-preview-code-agent"
            className="mt-2 max-h-72 overflow-auto rounded-row border border-brand-border-card bg-brand-panel p-3 font-mono text-[12px] leading-[1.65] text-text-dark-secondary whitespace-pre-wrap"
          >
            {codeAgent.ok
              ? codeAgent.markdown
              : t(
                  codeAgent.reason === "evidence_unavailable"
                    ? "copyTaskCodeAgentUnavailable"
                    : `copyTaskRefusal.${codeAgent.reason}`,
                )}
          </pre>
        </details>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={BUTTON_CLASS}
          onClick={() => {
            void copy("chatbot");
          }}
          disabled={!chatbot.ok}
        >
          {t("copyTaskChatbot")}
        </button>
        <button
          type="button"
          className={BUTTON_CLASS}
          onClick={() => {
            void copy("code_agent");
          }}
          disabled={!codeAgent.ok}
        >
          {t("copyTaskCodeAgent")}
        </button>
        <p
          role="status"
          aria-live="polite"
          className={`text-[11.5px] ${
            copyState === "failed" ? "text-brand-warning" : "text-brand-accent-text"
          }`}
        >
          {copyState === "done" && copied !== null
            ? t("copyTaskCopied", {
                target:
                  copied === "chatbot"
                    ? t("copyTaskChatbotShort")
                    : t("copyTaskCodeAgentShort"),
              })
            : null}
          {copyState === "failed" ? t("copyTaskFailed") : null}
        </p>
      </div>

      {!codeAgent.ok && codeAgent.reason === "evidence_unavailable" ? (
        <p className="mt-3 text-[12px] leading-[1.6] text-brand-warning">
          {t("copyTaskCodeAgentUnavailable")}
        </p>
      ) : null}

      {fallback !== null ? (
        <textarea
          data-testid="agent-ai-copy-fallback"
          readOnly
          aria-label={t("copyTaskFallbackAria")}
          className="mt-3 h-48 w-full rounded-row border border-brand-border-card bg-brand-panel p-3 font-mono text-[12px] leading-[1.65] text-text-dark-secondary"
          value={fallback}
        />
      ) : null}
    </section>
  );
}
