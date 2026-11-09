// @input  -- a drama's current fields (edit) or none (create); POST/PUT /api/admin/tasks/dramas
// @output -- the admin form for a drama's details, tags, audience and genre (with suggested genres), and promo target
// @pos    -- the manual create on /admin/tasks (when 查剧 finds nothing) and edit on /admin/tasks/<id>
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { DRAMA_AUDIENCES, MAX_TAGS, SUGGESTED_GENRES, type DramaAudience } from "../../../lib/task-center/contracts.ts";
import { AUDIENCE_LABELS_ZH } from "../../../lib/task-center/copy.ts";
import { adminFetch, describeError } from "./admin-fetch.ts";

export interface DramaFormValues {
  readonly title: string;
  readonly titleCn: string | null;
  readonly platform: string;
  readonly language: string;
  readonly episodes: number | null;
  readonly payStart: number | null;
  readonly synopsis: string | null;
  readonly promoTargetUrl: string | null;
  readonly promoCodeParam: string | null;
  readonly audience: DramaAudience | null;
  readonly genre: string | null;
  readonly tags: readonly string[];
}

const FIELD =
  "mt-1 h-10 w-full rounded-[8px] border border-brand-border-strong bg-brand-bg px-3 text-[14px] text-text-dark-primary";

function count(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isInteger(n) ? n : Number.NaN;
}

/**
 * "Romance, CEO，Revenge" → three tags; repeats (in any case) count once, and
 * each is cut to 40 characters and the list to MAX_TAGS, the server's limits.
 */
function tagList(value: FormDataEntryValue | null): string[] {
  const seen = new Set<string>();
  return String(value ?? "")
    .split(/[,，、]/)
    .map((tag) => tag.trim().slice(0, 40).trim())
    .filter((tag) => {
      if (tag === "" || seen.has(tag.toLowerCase())) return false;
      seen.add(tag.toLowerCase());
      return true;
    })
    .slice(0, MAX_TAGS);
}

