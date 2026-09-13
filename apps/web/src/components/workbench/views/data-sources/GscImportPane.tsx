"use client";

import { useId, useRef, useState, type ChangeEvent } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { GSC_IMPORT_MAX_BYTES } from "@/lib/workbench/mock/gsc-import";
import { cn } from "../../ui/cn.ts";
import { Field } from "../../ui/Field.tsx";
import { InPane } from "../../ui/InPane.tsx";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "../../ui/panel.ts";
import { ClearGscRowsButton } from "./ClearGscRowsButton.tsx";
import { GscImportNotice } from "./GscImportNotice.tsx";
import { useGscImport } from "./use-gsc-import.ts";

/**
 * "GSC import (saved in this browser)" (T10 Step 3): paste or upload the
 * operator's own export. There is no authorisation step and no "fill in the
 * sample" (Q5) — sample data has one entry point, the overview's "load sample
 * site" — and nothing in this pane is labelled sample (codex #4): its only
 * action imports the operator's own rows, which are stored as `"user"`.
 *
 * - Parse: `use-gsc-import.ts` (dedupe, cap, no dispatch on zero rows).
 * - Upload: a visually hidden file input inside a label styled as the button,
 *   so the control reads as one; focus lands on the hidden input, so the ring is
 *   drawn with `focus-within:` on the label. The input is emptied after each
 *   pick, so the same file can be chosen again after editing it.
 * - Clear: `ClearGscRowsButton` (confirmation bound to what was on screen).
 *   The last result goes whenever the saved rows go from some to none, by that
 *   button or by any other write (`use-gsc-import.ts`), since it no longer
 *   describes them.
 * - The size limit is formatted once and handed to both sentences that name it.
 *
 * The whole pane is framework copy (Q30) except the textarea's value, which is
 * a property, not text content; the notice only prints catalogue sentences and
 * numbers.
 *
 * 一旦本文件被更新，务必更新开头注释
 */
export function GscImportPane() {
  const t = useTranslations("workbench.dataSources.import");
  const tPanes = useTranslations("workbench.panes");
  const format = useFormatter();
  const controls = useGscImport();
  const [text, setText] = useState("");
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const pasteId = useId();
  const limit = format.number(GSC_IMPORT_MAX_BYTES / BYTES_PER_MEGABYTE, {
    style: "unit",
    unit: "megabyte",
    unitDisplay: "short",
  });
  const footer = (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={() => controls.importText(text)} className={BUTTON_PRIMARY}>
        {t("parse")}
      </button>
      <ClearGscRowsButton focusAfterClear={pasteRef} />
    </div>
  );
  return (
    <div data-wb-frame="" data-wb-gsc-import="" className="min-w-0">
      <InPane title={t("title")} tag={tPanes("in")} note={t("localNote")} footer={footer}>
        <Field label={t("pasteLabel")} htmlFor={pasteId}>
          <textarea
            id={pasteId}
            ref={pasteRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={10}
            spellCheck={false}
            placeholder={t("placeholder")}
            className={TEXTAREA}
          />
        </Field>
        <p className="mt-2 text-xs text-slate-500">{t("replaceNote")}</p>
        <UploadControl limit={limit} onFile={controls.importFile} />
        <GscImportNotice notice={controls.notice} limit={limit} />
      </InPane>
    </div>
  );
}

/** SI megabytes, matching `GSC_IMPORT_MAX_BYTES` and the "MB" unit label. */
const BYTES_PER_MEGABYTE = 1_000_000;

const ACCEPT = ".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain";

const TEXTAREA =
  "min-h-[160px] w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 placeholder:text-slate-500";

/** The label is the visible control; the input it wraps holds the focus. */
const UPLOAD_LABEL =
  "cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-slate-900";

function UploadControl({
  limit,
  onFile,
}: {
  readonly limit: string;
  readonly onFile: (file: File) => Promise<void>;
}) {
  const t = useTranslations("workbench.dataSources.import");
  function onChange(event: ChangeEvent<HTMLInputElement>): void {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (file !== undefined) void onFile(file);
  }
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <label className={cn(BUTTON_SECONDARY, UPLOAD_LABEL)}>
        <input type="file" accept={ACCEPT} onChange={onChange} data-wb-gsc-file="" className="sr-only" />
        {t("upload")}
      </label>
      <span className="text-xs text-slate-500">{t("uploadHint", { limit })}</span>
    </div>
  );
}
