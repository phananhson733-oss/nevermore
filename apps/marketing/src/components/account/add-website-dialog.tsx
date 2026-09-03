"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import {
  normalizeNewAccountWebsiteUrl,
  parseWebsiteDetails,
  parseWebsiteSummary,
} from "../../lib/account-websites/contracts.ts";
import { Button } from "../ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.tsx";
import { Input } from "../ui/input.tsx";
import { Label } from "../ui/label.tsx";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

async function readCreatedWebsiteId(body: unknown): Promise<string | null> {
  const website = record(record(body)?.data)?.website;
  try {
    return (await parseWebsiteDetails(website)).websiteId;
  } catch {
    return null;
  }
}

function readDuplicateWebsiteId(body: unknown): string | null {
  const website = record(record(record(body)?.error)?.details)?.website;
  try {
    return parseWebsiteSummary(website).websiteId;
  } catch {
    return null;
  }
}

export function AddWebsiteDialog({
  open,
  onOpenChange,
  onComplete,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onComplete: (websiteId: string, generate: boolean) => void;
}) {
  const t = useTranslations("account.websites.dialog");
  const urlId = useId();
  const displayNameId = useId();
  const urlInput = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"invalid_url" | "failed" | null>(null);

  async function submit(generate: boolean): Promise<void> {
    const trimmedUrl = url.trim();
    const trimmedDisplayName = displayName.trim();
    if (normalizeNewAccountWebsiteUrl(trimmedUrl) === null) {
      setError("invalid_url");
      urlInput.current?.focus();
      return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/account/websites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: trimmedUrl,
          displayName: trimmedDisplayName === "" ? null : trimmedDisplayName,
        }),
      });
      const body = await readJson(response);
      const websiteId =
        response.status === 201
          ? await readCreatedWebsiteId(body)
          : response.status === 409
            ? readDuplicateWebsiteId(body)
            : null;
      if (websiteId !== null) {
        setUrl("");
        setDisplayName("");
        onComplete(websiteId, generate);
        onOpenChange(false);
        return;
      }
      setError("failed");
    } catch {
      setError("failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(false);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={urlId}>{t("url")}</Label>
            <Input
              ref={urlInput}
              id={urlId}
              name="websiteUrl"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={t("urlPlaceholder")}
              inputMode="url"
              autoComplete="url"
              aria-invalid={error === "invalid_url"}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={displayNameId}>{t("displayName")}</Label>
            <Input
              id={displayNameId}
              name="websiteDisplayName"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder={t("displayNamePlaceholder")}
              maxLength={160}
              autoComplete="organization"
            />
          </div>

          {error === null ? null : (
            <p role="alert" className="text-[13px] text-brand-error">
              {error === "invalid_url" ? t("invalidUrl") : t("failed")}
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="submit"
              variant="outline"
              disabled={pending}
            >
              {pending ? t("adding") : t("addOnly")}
            </Button>
            <Button
              type="button"
              variant="cta"
              disabled={pending}
              onClick={() => void submit(true)}
            >
              {pending ? t("adding") : t("addAndGenerate")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