function text(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

export function DramaForm({
  dramaId,
  initial,
  adminBase,
}: {
  dramaId?: string;
  /** A drama's fields to edit, or what 查剧 already knows for a new one. */
  initial?: Partial<DramaFormValues>;
  /** Locale-prefixed /admin/tasks, where a newly created drama's page lives. */
  adminBase: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      title: String(form.get("title") ?? "").trim(),
      titleCn: text(form.get("titleCn")),
      platform: String(form.get("platform") ?? "").trim(),
      language: String(form.get("language") ?? "").trim(),
      episodes: count(form.get("episodes")),
      payStart: count(form.get("payStart")),
      synopsis: text(form.get("synopsis")),
      promoTargetUrl: text(form.get("promoTargetUrl")),
      promoCodeParam: text(form.get("promoCodeParam")),
      audience: text(form.get("audience")),
      genre: text(form.get("genre")),
      tags: tagList(form.get("tags")),
    };
    setSaving(true);
    setMessage(null);
    const answer = dramaId
      ? await adminFetch(`/api/admin/tasks/dramas/${dramaId}`, "PUT", body)
      : await adminFetch("/api/admin/tasks/dramas", "POST", body);
    setSaving(false);
    if (!answer.ok) {
      setMessage({ ok: false, text: describeError(answer) });
      return;
    }
    if (!dramaId && typeof answer.data?.id === "string") {
      router.push(`${adminBase}/${answer.data.id}`);
      return;
    }
    setMessage({ ok: true, text: "已保存。" });
    router.refresh();
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-4 sm:grid-cols-2">
      <label className="text-[13px] text-text-dark-secondary">
        剧名（英文或原文）*
        <input name="title" required maxLength={200} defaultValue={initial?.title} className={FIELD} />
      </label>
      <label className="text-[13px] text-text-dark-secondary">
        中文名（可选）
        <input name="titleCn" maxLength={200} defaultValue={initial?.titleCn ?? ""} className={FIELD} />
      </label>
      <label className="text-[13px] text-text-dark-secondary">
        平台 *（小写，如 reelshort、dramabox）
        <input
          name="platform"
          required
          pattern="[a-z0-9][a-z0-9\-]{0,31}"
          defaultValue={initial?.platform}
          className={FIELD}
        />
      </label>
      <label className="text-[13px] text-text-dark-secondary">
        语言 *（如 en、es、pt-BR）
        <input name="language" required defaultValue={initial?.language ?? "en"} className={FIELD} />
      </label>
      <label className="text-[13px] text-text-dark-secondary">
        集数
        <input name="episodes" type="number" min={1} max={2000} defaultValue={initial?.episodes ?? ""} className={FIELD} />
      </label>
      <label className="text-[13px] text-text-dark-secondary">
        收费起始集（不填就不显示锁）
        <input name="payStart" type="number" min={1} max={2000} defaultValue={initial?.payStart ?? ""} className={FIELD} />
      </label>
      <label className="text-[13px] text-text-dark-secondary">
        频道（素材广场按它筛选）
        <select name="audience" defaultValue={initial?.audience ?? ""} className={FIELD}>
          <option value="">不填</option>
          {DRAMA_AUDIENCES.map((value) => (
            <option key={value} value={value}>
              {AUDIENCE_LABELS_ZH[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="text-[13px] text-text-dark-secondary">
        题材（可选列表里的，也可自己填小写英文；男频/女频请选在「频道」里）
        <input
          name="genre"
          list="genre-suggestions"
          pattern="[a-z0-9][a-z0-9\-]{0,31}"
          maxLength={32}
          defaultValue={initial?.genre ?? ""}
          className={FIELD}
        />
        <datalist id="genre-suggestions">
          {SUGGESTED_GENRES.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
      </label>
      <label className="text-[13px] text-text-dark-secondary sm:col-span-2">
        标签（逗号隔开，最多 {MAX_TAGS} 个，如 Romance, CEO, Revenge）
        <input name="tags" maxLength={1000} defaultValue={initial?.tags?.join(", ") ?? ""} className={FIELD} />
      </label>
      <label className="text-[13px] text-text-dark-secondary sm:col-span-2">
        推广目标地址（https，平台给的分销链接；上架前必填）
        <input name="promoTargetUrl" type="url" maxLength={2048} defaultValue={initial?.promoTargetUrl ?? ""} className={FIELD} />
      </label>
      <label className="text-[13px] text-text-dark-secondary">
        子渠道参数名（平台支持才填，如 sub_id；推广码会作为它的值带过去）
        <input name="promoCodeParam" pattern="[A-Za-z0-9_]{1,32}" defaultValue={initial?.promoCodeParam ?? ""} className={FIELD} />
      </label>
      <label className="text-[13px] text-text-dark-secondary sm:col-span-2">
        简介
        <textarea
          name="synopsis"
          maxLength={4000}
          rows={5}
          defaultValue={initial?.synopsis ?? ""}
          className="mt-1 w-full rounded-[8px] border border-brand-border-strong bg-brand-bg p-3 text-[14px] text-text-dark-primary"
        />
      </label>
      <div className="flex items-center gap-4 sm:col-span-2">
        <button
          type="submit"
          disabled={saving}
          className="h-10 rounded-[10px] bg-primary px-5 text-[14px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "保存中…" : dramaId ? "保存" : "新建（草稿）"}
        </button>
        {message && (
          <p role="status" className={`text-[13.5px] ${message.ok ? "text-brand-accent-text" : "text-brand-error"}`}>
            {message.text}
          </p>
        )}
      </div>
    </form>
  );
}

/**
 * Just the promo link, the one thing 查剧 cannot fill and publishing needs.
 * Saves through the same PUT, with every other field as the page loaded it.
 */
export function PromoLinkForm({ dramaId, initial }: { dramaId: string; initial: DramaFormValues }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const { tags: _tags, ...rest } = initial;
    setSaving(true);
    setMessage(null);
    // Tags left out, so the save keeps whatever the drama has now.
    const answer = await adminFetch(`/api/admin/tasks/dramas/${dramaId}`, "PUT", {
      ...rest,
      promoTargetUrl: text(form.get("promoTargetUrl")),
      promoCodeParam: text(form.get("promoCodeParam")),
    });
    setSaving(false);
    if (!answer.ok) {
      setMessage({ ok: false, text: describeError(answer) });
      return;
    }
    setMessage({ ok: true, text: "已保存。" });
    router.refresh();
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-4 sm:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
      <label className="text-[13px] text-text-dark-secondary">
        推广目标地址（https，平台给的分销链接）
        <input
          name="promoTargetUrl"
          type="url"
          maxLength={2048}
          defaultValue={initial.promoTargetUrl ?? ""}
          className={FIELD}
        />
      </label>
      <label className="text-[13px] text-text-dark-secondary">
        子渠道参数名（如 sub_id，可不填）
        <input name="promoCodeParam" pattern="[A-Za-z0-9_]{1,32}" defaultValue={initial.promoCodeParam ?? ""} className={FIELD} />
      </label>
      <div className="flex items-center gap-4 sm:col-span-2">
        <button
          type="submit"
          disabled={saving}
          className="h-10 rounded-[10px] bg-primary px-5 text-[14px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "保存中…" : "保存链接"}
        </button>
        {message && (
          <p role="status" className={`text-[13.5px] ${message.ok ? "text-brand-accent-text" : "text-brand-error"}`}>
            {message.text}
          </p>
        )}
      </div>
    </form>
  );
}
