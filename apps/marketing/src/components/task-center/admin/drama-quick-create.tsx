// @input  -- a title, a platform and maybe a language typed on /admin/tasks; POST /api/admin/tasks/dramas/lookup and /import
// @output -- 查剧: one exact match is listed straight away, several are offered to pick from, none (or a platform 选剧台 does not know) opens the full form
// @pos    -- the new-drama panel on /admin/tasks; the full DramaForm stays as the manual way
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { LOOKUP_LANGUAGES, LOOKUP_PLATFORMS } from "../../../lib/task-center/contracts.ts";
import { languageName, PLATFORM_LABELS, platformLabel } from "../../../lib/task-center/copy.ts";
import { adminFetch, describeError } from "./admin-fetch.ts";
import { DramaForm } from "./drama-form.tsx";

const OTHER = "other";

interface Candidate {
  readonly platformDramaId: string;
  readonly title: string;
  readonly titleCn: string | null;
  readonly exact: boolean;
  readonly language: string | null;
  readonly episodes: number | null;
  readonly payStart: number | null;
  readonly finished: boolean;
  readonly synopsis: string | null;
  readonly tags: readonly string[];
  readonly hasCover: boolean;
  readonly listedDramaId: string | null;
}

interface Query {
  readonly title: string;
  readonly platform: string;
  readonly language: string | null;
}

type Step =
  | { readonly kind: "idle" }
  | { readonly kind: "searching" }
  | { readonly kind: "importing"; readonly title: string }
  | { readonly kind: "pick"; readonly query: Query; readonly candidates: readonly Candidate[] }
  | { readonly kind: "manual"; readonly query: Query; readonly why: string | null };

const FIELD =
  "mt-1 h-10 w-full rounded-[8px] border border-brand-border-strong bg-brand-bg px-3 text-[14px] text-text-dark-primary";
const BUTTON =
  "h-10 rounded-[10px] bg-primary px-5 text-[14px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50";
const LINK_BUTTON = "text-[13.5px] text-brand-accent-text hover:underline";

function isCandidate(value: unknown): value is Candidate {
  const row = value as Partial<Candidate> | null;
  return typeof row?.platformDramaId === "string" && typeof row.title === "string" && Array.isArray(row.tags);
}

