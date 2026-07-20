"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, Field, TextInput } from "@/components/ui";
import { ApiError, useCreateProject } from "@/lib/api";
import {
  mapProjectFieldErrors,
  type ProjectFieldErrors as FieldErrors,
} from "./_form-errors";
import styles from "./new-project.module.css";

/**
 * Create-project form (client). Comma-separated market/language inputs are split
 * into trimmed, non-empty arrays before the mutation. On success we route to the
 * new project's overview; on an `ApiError` we map JSON-pointer field errors back
 * onto the matching `Field` and surface anything else as a general error.
 */

/** Split a comma-separated input into trimmed, non-empty tokens. */
function splitCsv(raw: string): string[] {
  return raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export function NewProjectForm() {
  const t = useTranslations("newProject");
  const router = useRouter();
  const mutation = useCreateProject();

  const [clientName, setClientName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [marketCodes, setMarketCodes] = useState("");
  const [siteLanguageCodes, setSiteLanguageCodes] = useState("");
  const [defaultDeliveryLocale, setDefaultDeliveryLocale] = useState("en");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setFieldErrors({});
    setGeneralError(null);

    try {
      const project = await mutation.mutateAsync({
        clientName: clientName.trim(),
        projectName: projectName.trim(),
        siteUrl: siteUrl.trim(),
        marketCodes: splitCsv(marketCodes),
        siteLanguageCodes: splitCsv(siteLanguageCodes),
        defaultDeliveryLocale: defaultDeliveryLocale.trim(),
      });
      router.push(`/p/${project.id}/overview`);
    } catch (error) {
      if (error instanceof ApiError) {
        const mapped = mapProjectFieldErrors(error.fieldErrors(), {
          siteUrlInvalid: t("siteUrlInvalid"),
          createError: t("createError"),
        });
        setFieldErrors(mapped.fieldErrors);
        setGeneralError(mapped.generalError);
      } else {
        setGeneralError(t("createError"));
      }
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit();
  }

  const pending = mutation.isPending;

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <Card padding="lg" className={styles.card}>
        <div className={styles.grid}>
          <Field label={t("fields.clientName.label")} help={t("fields.clientName.help")} error={fieldErrors.clientName}>
            <TextInput
              value={clientName}
              onChange={(event) => setClientName(event.target.value)}
              placeholder={t("fields.clientName.placeholder")}
              autoComplete="organization"
            />
          </Field>

          <Field label={t("fields.projectName.label")} help={t("fields.projectName.help")} error={fieldErrors.projectName}>
            <TextInput
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder={t("fields.projectName.placeholder")}
            />
          </Field>

          <div className={styles.full}>
            <Field label={t("fields.siteUrl.label")} help={t("fields.siteUrl.help")} error={fieldErrors.siteUrl}>
              <TextInput
                type="url"
                inputMode="url"
                value={siteUrl}
                onChange={(event) => setSiteUrl(event.target.value)}
                placeholder={t("fields.siteUrl.placeholder")}
              />
            </Field>
          </div>

          <Field label={t("fields.marketCodes.label")} help={t("fields.marketCodes.help")} error={fieldErrors.marketCodes}>
            <TextInput
              value={marketCodes}
              onChange={(event) => setMarketCodes(event.target.value)}
              placeholder={t("fields.marketCodes.placeholder")}
            />
          </Field>

          <Field
            label={t("fields.siteLanguageCodes.label")}
            help={t("fields.siteLanguageCodes.help")}
            error={fieldErrors.siteLanguageCodes}
          >
            <TextInput
              value={siteLanguageCodes}
              onChange={(event) => setSiteLanguageCodes(event.target.value)}
              placeholder={t("fields.siteLanguageCodes.placeholder")}
            />
          </Field>

          <Field
            label={t("fields.defaultDeliveryLocale.label")}
            help={t("fields.defaultDeliveryLocale.help")}
            error={fieldErrors.defaultDeliveryLocale}
          >
            <TextInput
              value={defaultDeliveryLocale}
              onChange={(event) => setDefaultDeliveryLocale(event.target.value)}
              placeholder={t("fields.defaultDeliveryLocale.placeholder")}
            />
          </Field>
        </div>
      </Card>

      {generalError ? (
        <p className={styles.generalError} role="alert">
          {generalError}
        </p>
      ) : null}

      <div className={styles.actions}>
        <Button type="submit" variant="primary" className={styles.submit} disabled={pending}>
          {pending ? t("creating") : t("createButton")}
        </Button>
      </div>
    </form>
  );
}
