"use client";

// @input  -- the signed-in visitor's knowledge base for one site
// @output -- an editor, a freeze control that states what still blocks it, and the questions a frozen version produces
// @pos    -- the only client surface of /tools/geo-knowledge-base; it edits and renders, it never decides

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import {
  GEO_KB_LIMITS,
  GEO_KB_SCHEMA_VERSION,
  type GeoKbBlocker,
  type GeoKbCompetitor,
  type GeoKbFact,
  type GeoKbPayload,
  type GeoKbRole,
} from "../../lib/geo-tools/kb-contract.ts";

const ENDPOINTS = {
  load: "/api/tools/geo-knowledge-base/load",
  draft: "/api/tools/geo-knowledge-base/draft",
  freeze: "/api/tools/geo-knowledge-base/freeze",
  import: "/api/tools/geo-knowledge-base/import",
} as const;

const FACT_REASONS = [
  "notPublished",
  "fetchFailed",
  "lowConfidence",
  "conflicting",
] as const;

/** Two of the markets the sampling provider is calibrated for. */
const COUNTRIES = ["US", "GB"] as const;

interface FrozenSummary {
  readonly snapshotId: string;
  readonly revision: number;
  readonly frozenAt: string;
  readonly contentHash: string;
  readonly questionCount: number;
  readonly retrievalCount: number;
}

interface QuestionPreview {
  readonly id: string;
  readonly text: string;
  readonly layer: string;
  readonly mode: "retrieval" | "demand";
  readonly calibrated: boolean;
}

interface KbView {
  readonly kbId: string;
  readonly origin: string;
  readonly host: string;
  readonly draftVersion: number;
  readonly payload: GeoKbPayload;
  readonly frozen: FrozenSummary | null;
  readonly importAvailable: boolean;
}

type Status =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "error"; readonly code: string; readonly reason?: string }
  | { readonly kind: "saved"; readonly at: string }
  | { readonly kind: "frozen"; readonly revision: number; readonly reused: boolean };

function ChipsField({
  label,
  help,
  values,
  max,
  onChange,
}: {
  readonly label: string;
  readonly help: string;
  readonly values: readonly string[];
  readonly max: number;
  readonly onChange: (next: readonly string[]) => void;
}) {
  const [text, setText] = useState("");
  const commit = useCallback(() => {
    const cleaned = text.trim();
    if (cleaned.length === 0 || values.includes(cleaned)) return;
    if (values.length >= max) return;
    onChange([...values, cleaned]);
    setText("");
  }, [max, onChange, text, values]);

  return (
    <div>
      <span className="block text-[13px] text-text-dark-secondary">{label}</span>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {values.map((value) => (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-brand-border-card bg-brand-bg px-2.5 py-1 text-[13px] text-text-dark-primary"
            key={value}
          >
            {value}
            <button
              aria-label={`${label}: ${value}`}
              className="text-text-dark-secondary"
              onClick={() => onChange(values.filter((entry) => entry !== value))}
              type="button"
            >
              x
            </button>
          </span>
        ))}
      </div>
      <input
        className="mt-2 w-full rounded-lg border border-brand-border-card bg-brand-bg px-3 py-2 text-[14.5px] text-text-dark-primary"
        maxLength={GEO_KB_LIMITS.listItem}
        // Committing on comma would empty the box under the cursor mid-word.
        // Enter and blur are both deliberate acts; typing is not.
        onBlur={commit}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commit();
        }}
        value={text}
      />
      <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
        {help}
      </p>
    </div>
  );
}

function TextField({
  label,
  help,
  placeholder,
  value,
  onChange,
}: {
  readonly label: string;
  readonly help?: string;
  readonly placeholder?: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
}) {
  return (
    <div>
      <span className="block text-[13px] text-text-dark-secondary">{label}</span>
      <input
        className="mt-1.5 w-full rounded-lg border border-brand-border-card bg-brand-bg px-3 py-2 text-[14.5px] text-text-dark-primary"
        maxLength={GEO_KB_LIMITS.text}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
      {help === undefined ? null : (
        <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
          {help}
        </p>
      )}
    </div>
  );
}

