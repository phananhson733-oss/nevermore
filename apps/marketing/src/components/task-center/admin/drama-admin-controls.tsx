// @input  -- a drama id, its status and assets; the admin status, upload and asset APIs; R2 via signed PUT URLs
// @output -- publish/take-down buttons, the cover and clip uploaders with progress (one upload at a time, a still cut from each video in the browser), per-clip type and delete
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

  async function upload(): Promise<void> {
    const files = Array.from(input.current?.files ?? []);
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
    <div className="space-y-3">
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
        <input
          ref={input}
          type="file"
          multiple={purpose === "asset"}
          accept={types.join(",")}
          className="text-[13.5px] text-text-dark-secondary"
        />
        <button type="button" className={BUTTON} disabled={progress !== null} onClick={() => void upload()}>
          {purpose === "cover" ? "上传封面" : "上传素材"}
        </button>
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
