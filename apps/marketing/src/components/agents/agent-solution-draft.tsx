// @input  -- one draftable solution kind and the inspected page's own static text
// @output -- a preview draft the reader can copy, or a stated reason there is none
// @pos    -- Stage 04 only; asks on demand, applies nothing, stores nothing
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useState } from "react";
import { PenLine } from "lucide-react";
import { useTranslations } from "next-intl";
import type { SeoAuditTargetPageExtract } from "@sf/public-tools";
import type {
  SolutionDraft,
  SolutionDraftKind,
} from "@sf/public-tools/seo-audit/solution-draft";

import type { AgentSolutionKind } from "./agent-solution-templates";

/**
 * Which solution shapes a model can usefully draft.
 *
 * Deliberately short. A redirect rule, a canonical target or a server fix is
 * decided by facts this run already measured, and asking a model to write one
 * would dress a guess as an answer. What it can do is write the sentences a
 * page has to say in its own words — which is exactly the part Stage 04 used to
 * hand back as an empty form.
 */
const DRAFTABLE: Partial<Record<AgentSolutionKind, SolutionDraftKind>> = {
  "search-presentation": "search-presentation",
  "heading-structure": "heading-structure",
};

export function draftKindFor(
  kind: AgentSolutionKind,
): SolutionDraftKind | null {
  return DRAFTABLE[kind] ?? null;
}

type DraftState =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | { readonly status: "ready"; readonly draft: SolutionDraft }
  | { readonly status: "failed"; readonly code: string };

export interface AgentSolutionDraftProps {
  readonly kind: SolutionDraftKind;
  readonly targetUrl: string;
  readonly extract: SeoAuditTargetPageExtract | null;
  readonly targetQuery: string;
  readonly pageType: string;
}

export function AgentSolutionDraft({
  kind,
  targetUrl,
  extract,
  targetQuery,
  pageType,
}: AgentSolutionDraftProps) {
  const t = useTranslations("agents.workbench.recommendations.draft");
  const [state, setState] = useState<DraftState>({ status: "idle" });

  // Without the page's own text a draft has nothing true to build on, so the
  // offer is withheld rather than made and then refused.
  if (extract === null) return null;

  async function run() {
    setState({ status: "running" });
    try {
      const response = await fetch("/api/agents/seo/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          url: targetUrl,
          title: extract?.title ?? null,
          metaDescription: extract?.metaDescription ?? null,
          headings: [...(extract?.h1 ?? []), ...(extract?.subHeadings ?? [])],
          openingText: extract?.openingText ?? null,
          targetQuery,
          pageType,
        }),
      });
      const body = (await response.json()) as {
        data?: { draft?: SolutionDraft };
        error?: { code?: string };
      };
      if (!response.ok || !body.data?.draft) {
        setState({ status: "failed", code: body.error?.code ?? "draft_unusable" });
        return;
      }
      setState({ status: "ready", draft: body.data.draft });
    } catch {
      setState({ status: "failed", code: "draft_unusable" });
    }
  }

  return (
    <div
      data-testid="solution-draft"
      className="mt-3 rounded-row border border-brand-border-dashed bg-brand-panel-sunken p-4"
    >
      {state.status === "ready" ? (
        <DraftBody draft={state.draft} />
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={run}
            disabled={state.status === "running"}
            className="inline-flex items-center gap-2 rounded-[8px] border border-brand-accent/30 bg-brand-accent/[0.08] px-3 py-2 text-[12.5px] font-semibold text-brand-accent-text transition-colors hover:border-brand-accent/50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent"
          >
            <PenLine aria-hidden="true" className="size-3.5" />
            {state.status === "running" ? t("running") : t("action")}
          </button>
          <p className="text-[12px] leading-[1.55] text-text-dark-secondary">
            {state.status === "failed" ? t(`errors.${state.code}`) : t("offer")}
          </p>
        </div>
      )}
    </div>
  );
}

function DraftBody({ draft }: { readonly draft: SolutionDraft }) {
  const t = useTranslations("agents.workbench.recommendations.draft");
  const rows =
    draft.kind === "search-presentation"
      ? ([
          [t("fields.title"), draft.title],
          [t("fields.metaDescription"), draft.metaDescription],
          [t("fields.openingLine"), draft.openingLine],
        ] as const)
      : ([
          [t("fields.h1"), draft.h1],
          [t("fields.h2"), draft.h2.map((entry) => `- ${entry}`).join("\n")],
        ] as const);

  return (
    <div>
      <p className="font-mono text-[10.5px] tracking-[0.09em] text-brand-accent-text uppercase">
        {t("readyLabel")}
      </p>
      <dl className="mt-3 grid gap-3">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="font-mono text-[10.5px] tracking-[0.08em] text-text-dark-secondary uppercase">
              {label}
            </dt>
            <dd className="mt-1 break-words whitespace-pre-wrap text-[12.5px] leading-[1.6] text-text-dark-primary">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[12px] leading-[1.55] text-text-dark-secondary">
        {t("boundary")}
      </p>
    </div>
  );
}
