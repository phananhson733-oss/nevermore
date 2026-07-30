"use client";

import { useId, useState } from "react";
import type { FormEvent, SelectHTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  Card,
  Field,
  TextArea,
  TextInput,
  useFieldControl,
} from "@/components/ui";
import { ApiError, useCreateProject } from "@/lib/api";
import {
  mapProjectFieldErrors,
  type ProjectFieldKey,
  type ProjectFieldErrors as FieldErrors,
} from "./_form-errors";
import {
  buildCreateProductRequest,
  CUSTOMER_MODELS,
  GROWTH_OBJECTIVES,
  PRIMARY_MARKETS,
  validateNewProductValues,
  type CustomerModel,
  type GrowthObjective,
  type PrimaryMarket,
} from "./_form-values";
import styles from "./new-project.module.css";

/**
 * The customer supplies only facts they already know. The server creates the
 * versioned Product Profile draft; the next screen collects website evidence
 * and builds the AI-assisted ICP and competitor candidates.
 */

function SelectControl(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const field = useFieldControl();
  return (
    <select
      {...props}
      id={props.id ?? field?.controlId}
      aria-describedby={props["aria-describedby"] ?? field?.describedBy}
      aria-invalid={
        props["aria-invalid"] ?? (field?.invalid ? true : undefined)
      }
      required={props.required ?? field?.required}
      className={`${styles.select} ${props.className ?? ""}`}
    />
  );
}

export function NewProjectForm() {
  const t = useTranslations("newProject");
  const router = useRouter();
  const mutation = useCreateProject();

  const [productName, setProductName] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [customerModel, setCustomerModel] = useState<CustomerModel | "">("");
  const [primaryMarket, setPrimaryMarket] = useState<PrimaryMarket | "">("");
  const [growthObjectives, setGrowthObjectives] = useState<GrowthObjective[]>([]);
  const [businessHint, setBusinessHint] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const objectiveHelpId = useId();
  const objectiveErrorId = `${objectiveHelpId}-error`;

  function clearFieldError(field: ProjectFieldKey): void {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function submit(): Promise<void> {
    setFieldErrors({});
    setGeneralError(null);

    const values = {
      productName,
      productUrl,
      customerModel,
      primaryMarket,
      growthObjectives,
      businessHint,
    };
    const validation = validateNewProductValues(values);
    if (Object.keys(validation).length > 0) {
      const localized: FieldErrors = {};
      for (const [field, code] of Object.entries(validation)) {
        localized[field as ProjectFieldKey] =
          code === "invalid_url"
            ? t("productUrlInvalid")
            : code === "objective_required"
              ? t("growthObjectivesRequired")
              : t("requiredField");
      }
      setFieldErrors(localized);
      return;
    }

    try {
      const project = await mutation.mutateAsync(
        buildCreateProductRequest(values),
      );
      router.push(`/p/${project.id}/context`);
    } catch (error) {
      if (error instanceof ApiError) {
        const mapped = mapProjectFieldErrors(error.fieldErrors(), {
          productUrlInvalid: t("productUrlInvalid"),
          requiredField: t("requiredField"),
          growthObjectivesRequired: t("growthObjectivesRequired"),
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
              label={t("fields.productName.label")}
              help={t("fields.productName.help")}
              error={fieldErrors.productName}
              required
            >
              <TextInput
                value={productName}
                onChange={(event) => {
                  setProductName(event.target.value);
                  clearFieldError("productName");
                }}
                placeholder={t("fields.productName.placeholder")}
                autoComplete="organization"
                maxLength={160}
                required
              />
            </Field>
          </div>

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
                onChange={(event) => {
                  setProductUrl(event.target.value);
                  clearFieldError("productUrl");
                }}
                placeholder={t("fields.productUrl.placeholder")}
                autoComplete="url"
                required
              />
            </Field>
          </div>

          <Field
            label={t("fields.customerModel.label")}
            help={t("fields.customerModel.help")}
            error={fieldErrors.customerModel}
            required
          >
            <SelectControl
              value={customerModel}
              onChange={(event) => {
                setCustomerModel(event.target.value as CustomerModel | "");
                clearFieldError("customerModel");
              }}
              required
            >
              <option value="">{t("fields.choose")}</option>
              {CUSTOMER_MODELS.map((model) => (
                <option key={model} value={model}>
                  {t(`fields.customerModel.options.${model}`)}
                </option>
              ))}
            </SelectControl>
          </Field>

          <Field
            label={t("fields.primaryMarket.label")}
            help={t("fields.primaryMarket.help")}
            error={fieldErrors.primaryMarket}
            required
          >
            <SelectControl
              value={primaryMarket}
              onChange={(event) => {
                setPrimaryMarket(event.target.value as PrimaryMarket | "");
                clearFieldError("primaryMarket");
              }}
              required
            >
              <option value="">{t("fields.choose")}</option>
              {PRIMARY_MARKETS.map((market) => (
                <option key={market} value={market}>
                  {t(`fields.primaryMarket.options.${market}`)}
                </option>
              ))}
            </SelectControl>
          </Field>

          <fieldset
            className={`${styles.objectiveField} ${
              fieldErrors.growthObjectives ? styles.objectiveFieldInvalid : ""
            }`}
            aria-required="true"
            aria-invalid={fieldErrors.growthObjectives ? "true" : undefined}
            aria-describedby={`${objectiveHelpId}${
              fieldErrors.growthObjectives ? ` ${objectiveErrorId}` : ""
            }`}
          >
            <legend>
              {t("fields.growthObjectives.label")}
              <span aria-hidden="true"> *</span>
            </legend>
            <p id={objectiveHelpId}>{t("fields.growthObjectives.help")}</p>
            <div className={styles.objectiveGrid}>
              {GROWTH_OBJECTIVES.map((objective) => (
                <label key={objective} className={styles.objectiveChoice}>
                  <input
                    type="checkbox"
                    checked={growthObjectives.includes(objective)}
                    onChange={(event) => {
                      setGrowthObjectives((current) =>
                        event.target.checked
                          ? [...current, objective]
                          : current.filter((item) => item !== objective),
                      );
                      clearFieldError("growthObjectives");
                    }}
                  />
                  <span>{t(`fields.growthObjectives.options.${objective}`)}</span>
                </label>
              ))}
            </div>
            {fieldErrors.growthObjectives ? (
              <p id={objectiveErrorId} className={styles.fieldError} role="alert">
                {fieldErrors.growthObjectives}
              </p>
            ) : null}
          </fieldset>

          <div className={styles.full}>
            <Field
              label={t("fields.businessHint.label")}
              help={t("fields.businessHint.help")}
              error={fieldErrors.businessHint}
            >
              <TextArea
                value={businessHint}
                onChange={(event) => {
                  setBusinessHint(event.target.value);
                  clearFieldError("businessHint");
                }}
                placeholder={t("fields.businessHint.placeholder")}
                rows={4}
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
