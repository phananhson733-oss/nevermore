"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, Field, TextArea, TextInput } from "@/components/ui";
import { ApiError, useCreateProject } from "@/lib/api";
import {
  mapProjectFieldErrors,
  type ProjectFieldErrors as FieldErrors,
} from "./_form-errors";
import styles from "./new-project.module.css";

/**
 * URL-first product creation. The command creates the primary Site and the
 * initial versioned Product Profile / ICP draft in one transaction. The
 * operator lands on that draft immediately so customer-declared facts can be
 * entered before any optional Crawl / AI assistance or provider connection.
 */

export function NewProjectForm() {
  const t = useTranslations("newProject");
  const router = useRouter();
  const mutation = useCreateProject();

  const [productUrl, setProductUrl] = useState("");
  const [businessHint, setBusinessHint] = useState("");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setFieldErrors({});
    setGeneralError(null);

    try {
      const trimmedBusinessHint = businessHint.trim();
      const project = await mutation.mutateAsync({
        mode: "product_profile",
        productUrl: productUrl.trim(),
        ...(trimmedBusinessHint
          ? { businessHint: trimmedBusinessHint }
          : {}),
      });
      router.push(`/p/${project.id}/context`);
    } catch (error) {
      if (error instanceof ApiError) {
        const mapped = mapProjectFieldErrors(error.fieldErrors(), {
          productUrlInvalid: t("productUrlInvalid"),
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
          <div className={styles.full}>
            <Field
              label={t("fields.productUrl.label")}
              help={t("fields.productUrl.help")}
              error={fieldErrors.productUrl}
              required
            >
              <TextInput
                type="url"
                inputMode="url"
                value={productUrl}
                onChange={(event) => setProductUrl(event.target.value)}
                placeholder={t("fields.productUrl.placeholder")}
                autoComplete="url"
                required
              />
            </Field>
          </div>

          <div className={styles.full}>
            <Field
              label={t("fields.businessHint.label")}
              help={t("fields.businessHint.help")}
              error={fieldErrors.businessHint}
            >
              <TextArea
                value={businessHint}
                onChange={(event) => setBusinessHint(event.target.value)}
                placeholder={t("fields.businessHint.placeholder")}
                rows={5}
                maxLength={1000}
              />
            </Field>
          </div>

          <div className={styles.nextStep}>
            <strong>{t("nextStep.title")}</strong>
            <p>{t("nextStep.detail")}</p>
          </div>
        </div>
      </Card>

      {generalError ? (
        <p className={styles.generalError} role="alert">
          {generalError}
        </p>
      ) : null}

      <div className={styles.actions}>
        <Button
          type="submit"
          variant="primary"
          className={styles.submit}
          disabled={pending}
        >
          {pending ? t("creating") : t("createButton")}
        </Button>
      </div>
    </form>
  );
}
