// @input  -- a drama id, its status and assets; the admin status, refill, upload and asset APIs; R2 via signed PUT URLs
// @output -- publish/take-down buttons, 从官网补全资料 (re-runs 查剧 for the drama and says where the details came from, how the cover went, or why nothing changed), each clip's title rename, the cover and clip uploaders (one button opens the file picker, or files are dropped on the box, and the upload starts as soon as files are picked; progress, one upload at a time, a still cut from each video in the browser), per-clip type and delete
// @pos    -- the interactive half of /admin/tasks/<id>
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  CLIP_TYPES,
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  VIDEO_TYPES,
  type ClipType,
  type DramaStatus,
} from "../../../lib/task-center/contracts.ts";
import { CLIP_TYPE_LABELS_ZH } from "../../../lib/task-center/copy.ts";
import { adminFetch, describeError } from "./admin-fetch.ts";

const BUTTON =
  "h-9 rounded-[8px] border border-brand-border-strong bg-brand-panel px-4 text-[13.5px] text-text-dark-primary hover:border-brand-accent/50 disabled:opacity-50";

export function StatusControl({ dramaId, status }: { dramaId: string; status: DramaStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: DramaStatus): Promise<void> {
    setBusy(true);
    setError(null);
    const answer = await adminFetch(`/api/admin/tasks/dramas/${dramaId}/status`, "POST", { status: next });
    setBusy(false);
    if (!answer.ok) {
      setError(describeError(answer));
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {status !== "published" && (
        <button type="button" className={BUTTON} disabled={busy} onClick={() => void change("published")}>
          上架
        </button>
      )}
      {status === "published" && (
        <button type="button" className={BUTTON} disabled={busy} onClick={() => void change("archived")}>
          下架
        </button>
      )}
      {status === "archived" && (
        <button type="button" className={BUTTON} disabled={busy} onClick={() => void change("draft")}>
          改回草稿
        </button>
      )}
      {error && <p role="alert" className="text-[13.5px] text-brand-error">{error}</p>}
    </div>
  );
}

const REFILL_COVER_NOTES: Readonly<Record<string, string>> = {
  saved: "封面也拷过来了。",
  missing: "选剧台和官网都没有封面，请手动上传一张。",
  failed: "封面没拷成功，请手动上传一张。",
};

function refillError(answer: Parameters<typeof describeError>[0]): string {
  const code = typeof answer.error?.code === "string" ? answer.error.code : "";
  const message = typeof answer.error?.message === "string" ? answer.error.message : null;
  if (code === "lookup_unavailable") return `选剧台暂时查不了：${message ?? "请稍后再试"}。`;
  if (code === "lookup_rejected") return `选剧台不接受这次查询：${message ?? "请检查剧名"}。`;
  if (code === "lookup_not_configured") return "选剧台查剧还没接上。";
  if (code === "lookup_platform_unknown") return "选剧台不认识这个平台，只能在下面「修改剧集信息」里手填。";
  if (code === "lookup_not_found") {
    return "选剧台按这个剧名和语言没查到这部剧。剧名要和平台上的一字不差，可以在下面「修改剧集信息」里改剧名再试。";
  }
  if (code === "lookup_ambiguous") return "选剧台查到好几部同名的剧，分不出是哪一部，请在下面「修改剧集信息」里手填。";
  if (code === "already_listed") return "这部剧在后台已经有另一份（从查剧建的），两份只该留一份。";
  if (code === "language_unknown") return "不知道这部剧的语言，请先在「修改剧集信息」里填好。";
  return describeError(answer);
}

/**
 * 从官网补全资料: re-runs 查剧 for a drama already listed and writes what it
 * finds over the drama's details. The note stays after the page refreshes.
 */
export function RefillControl({
  dramaId,
  platform,
  fromTheater,
}: {
  dramaId: string;
  /** The platform's name, as the note says it. */
  platform: string;
  /** Whether 查剧 also reads this platform's own site, so a 北斗-only answer means the site was not read. */
  fromTheater: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<{ readonly text: string; readonly otherId: string | null } | null>(null);

  async function refill(): Promise<void> {
    setBusy(true);
    setNote(null);
    setError(null);
    const answer = await adminFetch(`/api/admin/tasks/dramas/${dramaId}/refill`, "POST", {});
    setBusy(false);
    if (!answer.ok || answer.data === null) {
      const otherId = answer.error?.code === "already_listed" && typeof answer.error.id === "string" ? answer.error.id : null;
      setError({ text: refillError(answer), otherId });
      return;
    }
    const from =
      answer.data.details === "official"
        ? `已按 ${platform} 官网的资料更新。`
        : fromTheater
          ? `${platform} 官网这次没读到，只按选剧台的资料更新了，标签、频道和题材可能还是不全。`
          : "已按选剧台的资料更新。";
    const cover = typeof answer.data.cover === "string" ? (REFILL_COVER_NOTES[answer.data.cover] ?? "") : "";
    setNote(`${from}${cover}`);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={BUTTON} disabled={busy} onClick={() => void refill()}>
          {busy ? "正在查…" : "从官网补全资料"}
        </button>
        <span className="text-[12.5px] leading-[1.5] text-text-dark-secondary">
          按选剧台和官网现在的资料更新集数、收费、简介、标签、频道和题材；剧名、语言、平台链接不变。没有封面时也拷一张。
        </span>
      </div>
      {note !== null && (
        <p role="status" className="text-[13.5px] text-brand-accent-text">
          {note}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-[13.5px] text-brand-error">
          {error.text}
          {error.otherId !== null && (
            <>
              {" "}
              <a href={`./${error.otherId}`} className="text-brand-accent-text hover:underline">
                打开另一份
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** PUT with progress; fetch cannot report upload progress, XHR can. */
function putWithProgress(
  url: string,
  file: Blob,
  onProgress: (fraction: number) => void,
): Promise<number> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", file.type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => resolve(xhr.status);
    xhr.onerror = () => resolve(0);
    xhr.send(file);
  });
}

/** Waits for one event, or gives up after a while so a file the browser cannot decode never hangs the upload. */
function once(target: HTMLVideoElement, event: string, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(false), ms);
    target.addEventListener(event, () => { window.clearTimeout(timer); resolve(true); }, { once: true });
    target.addEventListener("error", () => { window.clearTimeout(timer); resolve(false); }, { once: true });
  });
}

/**
 * A JPEG still from about a second into the local file, at most 960px tall,
 * for the clip grid. Null when this browser cannot decode the video (an HEVC
 * .mov, say); the grid then shows the drama's cover.
 */
async function capturePoster(file: File): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  try {
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    if (!(await once(video, "loadeddata", 15_000))) return null;
    const at = Number.isFinite(video.duration) ? Math.min(1, video.duration / 2) : 0;
    if (at > 0) {
      video.currentTime = at;
      if (!(await once(video, "seeked", 10_000))) return null;
    }
    if (video.videoWidth === 0 || video.videoHeight === 0) return null;
    const scale = Math.min(1, 960 / video.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    URL.revokeObjectURL(url);
  }
}

/** A clip's title with 改标题: the title is what promoters see on its card. */
export function AssetTitle({ assetId, title }: { assetId: string; title: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    const next = value.trim();
    if (next === "" || next === title) {
      setEditing(false);
      setValue(title);
      return;
    }
    setBusy(true);
    setError(null);
    const answer = await adminFetch(`/api/admin/tasks/assets/${assetId}`, "PUT", { title: next });
    setBusy(false);
    if (!answer.ok) {
      setError(describeError(answer));
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="min-w-0 truncate text-text-dark-primary">{title}</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 text-[12.5px] text-brand-accent-text hover:underline"
        >
          改标题
        </button>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <input
        aria-label="素材标题"
        value={value}
        maxLength={200}
        autoFocus
        disabled={busy}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void save();
          if (event.key === "Escape") {
            setEditing(false);
            setValue(title);
          }
        }}
        className="h-8 min-w-48 flex-1 rounded-[8px] border border-brand-border-strong bg-brand-bg px-2 text-[13.5px] text-text-dark-primary"
      />
      <button type="button" disabled={busy} onClick={() => void save()} className="text-[12.5px] text-brand-accent-text hover:underline">
        保存
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setEditing(false);
          setValue(title);
        }}
        className="text-[12.5px] text-text-dark-secondary hover:underline"
      >
        取消
      </button>
      {error && <span className="text-[12.5px] text-brand-error">{error}</span>}
    </span>
  );
}

