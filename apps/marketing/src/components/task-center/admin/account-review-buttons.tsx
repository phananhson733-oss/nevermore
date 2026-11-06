// @input  -- an account id and its current status; PUT /api/admin/tasks/accounts/<id>
// @output -- 通过 / 拒绝 buttons (the one matching the current status hidden), then a page refresh
// @pos    -- the action column of /admin/tasks/accounts
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { AccountStatus } from "../../../lib/task-center/contracts.ts";
import { adminFetch, describeError } from "./admin-fetch.ts";

export function AccountReviewButtons({
  accountId,
  status,
}: {
  accountId: string;
  status: AccountStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function review(next: "whitelisted" | "rejected"): Promise<void> {
    setBusy(true);
    setError(null);
    const answer = await adminFetch(`/api/admin/tasks/accounts/${accountId}`, "PUT", { status: next });
    setBusy(false);
    if (!answer.ok) {
      setError(describeError(answer));
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <div className="flex gap-3">
        {status !== "whitelisted" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void review("whitelisted")}
            className="text-[13.5px] font-medium text-brand-accent-text hover:underline disabled:opacity-50"
          >
            通过
          </button>
        )}
        {status !== "rejected" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void review("rejected")}
            className="text-[13.5px] text-brand-error hover:underline disabled:opacity-50"
          >
            拒绝
          </button>
        )}
      </div>
      {error !== null && (
        <p role="alert" className="mt-1 max-w-60 text-[12.5px] whitespace-normal text-brand-error">
          {error}
        </p>
      )}
    </div>
  );
}
