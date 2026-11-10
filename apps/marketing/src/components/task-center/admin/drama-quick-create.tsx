// @input  -- a title, a platform and maybe a language typed on /admin/tasks; POST /api/admin/tasks/dramas/lookup and /import
// @output -- 查剧: one exact match is listed straight away, several are offered to pick from, none (or a platform 选剧台 does not know) opens the full form, filled from 选剧台's 剧库 when it has the drama on this platform and with a switch to the platforms where it has it otherwise; a listed drama opens with ?new=<cover outcome>&details=<official|beidou>; while waiting it says whether 选剧台 is reading its 剧库 or asking 北斗
// @pos    -- the new-drama panel on /admin/tasks; the full DramaForm stays as the manual way
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import {
  CATALOG_FIRST_PLATFORMS,
  LOOKUP_LANGUAGES,
  LOOKUP_PLATFORMS,
  THEATER_PLATFORMS,
} from "../../../lib/task-center/contracts.ts";
import { languageName, PLATFORM_LABELS, platformLabel } from "../../../lib/task-center/copy.ts";
import { adminFetch, describeError } from "./admin-fetch.ts";
import { DramaForm, type DramaFormValues } from "./drama-form.tsx";

const OTHER = "other";

interface Candidate {
  readonly platformDramaId: string;
  readonly title: string;
  readonly titleCn: string | null;
  readonly exact: boolean;
  readonly language: string | null;
  readonly episodes: number | null;
  readonly payStart: number | null;
  readonly finished: boolean | null;
  readonly synopsis: string | null;
  readonly tags: readonly string[];
  readonly hasCover: boolean;
  readonly listedDramaId: string | null;
}

/** A 剧库 row with the title looked up, sent when nothing was found: no id, so never imported. */
export interface CatalogHint {
  readonly platform: string;
  readonly title: string;
  readonly titleCn: string | null;
  readonly language: string | null;
  readonly episodes: number | null;
  readonly payStart: number | null;
}

export interface Query {
  readonly title: string;
  readonly platform: string;
  readonly language: string | null;
}

export type Step =
  | { readonly kind: "idle" }
  | { readonly kind: "searching"; readonly platform: string }
  | { readonly kind: "importing"; readonly title: string; readonly platform: string }
  | { readonly kind: "pick"; readonly query: Query; readonly candidates: readonly Candidate[] }
  | {
      readonly kind: "manual";
      readonly query: Query;
      readonly why: string | null;
      /** What 选剧台's 剧库 knows of this drama on this platform, typed in for the operator. */
      readonly prefill?: Partial<DramaFormValues>;
      /** Other platforms whose 剧库 has a drama of this title, to look it up there instead. */
      readonly elsewhere?: readonly CatalogHint[];
    };

/** After this long a 剧库-first lookup is almost surely waiting on 北斗 (the 剧库 answers in a second or two). */
const CATALOG_SECONDS = 3;

const FIELD =
  "mt-1 h-10 w-full rounded-[8px] border border-brand-border-strong bg-brand-bg px-3 text-[14px] text-text-dark-primary";
const BUTTON =
  "h-10 rounded-[10px] bg-primary px-5 text-[14px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50";
const LINK_BUTTON = "text-[13.5px] text-brand-accent-text hover:underline";

function isHint(value: unknown): value is CatalogHint {
  const row = value as Partial<CatalogHint> | null;
  return typeof row?.platform === "string" && typeof row.title === "string" && row.title !== "";
}