export function GeoKnowledgeBase({
  locale,
  signedIn,
}: {
  readonly locale: string;
  readonly signedIn: boolean;
}) {
  const t = useTranslations("tools.geoKnowledgeBase");
  const [siteUrl, setSiteUrl] = useState("");
  const [view, setView] = useState<KbView | null>(null);
  const [payload, setPayload] = useState<GeoKbPayload | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [blockers, setBlockers] = useState<readonly GeoKbBlocker[]>([]);
  const [questions, setQuestions] = useState<readonly QuestionPreview[] | null>(
    null,
  );
  const [showQuestions, setShowQuestions] = useState(false);
  const [dirty, setDirty] = useState(false);

  const post = useCallback(
    async (
      url: string,
      body: unknown,
    ): Promise<
      | { readonly ok: true; readonly data: unknown }
      | { readonly ok: false; readonly code: string; readonly reason?: string; readonly blockers?: readonly GeoKbBlocker[] }
    > => {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const parsed = (await response.json()) as {
          readonly data?: unknown;
          readonly error?: { readonly code?: string };
          readonly reason?: string;
          readonly blockers?: readonly GeoKbBlocker[];
        };
        if (response.ok && parsed.data !== undefined) {
          return { ok: true, data: parsed.data };
        }
        return {
          ok: false,
          code: parsed.error?.code ?? "network",
          ...(parsed.reason === undefined ? {} : { reason: parsed.reason }),
          ...(parsed.blockers === undefined ? {} : { blockers: parsed.blockers }),
        };
      } catch {
        return { ok: false, code: "network" };
      }
    },
    [],
  );

  const load = useCallback(async () => {
    const url = siteUrl.trim();
    if (url.length === 0) return;
    setStatus({ kind: "busy" });
    const result = await post(ENDPOINTS.load, { url });
    if (!result.ok) {
      setStatus({ kind: "error", code: result.code });
      return;
    }
    const next = result.data as KbView;
    setView(next);
    setPayload(next.payload);
    setQuestions(null);
    setShowQuestions(false);
    setDirty(false);
    setStatus({ kind: "idle" });
  }, [post, siteUrl]);

  const save = useCallback(async () => {
    if (view === null || payload === null) return;
    setStatus({ kind: "busy" });
    const result = await post(ENDPOINTS.draft, {
      kbId: view.kbId,
      payload,
      baseVersion: view.draftVersion,
    });
    if (!result.ok) {
      setStatus({
        kind: "error",
        code: result.code,
        ...(result.reason === undefined ? {} : { reason: result.reason }),
      });
      return;
    }
    const data = result.data as {
      readonly draftVersion: number;
      readonly updatedAt: string;
      readonly blockers: readonly GeoKbBlocker[];
    };
    setView({ ...view, draftVersion: data.draftVersion, payload });
    setBlockers(data.blockers);
    setDirty(false);
    setStatus({ kind: "saved", at: data.updatedAt });
  }, [payload, post, view]);

  const freeze = useCallback(async () => {
    if (view === null) return;
    setStatus({ kind: "busy" });
    const result = await post(ENDPOINTS.freeze, {
      kbId: view.kbId,
      baseVersion: view.draftVersion,
    });
    if (!result.ok) {
      if (result.blockers !== undefined) setBlockers(result.blockers);
      setStatus({
        kind: "error",
        code: result.code,
        ...(result.reason === undefined ? {} : { reason: result.reason }),
      });
      return;
    }
    const data = result.data as FrozenSummary & {
      readonly reusedExisting: boolean;
      readonly questions: readonly QuestionPreview[];
    };
    setView({
      ...view,
      frozen: {
        snapshotId: data.snapshotId,
        revision: data.revision,
        frozenAt: data.frozenAt,
        contentHash: data.contentHash,
        questionCount: data.questionCount,
        retrievalCount: data.retrievalCount,
      },
    });
    setQuestions(data.questions);
    setStatus({
      kind: "frozen",
      revision: data.revision,
      reused: data.reusedExisting,
    });
  }, [post, view]);

  const prefill = useCallback(async () => {
    if (view === null) return;
    setStatus({ kind: "busy" });
    const result = await post(ENDPOINTS.import, { kbId: view.kbId });
    if (!result.ok) {
      setStatus({ kind: "error", code: result.code });
      return;
    }
    const data = result.data as { readonly payload: GeoKbPayload };
    setPayload(data.payload);
    setDirty(true);
    setStatus({ kind: "idle" });
  }, [post, view]);

  const update = useCallback((next: Partial<GeoKbPayload>) => {
    setPayload((current) =>
      current === null ? current : { ...current, ...next },
    );
    setDirty(true);
  }, []);

  useEffect(() => {
    if (payload === null) return;
    // Blockers are recomputed locally so the freeze control explains itself
    // before the request rather than after it.
    const next: GeoKbBlocker[] = [];
    if (payload.officialName.trim().length === 0) {
      next.push("official_name_missing");
    }
    if (payload.aliases.length === 0) next.push("aliases_missing");
    if (payload.categoryTerms.length === 0) next.push("category_terms_missing");
    if (payload.roles.length === 0) next.push("role_missing");
    if (!payload.competitors.some((entry) => entry.confirmed)) {
      next.push("no_confirmed_competitor");
    }
    setBlockers(next);
  }, [payload]);

  const genericCategory = useMemo(() => {
    const first = payload?.categoryTerms[0]?.toLowerCase().trim() ?? "";
    return ["tool", "tools", "software", "platform", "platforms", "app", "apps"].includes(
      first,
    );
  }, [payload]);

  if (!signedIn) {
    return (
      <section className="mt-10 rounded-xl border border-brand-border-card bg-brand-panel p-6 md:p-7">
        <h2 className="text-[19px] text-text-dark-primary">
          {t("signIn.title")}
        </h2>
        <p className="mt-3 max-w-[640px] text-[14px] leading-[1.7] text-text-dark-secondary">
          {t("signIn.body")}
        </p>
      </section>
    );
  }

  return (
    <div className="mt-10 grid gap-8">
      <section className="rounded-xl border border-brand-border-card bg-brand-panel p-6 md:p-7">
        <h2 className="text-[19px] text-text-dark-primary">{t("site.title")}</h2>
        <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto] md:items-start">
          <div>
            <label
              className="block text-[13px] text-text-dark-secondary"
              htmlFor="kb-site-url"
            >
              {t("site.urlLabel")}
            </label>
            <input
              className="mt-1.5 w-full rounded-lg border border-brand-border-card bg-brand-bg px-3 py-2 text-[14.5px] text-text-dark-primary"
              id="kb-site-url"
              inputMode="url"
              maxLength={2_048}
              onChange={(event) => setSiteUrl(event.target.value)}
              placeholder={t("site.urlPlaceholder")}
              value={siteUrl}
            />
            <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
              {t("site.urlHelp")}
            </p>
          </div>
          <button
            className="mt-6 rounded-lg bg-brand-accent px-4 py-2 text-[14px] font-medium text-brand-on-accent disabled:opacity-60"
            disabled={status.kind === "busy"}
            onClick={() => {
              void load();
            }}
            type="button"
          >
            {view === null ? t("site.start") : t("site.switch")}
          </button>
        </div>
        {status.kind === "error" ? (
          <p className="mt-4 text-[13.5px] text-brand-error" role="alert">
            {status.reason === undefined
              ? t(`errors.${status.code}`)
              : t("errors.invalid_payload", { reason: status.reason })}
          </p>
        ) : null}
      </section>

      {view !== null && payload !== null ? (
        <>
          <section className="rounded-xl border border-brand-border-card bg-brand-panel p-6 md:p-7">
            <h2 className="text-[19px] text-text-dark-primary">
              {t("site.importTitle")}
            </h2>
            <p className="mt-2 max-w-[640px] text-[13.5px] leading-[1.7] text-text-dark-secondary">
              {t("site.importBody")}
            </p>
            {view.importAvailable ? (
              <button
                className="mt-4 rounded-lg border border-brand-border-card px-3 py-1.5 text-[13px] text-text-dark-primary"
                disabled={status.kind === "busy"}
                onClick={() => {
                  void prefill();
                }}
                type="button"
              >
                {t("site.importAction")}
              </button>
            ) : (
              <p className="mt-4 text-[13px] text-text-dark-secondary">
                {t("site.importUnavailable")}
              </p>
            )}
            {payload.importedFrom !== null ? (
              <p className="mt-3 text-[13px] text-text-dark-secondary">
                {t("site.importedFrom", {
                  revision: payload.importedFrom.snapshotRevision,
                })}
              </p>
            ) : null}
          </section>

          <section className="rounded-xl border border-brand-border-card bg-brand-panel p-6 md:p-7">
            <h2 className="text-[19px] text-text-dark-primary">
              {t("brand.title")}
            </h2>
            <div className="mt-5 grid gap-5">
              <TextField
                help={t("brand.officialNameHelp")}
                label={t("brand.officialNameLabel")}
                onChange={(value) => update({ officialName: value })}
                placeholder={t("brand.officialNamePlaceholder")}
                value={payload.officialName}
              />
              <ChipsField
                help={t("brand.aliasesHelp")}
                label={t("brand.aliasesLabel")}
                max={GEO_KB_LIMITS.aliases}
                onChange={(values) => update({ aliases: values })}
                values={payload.aliases}
              />
              <div>
                <ChipsField
                  help={t("brand.categoryHelp")}
                  label={t("brand.categoryLabel")}
                  max={GEO_KB_LIMITS.categoryTerms}
                  onChange={(values) => update({ categoryTerms: values })}
                  values={payload.categoryTerms}
                />
                {genericCategory ? (
                  <p className="mt-2 text-[13px] leading-[1.7] text-brand-error">
                    {t("brand.categoryWarning")}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label
                    className="block text-[13px] text-text-dark-secondary"
                    htmlFor="kb-country"
                  >
                    {t("brand.countryLabel")}
                  </label>
                  <select
                    className="mt-1.5 w-full rounded-lg border border-brand-border-card bg-brand-bg px-3 py-2 text-[14.5px] text-text-dark-primary"
                    id="kb-country"
                    onChange={(event) =>
                      update({
                        market: {
                          country: event.target.value,
                          language: payload.market.language,
                        },
                      })
                    }
                    value={payload.market.country}
                  >
                    {COUNTRIES.map((country) => (
                      <option key={country} value={country}>
                        {country}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <span className="block text-[13px] text-text-dark-secondary">
                    {t("brand.languageLabel")}
                  </span>
                  <p className="mt-1.5 rounded-lg border border-dashed border-brand-border-card px-3 py-2 text-[14px] text-text-dark-secondary">
                    en
                  </p>
                  <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
                    {t("brand.languageNote")}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-brand-border-card bg-brand-panel p-6 md:p-7">
            <h2 className="text-[19px] text-text-dark-primary">
              {t("roles.title")}
            </h2>
            <p className="mt-2 max-w-[640px] text-[13.5px] leading-[1.7] text-text-dark-secondary">
              {t("roles.intro")}
            </p>
            {payload.roles.length === 0 ? (
              <p className="mt-4 text-[13px] text-text-dark-secondary">
                {t("roles.empty")}
              </p>
            ) : null}
            <div className="mt-5 grid gap-5">
              {payload.roles.map((role, index) => (
                <div
                  className="grid gap-4 rounded-lg border border-brand-border-card p-4"
                  key={role.id}
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <TextField
                      label={t("roles.labelLabel")}
                      onChange={(value) =>
                        update({
                          roles: payload.roles.map((entry, position) =>
                            position === index
                              ? { ...entry, label: value }
                              : entry,
                          ),
                        })
                      }
                      placeholder={t("roles.labelPlaceholder")}
                      value={role.label}
                    />
                    <TextField
                      label={t("roles.segmentLabel")}
                      onChange={(value) =>
                        update({
                          roles: payload.roles.map((entry, position) =>
                            position === index
                              ? { ...entry, segment: value }
                              : entry,
                          ),
                        })
                      }
                      placeholder={t("roles.segmentPlaceholder")}
                      value={role.segment}
                    />
                  </div>
                  {(
                    [
                      ["painPoints", t("roles.painLabel")],
                      ["decisionCriteria", t("roles.criteriaLabel")],
                      ["vocabulary", t("roles.vocabularyLabel")],
                    ] as const
                  ).map(([field, label]) => (
                    <ChipsField
                      help=""
                      key={field}
                      label={label}
                      max={12}
                      onChange={(values) =>
                        update({
                          roles: payload.roles.map((entry, position) =>
                            position === index
                              ? ({ ...entry, [field]: values } as GeoKbRole)
                              : entry,
                          ),
                        })
                      }
                      values={role[field]}
                    />
                  ))}
                  <button
                    className="justify-self-start text-[13px] text-text-dark-secondary underline"
                    onClick={() =>
                      update({
                        roles: payload.roles.filter(
                          (_entry, position) => position !== index,
                        ),
                      })
                    }
                    type="button"
                  >
                    {t("roles.remove")}
                  </button>
                </div>
              ))}
            </div>
            <button
              className="mt-5 rounded-lg border border-brand-border-card px-3 py-1.5 text-[13px] text-text-dark-primary disabled:opacity-60"
              disabled={payload.roles.length >= GEO_KB_LIMITS.roles}
              onClick={() =>
                update({
                  roles: [
                    ...payload.roles,
                    {
                      id: `role-${String(payload.roles.length + 1)}-${String(
                        Date.now(),
                      )}`,
                      label: "",
                      segment: "",
                      painPoints: [],
                      decisionCriteria: [],
                      vocabulary: [],
                    },
                  ],
                })
              }
              type="button"
            >
              {t("roles.add")}
            </button>
          </section>

          <section className="rounded-xl border border-brand-border-card bg-brand-panel p-6 md:p-7">
            <h2 className="text-[19px] text-text-dark-primary">
              {t("competitors.title")}
            </h2>
            <p className="mt-2 max-w-[640px] text-[13.5px] leading-[1.7] text-text-dark-secondary">
              {t("competitors.intro")}
            </p>
            {payload.competitors.length === 0 ? (
              <p className="mt-4 text-[13px] text-text-dark-secondary">
                {t("competitors.empty")}
              </p>
            ) : null}
            <div className="mt-5 grid gap-4">
              {payload.competitors.map((competitor, index) => {
                const patch = (next: Partial<GeoKbCompetitor>) =>
                  update({
                    competitors: payload.competitors.map((entry, position) =>
                      position === index ? { ...entry, ...next } : entry,
                    ),
                  });
                return (
                  <div
                    className="grid gap-3 rounded-lg border border-brand-border-card p-4 md:grid-cols-[1fr_1fr_auto_auto] md:items-end"
                    key={`${competitor.domain}-${competitor.brandName}-${String(index)}`}
                  >
                    <TextField
                      label={t("competitors.domainLabel")}
                      onChange={(value) => patch({ domain: value })}
                      value={competitor.domain}
                    />
                    <TextField
                      label={t("competitors.brandLabel")}
                      onChange={(value) => patch({ brandName: value })}
                      value={competitor.brandName}
                    />
                    <label className="flex items-center gap-2 text-[13px] text-text-dark-secondary">
                      <input
                        checked={competitor.confirmed}
                        disabled={competitor.brandName.trim().length === 0}
                        onChange={(event) =>
                          patch({ confirmed: event.target.checked })
                        }
                        type="checkbox"
                      />
                      {t("competitors.confirmLabel")}
                    </label>
                    <button
                      className="text-[13px] text-text-dark-secondary underline"
                      onClick={() =>
                        update({
                          competitors: payload.competitors.filter(
                            (_entry, position) => position !== index,
                          ),
                        })
                      }
                      type="button"
                    >
                      {t("competitors.remove")}
                    </button>
                    {competitor.confirmed ? null : (
                      <p className="text-[12.5px] text-text-dark-secondary md:col-span-4">
                        {t("competitors.unconfirmed")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <button
              className="mt-5 rounded-lg border border-brand-border-card px-3 py-1.5 text-[13px] text-text-dark-primary disabled:opacity-60"
              disabled={payload.competitors.length >= GEO_KB_LIMITS.competitors}
              onClick={() =>
                update({
                  competitors: [
                    ...payload.competitors,
                    { domain: "", brandName: "", confirmed: false },
                  ],
                })
              }
              type="button"
            >
              {t("competitors.add")}
            </button>
          </section>

          <section className="rounded-xl border border-brand-border-card bg-brand-panel p-6 md:p-7">
            <h2 className="text-[19px] text-text-dark-primary">
              {t("facts.title")}
            </h2>
            <p className="mt-2 max-w-[640px] text-[13.5px] leading-[1.7] text-text-dark-secondary">
              {t("facts.intro")}
            </p>
            {payload.facts.length === 0 ? (
              <p className="mt-4 text-[13px] text-text-dark-secondary">
                {t("facts.empty")}
              </p>
            ) : null}
            <div className="mt-5 grid gap-4">
              {payload.facts.map((fact, index) => {
                const patch = (next: Partial<GeoKbFact>) =>
                  update({
                    facts: payload.facts.map((entry, position) =>
                      position === index ? { ...entry, ...next } : entry,
                    ),
                  });
                return (
                  <div
                    className="grid gap-3 rounded-lg border border-brand-border-card p-4 md:grid-cols-2"
                    key={`${fact.key}-${String(index)}`}
                  >
                    <TextField
                      label={t("facts.keyLabel")}
                      onChange={(value) => patch({ key: value })}
                      placeholder={t("facts.keyPlaceholder")}
                      value={fact.key}
                    />
                    <TextField
                      label={t("facts.valueLabel")}
                      onChange={(value) => patch({ value })}
                      value={fact.value}
                    />
                    <TextField
                      label={t("facts.sourceLabel")}
                      onChange={(value) => patch({ sourceUrl: value })}
                      value={fact.sourceUrl}
                    />
                    <TextField
                      label={t("facts.observedLabel")}
                      onChange={(value) => patch({ observedAt: value })}
                      value={fact.observedAt}
                    />
                    {fact.value.trim().length === 0 ? (
                      <div>
                        <label
                          className="block text-[13px] text-text-dark-secondary"
                          htmlFor={`kb-fact-reason-${String(index)}`}
                        >
                          {t("facts.reasonLabel")}
                        </label>
                        <select
                          className="mt-1.5 w-full rounded-lg border border-brand-border-card bg-brand-bg px-3 py-2 text-[14.5px] text-text-dark-primary"
                          id={`kb-fact-reason-${String(index)}`}
                          onChange={(event) =>
                            patch({
                              reason: event.target.value as GeoKbFact["reason"],
                            })
                          }
                          value={fact.reason}
                        >
                          <option value="">-</option>
                          {FACT_REASONS.map((reason) => (
                            <option key={reason} value={reason}>
                              {t(`facts.reasons.${reason}`)}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                    <button
                      className="justify-self-start text-[13px] text-text-dark-secondary underline"
                      onClick={() =>
                        update({
                          facts: payload.facts.filter(
                            (_entry, position) => position !== index,
                          ),
                        })
                      }
                      type="button"
                    >
                      {t("facts.remove")}
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              className="mt-5 rounded-lg border border-brand-border-card px-3 py-1.5 text-[13px] text-text-dark-primary disabled:opacity-60"
              disabled={payload.facts.length >= GEO_KB_LIMITS.facts}
              onClick={() =>
                update({
                  facts: [
                    ...payload.facts,
                    {
                      key: "",
                      value: "",
                      reason: "",
                      sourceUrl: "",
                      observedAt: "",
                    },
                  ],
                })
              }
              type="button"
            >
              {t("facts.add")}
            </button>
          </section>

          <section className="rounded-xl border border-brand-border-card bg-brand-panel p-6 md:p-7">
            <h2 className="text-[19px] text-text-dark-primary">
              {t("freeze.title")}
            </h2>
            <p className="mt-2 max-w-[640px] text-[13.5px] leading-[1.7] text-text-dark-secondary">
              {t("freeze.intro")}
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                className="rounded-lg border border-brand-border-card px-3 py-1.5 text-[13px] text-text-dark-primary disabled:opacity-60"
                disabled={status.kind === "busy"}
                onClick={() => {
                  void save();
                }}
                type="button"
              >
                {status.kind === "busy" ? t("draft.saving") : t("draft.save")}
              </button>
              <button
                className="rounded-lg bg-brand-accent px-4 py-2 text-[14px] font-medium text-brand-on-accent disabled:opacity-60"
                disabled={
                  status.kind === "busy" || blockers.length > 0 || dirty
                }
                onClick={() => {
                  void freeze();
                }}
                type="button"
              >
                {t("freeze.action")}
              </button>
              {dirty ? (
                <span className="text-[13px] text-text-dark-secondary">
                  {t("draft.unsaved")}
                </span>
              ) : null}
              {status.kind === "saved" ? (
                <span className="text-[13px] text-text-dark-secondary">
                  {t("draft.saved", {
                    time: new Intl.DateTimeFormat(
                      locale === "zh" ? "zh-CN" : "en-GB",
                      { timeStyle: "short", timeZone: "UTC" },
                    ).format(new Date(status.at)),
                  })}
                </span>
              ) : null}
            </div>

            {blockers.length > 0 ? (
              <div className="mt-4">
                <p className="text-[13.5px] text-text-dark-primary">
                  {t("freeze.blocked")}
                </p>
                <ul className="mt-2 grid gap-1.5">
                  {blockers.map((blocker) => (
                    <li
                      className="text-[13px] text-text-dark-secondary"
                      key={blocker}
                    >
                      {t(`freeze.blockers.${blocker}`)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {status.kind === "error" ? (
              <p className="mt-4 text-[13.5px] text-brand-error" role="alert">
                {status.reason === undefined
                  ? t(`errors.${status.code}`)
                  : t("errors.invalid_payload", { reason: status.reason })}
              </p>
            ) : null}

            <div className="mt-5 grid gap-2 text-[13px] text-text-dark-secondary">
              {view.frozen === null ? (
                <p>{t("freeze.none")}</p>
              ) : (
                <>
                  <p>
                    {t("freeze.current", {
                      revision: view.frozen.revision,
                      time: new Intl.DateTimeFormat(
                        locale === "zh" ? "zh-CN" : "en-GB",
                        { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" },
                      ).format(new Date(view.frozen.frozenAt)),
                    })}
                  </p>
                  <p>
                    {t("freeze.questions", {
                      count: view.frozen.questionCount,
                      retrieval: view.frozen.retrievalCount,
                    })}
                  </p>
                </>
              )}
              {status.kind === "frozen" && status.reused ? (
                <p>{t("freeze.reused", { revision: status.revision })}</p>
              ) : null}
            </div>

            {questions !== null ? (
              <div className="mt-5">
                <button
                  className="rounded-lg border border-brand-border-card px-3 py-1.5 text-[13px] text-text-dark-primary"
                  onClick={() => setShowQuestions((current) => !current)}
                  type="button"
                >
                  {showQuestions ? t("freeze.hidePreview") : t("freeze.preview")}
                </button>
                {showQuestions ? (
                  <div className="mt-4">
                    <p className="text-[12.5px] leading-[1.7] text-text-dark-secondary">
                      {t("questions.modeNote")}
                    </p>
                    <ul className="mt-3 grid gap-3">
                      {questions.map((question) => (
                        <li
                          className="grid gap-1 border-b border-brand-border-card pb-3 last:border-b-0"
                          key={question.id}
                        >
                          <span className="text-[14px] text-text-dark-primary">
                            {question.text}
                          </span>
                          <span className="text-[12.5px] text-text-dark-secondary">
                            {t(`questions.layers.${question.layer}`)} ·{" "}
                            {t(`questions.modes.${question.mode}`)}
                            {question.calibrated
                              ? ""
                              : ` · ${t("questions.uncalibrated")}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      <p className="sr-only">{GEO_KB_SCHEMA_VERSION}</p>
    </div>
  );
}