export function DramaQuickCreate({ adminBase }: { adminBase: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string>(LOOKUP_PLATFORMS[0]);
  const [lastQuery, setLastQuery] = useState<Query>({ title: "", platform: "", language: null });
  const busy = step.kind === "searching" || step.kind === "importing";

  function readQuery(form: HTMLFormElement): Query {
    const data = new FormData(form);
    const language = String(data.get("language") ?? "");
    return {
      title: String(data.get("title") ?? "").trim().replace(/\s+/g, " "),
      platform: String(data.get("platform") ?? ""),
      language: language === "" ? null : language,
    };
  }

  async function search(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const query = readQuery(event.currentTarget);
    setError(null);
    setLastQuery(query);
    if (query.platform === OTHER) {
      setStep({ kind: "manual", query: { ...query, platform: "" }, why: "选剧台不认识这个平台，请手填。" });
      return;
    }
    setStep({ kind: "searching" });
    const answer = await adminFetch("/api/admin/tasks/dramas/lookup", "POST", query);
    if (!answer.ok) {
      setStep({ kind: "idle" });
      setError(lookupError(answer));
      return;
    }
    if (answer.data?.configured === false) {
      setStep({ kind: "manual", query, why: "选剧台查剧还没接上，这次请手填。" });
      return;
    }
    const candidates = Array.isArray(answer.data?.dramas) ? answer.data.dramas.filter(isCandidate) : [];
    if (candidates.length === 0) {
      setStep({ kind: "manual", query, why: `选剧台在 ${platformLabel(query.platform)} 没查到「${query.title}」，请手填。` });
      return;
    }
    const exact = candidates.filter((candidate) => candidate.exact);
    const only = exact.length === 1 ? exact[0] : undefined;
    // One drama with exactly this name: nothing to choose, list it.
    if (only !== undefined && only.listedDramaId === null) {
      await importOne(query, only);
      return;
    }
    setStep({ kind: "pick", query, candidates });
  }

  async function importOne(query: Query, candidate: Candidate): Promise<void> {
    setError(null);
    setStep({ kind: "importing", title: candidate.title });
    const answer = await adminFetch("/api/admin/tasks/dramas/import", "POST", {
      ...query,
      platformDramaId: candidate.platformDramaId,
    });
    if (answer.ok && typeof answer.data?.id === "string") {
      const cover = typeof answer.data.cover === "string" ? answer.data.cover : "missing";
      router.push(`${adminBase}/${answer.data.id}?new=${encodeURIComponent(cover)}`);
      return;
    }
    if (answer.status === 409 && typeof answer.error?.id === "string") {
      router.push(`${adminBase}/${answer.error.id}`);
      return;
    }
    if (answer.error?.code === "language_unknown") {
      setStep({ kind: "manual", query, why: "选剧台没给出这部剧的语言，请选好语言再查，或者手填。" });
      return;
    }
    setStep({ kind: "pick", query, candidates: [candidate] });
    setError(lookupError(answer));
  }

  return (
    <div className="space-y-5">
      <form onSubmit={(event) => void search(event)} className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <label className="text-[13px] text-text-dark-secondary">
          剧名 *（填这个语言版本在平台上的名字）
          <input name="title" required maxLength={200} disabled={busy} className={FIELD} />
        </label>
        <label className="text-[13px] text-text-dark-secondary">
          平台 *
          <select
            name="platform"
            value={platform}
            onChange={(event) => setPlatform(event.target.value)}
            disabled={busy}
            className={FIELD}
          >
            {LOOKUP_PLATFORMS.map((value) => (
              <option key={value} value={value}>
                {PLATFORM_LABELS[value]}
              </option>
            ))}
            <option value={OTHER}>其他平台（手填）</option>
          </select>
        </label>
        <label className="text-[13px] text-text-dark-secondary">
          语言
          <select name="language" defaultValue="" disabled={busy || platform === OTHER} className={FIELD}>
            <option value="">按剧名自动</option>
            {LOOKUP_LANGUAGES.map((value) => (
              <option key={value} value={value}>
                {languageName(value, "zh")}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={busy} className={BUTTON}>
          {step.kind === "searching" ? "查剧中…" : step.kind === "importing" ? "上架中…" : platform === OTHER ? "手填" : "查剧"}
        </button>
      </form>

      {step.kind === "searching" && (
        <p role="status" className="text-[13.5px] text-text-dark-secondary">
          正在问选剧台，它和别的任务共用北斗账号，排队时可能要半分钟到一分钟。
        </p>
      )}
      {step.kind === "importing" && (
        <p role="status" className="text-[13.5px] text-text-dark-secondary">
          找到「{step.title}」，正在建草稿、拷封面…
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-[13.5px] text-brand-error">
          {error}{" "}
          <button type="button" className={LINK_BUTTON} onClick={() => {
              setError(null);
              setStep({ kind: "manual", query: lastQuery, why: null });
            }}>
            改成手填
          </button>
        </p>
      )}

      {step.kind === "pick" && (
        <div className="space-y-3">
          <p className="text-[13.5px] text-text-dark-secondary">
            {step.candidates.length === 1 && step.candidates[0]?.listedDramaId !== null
              ? "这部已经建过了："
              : step.candidates.filter((candidate) => candidate.exact).length > 1
                ? "有不止一部叫这个名字，选你要的那部："
                : step.candidates.some((candidate) => candidate.exact)
                  ? "选你要的那部："
                  : "没有完全同名的，下面是名字相近的："}
          </p>
          <ul className="grid gap-3 md:grid-cols-2">
            {step.candidates.map((candidate) => (
              <li
                key={candidate.platformDramaId}
                className="flex flex-col gap-2 rounded-[10px] border border-brand-border-card bg-brand-bg p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-text-dark-primary">{candidate.title}</p>
                    {candidate.titleCn !== null && (
                      <p className="text-[13px] text-text-dark-secondary">{candidate.titleCn}</p>
                    )}
                  </div>
                  {candidate.listedDramaId !== null ? (
                    <Link href={`${adminBase}/${candidate.listedDramaId}`} className={`shrink-0 ${LINK_BUTTON}`}>
                      已建过，去看 →
                    </Link>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void importOne(step.query, candidate)}
                      className="h-8 shrink-0 rounded-[8px] bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      用这部
                    </button>
                  )}
                </div>
                <p className="text-[12.5px] text-text-dark-secondary">
                  {[
                    candidate.language === null ? null : languageName(candidate.language, "zh"),
                    candidate.episodes === null ? null : `${candidate.episodes} 集`,
                    candidate.payStart === null ? null : `第 ${candidate.payStart} 集起收费`,
                    candidate.finished ? "已完结" : null,
                    candidate.hasCover ? "有封面" : "无封面",
                  ]
                    .filter((part) => part !== null)
                    .join(" · ")}
                </p>
                {candidate.tags.length > 0 && <TagList tags={candidate.tags} />}
                {candidate.synopsis !== null && (
                  <p className="line-clamp-3 text-[13px] leading-[1.55] text-text-dark-secondary">{candidate.synopsis}</p>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={LINK_BUTTON}
            onClick={() => {
              setError(null);
              setStep({ kind: "manual", query: step.query, why: null });
            }}
          >
            都不是，手填 →
          </button>
        </div>
      )}

      {step.kind === "manual" && (
        <div className="space-y-4 border-t border-brand-border-card pt-5">
          {step.why !== null && <p className="text-[13.5px] text-text-dark-secondary">{step.why}</p>}
          <DramaForm
            key={`${step.query.title}|${step.query.platform}|${step.query.language ?? ""}`}
            adminBase={adminBase}
            initial={{
              title: step.query.title,
              platform: step.query.platform,
              language: step.query.language ?? "en",
            }}
          />
        </div>
      )}
    </div>
  );
}

export function TagList({ tags }: { tags: readonly string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <li
          key={tag}
          className="rounded-full border border-brand-border-card bg-brand-panel-raised px-2.5 py-0.5 text-[12px] text-text-dark-secondary"
        >
          {tag}
        </li>
      ))}
    </ul>
  );
}

function lookupError(answer: Parameters<typeof describeError>[0]): string {
  const code = typeof answer.error?.code === "string" ? answer.error.code : "";
  const message = typeof answer.error?.message === "string" ? answer.error.message : null;
  if (code === "lookup_unavailable") return `选剧台暂时查不了：${message ?? "请稍后再试"}。`;
  if (code === "lookup_rejected") return `选剧台不接受这次查询：${message ?? "请检查剧名"}。`;
  if (code === "lookup_not_found") return "选剧台这次没再查到这部剧，请重新查一次。";
  if (code === "lookup_not_configured") return "选剧台查剧还没接上。";
  return describeError(answer);
}
