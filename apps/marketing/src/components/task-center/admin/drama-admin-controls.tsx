// @input  -- a drama id, its status and assets; the admin status, upload and asset APIs; R2 via signed PUT URLs
// @output -- publish/take-down buttons, the cover and clip uploaders with progress (one upload at a time), and per-clip delete
// @pos    -- the interactive half of /admin/tasks/<id>
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  VIDEO_TYPES,
  type DramaStatus,
} from "../../../lib/task-center/contracts.ts";
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
  file: File,
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
      fileName: file.name.slice(0, 255),
      contentType: file.type,
      byteSize: file.size,
    });
    const uploadUrl = start.data?.uploadUrl;
    if (!start.ok || typeof uploadUrl !== "string") {
      setError(`${file.name}：${describeError(start)}`);
      return false;
    }
    const status = await putWithProgress(uploadUrl, file, (fraction) =>
      setProgress(`${file.name}：${Math.round(fraction * 100)}%`),
    );
    if (status < 200 || status >= 300) {
      // Status 0 is usually the bucket's CORS rule missing this origin.
      setError(`${file.name}：上传到 R2 失败（${status || "被浏览器拦截，检查桶的 CORS"}）。`);
      return false;
    }
    const done = await adminFetch(
      `/api/admin/tasks/dramas/${dramaId}/uploads/complete`,
      "POST",
      purpose === "asset"
        ? { purpose, assetId: start.data?.assetId }
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