function readHints(value: unknown): readonly CatalogHint[] {
  return Array.isArray(value) ? value.filter(isHint) : [];
}

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
  // Whether a 剧库-first lookup has run long enough that 选剧台 must be asking 北斗.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (step.kind !== "searching") return;
    const timer = setTimeout(() => setSlow(true), CATALOG_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [step]);

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
    await runSearch(readQuery(event.currentTarget));
  }

  async function runSearch(query: Query): Promise<void> {
    setError(null);
    setLastQuery(query);
    if (query.platform === OTHER) {
      setStep({ kind: "manual", query: { ...query, platform: "" }, why: "选剧台不认识这个平台，请手填。" });
      return;
    }
    setStep({ kind: "searching", platform: query.platform });
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
      setStep(missed(query, readHints(answer.data?.inCatalog)));
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
    setStep({ kind: "importing", title: candidate.title, platform: query.platform });
    const answer = await adminFetch("/api/admin/tasks/dramas/import", "POST", {
      ...query,
      platformDramaId: candidate.platformDramaId,
    });
    if (answer.ok && typeof answer.data?.id === "string") {
      const cover = typeof answer.data.cover === "string" ? answer.data.cover : "missing";
      const details = typeof answer.data.details === "string" ? answer.data.details : "beidou";
      router.push(`${adminBase}/${answer.data.id}?new=${encodeURIComponent(cover)}&details=${encodeURIComponent(details)}`);
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

  function switchTo(query: Query, hint: CatalogHint): void {
    setPlatform(hint.platform);
    void runSearch({ ...query, platform: hint.platform });
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
          {waitingNote(step.platform, slow)}
        </p>
      )}
      {step.kind === "importing" && (
        <p role="status" className="text-[13.5px] text-text-dark-secondary">
          找到「{step.title}」，正在
          {THEATER_PLATFORMS.has(step.platform) ? `读 ${platformLabel(step.platform)} 官网、` : ""}建草稿、拷封面…
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
                    candidate.finished === true ? "已完结" : null,
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
          {step.elsewhere !== undefined && step.elsewhere.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {step.elsewhere.map((hint) => (
                <li key={`${hint.platform}|${hint.language ?? ""}`}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => switchTo(step.query, hint)}
                    className="h-9 rounded-[8px] border border-brand-border-strong bg-brand-bg px-3 text-[13.5px] text-text-dark-primary hover:border-primary disabled:opacity-50"
                  >
                    换成 {platformLabel(hint.platform)} 查
                    {hint.language === null ? "" : `（${languageName(hint.language, "zh")}）`}
                    {hint.titleCn === null ? "" : ` · ${hint.titleCn}`}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <DramaForm
            key={`${step.query.title}|${step.query.platform}|${step.query.language ?? ""}|${step.prefill === undefined ? "" : "prefill"}`}
            adminBase={adminBase}
            initial={{
              title: step.query.title,
              platform: step.query.platform,
              language: step.query.language ?? "en",
              ...step.prefill,
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

/**
 * Nothing found on the platform looked up. When 选剧台's 剧库 has the drama
 * there anyway (FlickReels: 北斗's account has none of its dramas, and the 剧库
 * has no id to list it by), its title, 中文名, language and counts are typed in.
 * Otherwise the platforms where the 剧库 has it are offered, one per platform
 * and language.
 */
export function missed(query: Query, hints: readonly CatalogHint[]): Step {
  const label = platformLabel(query.platform);
  const here = hints.find(
    (hint) => hint.platform === query.platform && (query.language === null || hint.language === query.language),
  );
  if (here !== undefined) {
    return {
      kind: "manual",
      query,
      why: `选剧台的剧库里有这部 ${label} 的剧，但查不到它的简介、标签和封面（北斗上也没查到）。剧名、中文名和语种已按剧库填好，其余请手填。`,
      prefill: {
        title: here.title,
        ...(here.titleCn === null ? {} : { titleCn: here.titleCn }),
        ...(here.language === null ? {} : { language: here.language }),
        ...(here.episodes === null ? {} : { episodes: here.episodes }),
        ...(here.payStart === null ? {} : { payStart: here.payStart }),
      },
    };
  }
  const seen = new Set<string>();
  const elsewhere = hints.filter((hint) => {
    const key = `${hint.platform}|${hint.language ?? ""}`;
    if (hint.platform === query.platform || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (elsewhere.length > 0) {
    const where = [...new Set(elsewhere.map((hint) => platformLabel(hint.platform)))].join("、");
    return {
      kind: "manual",
      query,
      why: `选剧台在 ${label} 没查到「${query.title}」，但它的剧库里 ${where} 有同名的剧，是不是平台选错了？可以换过去查，或者在下面手填。`,
      elsewhere,
    };
  }
  return { kind: "manual", query, why: `选剧台在 ${label} 没查到「${query.title}」，请手填。` };
}

/** What 查剧 says while it waits: the 剧库 answers in a second or two, 北斗 waits its turn on a shared account. */
export function waitingNote(platform: string, slow: boolean): string {
  const beidou = "北斗账号和别的任务共用，排队时可能要半分钟到一分钟。";
  if (!CATALOG_FIRST_PLATFORMS.has(platform)) return `正在通过选剧台问北斗：${beidou}`;
  return slow ? `剧库里没直接查到，转去问北斗了：${beidou}` : "正在查选剧台的剧库，一般一两秒。";
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
