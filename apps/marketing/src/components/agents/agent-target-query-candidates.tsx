"use client";

// @input  -- the page being audited, and a click asking what it already ranks for
// @output -- pickable queries this page earned impressions for, or why there are none
// @pos    -- reads through the Agent target-query route; holds no credential
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { useState } from "react";
import { useTranslations } from "next-intl";

/**
 * The read's shape, mirrored rather than imported.
 *
 * `target-query-candidates.ts` reaches Search Console through `@sf/sources`,
 * whose barrel pulls `node:net` into anything that imports it. A client
 * component that imports the type imports the module, and the marketing build
 * has already been broken twice this way -- once with the error naming an
 * unrelated file.
 */
interface Candidate {
  readonly query: string;
  readonly impressions: number;
  readonly clicks: number;
  readonly position: number;
}

type Read =
  | {
      readonly kind: "candidates";
      readonly property: string;
      readonly windowStart: string;
      readonly windowEnd: string;
      readonly candidates: readonly Candidate[];
    }
  | { readonly kind: "no_property" }
  | {
      readonly kind: "no_rows";
      readonly property: string;
      readonly windowStart: string;
      readonly windowEnd: string;
    }
  | { readonly kind: "no_grant" }
  | { readonly kind: "unavailable" };

type State =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "read"; readonly read: Read }
  | { readonly status: "failed" };

export function AgentTargetQueryCandidates({
  url,
  disabled,
  onPick,
}: {
  readonly url: string;
  readonly disabled: boolean;
  readonly onPick: (query: string) => void;
}) {
  const t = useTranslations("agents.workbench.targetQuery");
  const [state, setState] = useState<State>({ status: "idle" });

  const connectHref = `/api/auth/google/start?scope=gsc&next=${encodeURIComponent(
    typeof window === "undefined"
      ? "/"
      : `${window.location.pathname}${window.location.search}`,
  )}`;

  async function load() {
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/agents/target-query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!response.ok) {
        setState({ status: "failed" });
        return;
      }
      const body = (await response.json()) as { readonly data?: Read };
      if (body.data === undefined) {
        setState({ status: "failed" });
        return;
      }
      setState({ status: "read", read: body.data });
    } catch {
      setState({ status: "failed" });
    }
  }

  if (url.trim() === "") return null;

  return (
    <div data-target-query-candidates className="mt-2">
      {state.status === "idle" || state.status === "loading" ? (
        <button
          type="button"
          data-target-query-action="load"
          disabled={disabled || state.status === "loading"}
          onClick={() => void load()}
          className="rounded-[8px] border border-brand-border-strong px-2.5 py-1 font-mono text-[10.5px] tracking-[0.04em] text-text-dark-secondary uppercase transition-colors hover:border-brand-accent/70 hover:text-text-dark-primary disabled:opacity-60"
        >
          {state.status === "loading" ? t("loading") : t("action")}
        </button>
      ) : null}

      {state.status === "failed" ? (
        <p
          data-target-query-state="failed"
          className="!text-[11.5px] leading-[1.6] text-text-dark-secondary"
        >
          {t("failed")}
        </p>
      ) : null}

      {state.status === "read" ? (
        <div data-target-query-state={state.read.kind}>
          {state.read.kind === "candidates" ? (
            <>
              <p className="!text-[11.5px] leading-[1.6] text-text-dark-secondary">
                {t("heading", {
                  start: state.read.windowStart,
                  end: state.read.windowEnd,
                })}
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {state.read.candidates.map((candidate) => (
                  <li key={candidate.query}>
                    <button
                      type="button"
                      data-target-query-candidate={candidate.query}
                      disabled={disabled}
                      onClick={() => onPick(candidate.query)}
                      className="rounded-[8px] border border-brand-border-strong bg-brand-panel-raised px-2.5 py-1 text-left text-[11.5px] text-text-dark-primary transition-colors hover:border-brand-accent/70 disabled:opacity-60"
                    >
                      {candidate.query}
                      <span className="ml-1.5 font-mono text-[10px] text-text-dark-faint">
                        {t("metrics", {
                          impressions: candidate.impressions,
                          position: candidate.position.toFixed(1),
                        })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {/*
                Impressions are what this page was SHOWN for, which is not the
                same as what it should be about. A query it ranks 60th for is
                still a query someone typed; whether it is the one worth owning
                is the judgement the visitor is here to make.
              */}
              <p className="mt-1.5 !text-[11.5px] leading-[1.6] text-text-dark-secondary">
                {t("note")}
              </p>
            </>
          ) : null}

          {state.read.kind === "no_rows" ? (
            <p className="!text-[11.5px] leading-[1.6] text-text-dark-secondary">
              {t("noRows", {
                start: state.read.windowStart,
                end: state.read.windowEnd,
              })}
            </p>
          ) : null}

          {state.read.kind === "no_property" ? (
            <p className="!text-[11.5px] leading-[1.6] text-text-dark-secondary">
              {t("noProperty")}
            </p>
          ) : null}

          {state.read.kind === "unavailable" ? (
            <p className="!text-[11.5px] leading-[1.6] text-text-dark-secondary">
              {t("unavailable")}
            </p>
          ) : null}

          {state.read.kind === "no_grant" ? (
            <p className="!text-[11.5px] leading-[1.6] text-text-dark-secondary">
              {t("noGrant")}{" "}
              <a
                href={connectHref}
                data-target-query-action="connect"
                className="text-brand-accent-text underline underline-offset-2"
              >
                {t("connect")}
              </a>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