export function ClipTypeSelect({ assetId, clipType }: { assetId: string; clipType: ClipType | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(value: string): Promise<void> {
    setBusy(true);
    setError(null);
    const answer = await adminFetch(`/api/admin/tasks/assets/${assetId}`, "PUT", {
      clipType: value === "" ? null : value,
    });
    setBusy(false);
    if (!answer.ok) {
      setError(describeError(answer));
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <select
        aria-label="素材类型"
        value={clipType ?? ""}
        disabled={busy}
        onChange={(event) => void change(event.target.value)}
        className={SELECT}
      >
        <option value="">未分类</option>
        {CLIP_TYPES.map((value) => (
          <option key={value} value={value}>
            {CLIP_TYPE_LABELS_ZH[value]}
          </option>
        ))}
      </select>
      {error && <span className="text-[12.5px] text-brand-error">{error}</span>}
    </span>
  );
}

const SELECT =
  "h-9 rounded-[8px] border border-brand-border-strong bg-brand-bg px-2 text-[13.5px] text-text-dark-primary disabled:opacity-50";

export function UploadControl({
  dramaId,
  purpose,
  storageReady,
}: {
  dramaId: string;
  purpose: "cover" | "asset";
  storageReady: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [clipType, setClipType] = useState<ClipType | "">("");
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A ref, not state: a second click in the same tick must already see it.
  const uploading = useRef(false);
  const [dragging, setDragging] = useState(false);
  const types = purpose === "cover" ? IMAGE_TYPES : [...VIDEO_TYPES, ...IMAGE_TYPES];

  if (!storageReady) {
    return <p className="text-[13.5px] text-text-dark-secondary">R2 还没配置（R2_ACCOUNT_ID 等四项），暂时不能上传。</p>;
  }

  async function uploadOne(file: File): Promise<boolean> {
    if (!(types as readonly string[]).includes(file.type)) {
      setError(`${file.name}：不支持的类型 ${file.type || "未知"}。`);
      return false;
    }
    const limit = file.type.startsWith("video/") ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (file.size > limit) {
      setError(`${file.name}：超过 ${Math.round(limit / 1024 ** 2)} MB 上限。`);
      return false;
    }
    const start = await adminFetch(`/api/admin/tasks/dramas/${dramaId}/uploads`, "POST", {
      purpose,
      title: purpose === "asset" && title.trim() !== "" ? title.trim() : null,
      clipType: purpose === "asset" && clipType !== "" ? clipType : null,
      fileName: file.name.slice(0, 255),
      contentType: file.type,
      byteSize: file.size,
    });
    const uploadUrl = start.data?.uploadUrl;
    if (!start.ok || typeof uploadUrl !== "string") {
      setError(`${file.name}：${describeError(start)}`);
      return false;
    }
    const posterUrl = start.data?.posterUploadUrl;
    const poster = typeof posterUrl === "string" ? capturePoster(file) : Promise.resolve(null);
    const status = await putWithProgress(uploadUrl, file, (fraction) =>
      setProgress(`${file.name}：${Math.round(fraction * 100)}%`),
    );
    if (status < 200 || status >= 300) {
      // Status 0 is usually the bucket's CORS rule missing this origin.
      setError(`${file.name}：上传到 R2 失败（${status || "被浏览器拦截，检查桶的 CORS"}）。`);
      return false;
    }
    // The still is optional: if it cannot be cut or sent, the clip goes live without one.
    let posterKey: string | undefined;
    const still = await poster;
    if (still !== null && typeof posterUrl === "string" && typeof start.data?.posterKey === "string") {
      const posterStatus = await putWithProgress(posterUrl, still, () => {});
      if (posterStatus >= 200 && posterStatus < 300) posterKey = start.data.posterKey;
    }
    const done = await adminFetch(
      `/api/admin/tasks/dramas/${dramaId}/uploads/complete`,
      "POST",
      purpose === "asset"
        ? { purpose, assetId: start.data?.assetId, ...(posterKey === undefined ? {} : { posterKey }) }
        : { purpose, objectKey: start.data?.objectKey },
    );
    if (!done.ok) {
      setError(`${file.name}：${describeError(done)}`);
      return false;
    }
    return true;
  }

  async function upload(files: readonly File[]): Promise<void> {
    if (files.length === 0 || uploading.current) return;
    // Disables the button before the first progress event, so a second click
    // cannot start the same files again as duplicate clips.
    uploading.current = true;
    setProgress("准备上传…");
    setError(null);
    try {
      // One at a time: a clip is tens of MB and the admin's uplink is the bottleneck.
      for (const file of purpose === "cover" ? files.slice(0, 1) : files) {
        if (!(await uploadOne(file))) break;
      }
    } finally {
      uploading.current = false;
      setProgress(null);
      setTitle("");
      if (input.current) input.current.value = "";
      router.refresh();
    }
  }

  return (
    <div
      className={`space-y-3 rounded-[10px] border-2 border-dashed p-4 transition-colors ${
        dragging ? "border-brand-accent bg-brand-accent/5" : "border-brand-border-card"
      }`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void upload(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        {purpose === "asset" && (
          <select
            aria-label="素材类型"
            value={clipType}
            onChange={(event) => setClipType(event.target.value as ClipType | "")}
            className={SELECT}
          >
            <option value="">类型：未分类</option>
            {CLIP_TYPES.map((value) => (
              <option key={value} value={value}>
                类型：{CLIP_TYPE_LABELS_ZH[value]}
              </option>
            ))}
          </select>
        )}
        {purpose === "asset" && (
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="素材标题（不填用文件名）"
            maxLength={200}
            className="h-9 min-w-60 rounded-[8px] border border-brand-border-strong bg-brand-bg px-3 text-[13.5px] text-text-dark-primary"
          />
        )}
        {/* Hidden: the button opens it, and picking files starts the upload.
            A separate "choose file" then "upload" left a click on the button
            with nothing chosen doing nothing at all. */}
        <input
          ref={input}
          type="file"
          multiple={purpose === "asset"}
          accept={types.join(",")}
          aria-label={purpose === "cover" ? "选择封面图片" : "选择素材文件"}
          className="hidden"
          onChange={(event) => void upload(Array.from(event.target.files ?? []))}
        />
        <button
          type="button"
          className={BUTTON}
          disabled={progress !== null}
          onClick={() => {
            if (!uploading.current) input.current?.click();
          }}
        >
          {purpose === "cover" ? "选择并上传封面" : "选择并上传素材"}
        </button>
        <span className="text-[13px] text-text-dark-secondary">
          {purpose === "cover"
            ? "点按钮选图片，或把图片拖到这个框里，选好就开始上传"
            : "点按钮选文件（可多选），或把文件拖到这个框里，选好就开始上传"}
        </span>
      </div>
      {progress && <p className="font-mono text-[13px] text-text-dark-secondary">{progress}</p>}
      {error && <p role="alert" className="text-[13.5px] text-brand-error">{error}</p>}
    </div>
  );
}

export function DeleteAssetButton({ assetId, title }: { assetId: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(): Promise<void> {
    if (!window.confirm(`删除素材「${title}」？推广者马上就看不到了，R2 里的文件也会一起删。`)) return;
    setBusy(true);
    const answer = await adminFetch(`/api/admin/tasks/assets/${assetId}`, "DELETE");
    setBusy(false);
    if (!answer.ok) {
      setError(describeError(answer));
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={busy} onClick={() => void remove()} className="text-[13px] text-brand-error hover:underline disabled:opacity-50">
        删除
      </button>
      {error && <span className="text-[12.5px] text-brand-error">{error}</span>}
    </span>
  );
}
