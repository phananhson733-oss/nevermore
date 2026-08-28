// @input  -- the loaded brief, the current settings and section selection, the translator
// @output -- tone / person / product-mention selects and one checkbox per writable section
// @pos    -- the settings table of handoff §5.1; the section list is planSections' order,
//            and the gap-angle home is the one draft-assemble names, so both sides agree

import type {
  ContentBrief,
  DraftResult,
} from "@sf/public-tools/content-brief/contract";
import {
  DRAFT_TOTAL_BUDGET_MS,
  SECTION_MAX_ATTEMPTS,
  SECTION_TIMEOUT_MS,
} from "@sf/public-tools/content-brief/constants";
import {
  gapAngleSectionId,
  planSections,
  type PlannedSection,
} from "@sf/public-tools/content-brief/draft-assemble";

import { PERSONS, PRODUCT_MENTIONS, TONES } from "./content-draft-codes";
import {
  BODY_TEXT,
  DATA_CHIP,
  ID_CHIP,
  chipTone,
  joinList,
  translated,
  type DraftTranslate,
} from "./content-draft-results-shared";

export type DraftSettings = DraftResult["settings"];

export const DEFAULT_DRAFT_SETTINGS: DraftSettings = {
  tone: "explanatory",
  person: "second",
  product_mention: "gap_only",
};

const FIELD_LABEL =
  "block font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase";
const FIELD =
  "mt-2 h-12.5 w-full rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 text-[13.5px] text-text-dark-primary outline-none focus-visible:border-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:opacity-60";
const HELP = "mt-2 text-[11.5px] leading-[1.5] text-text-dark-secondary";

/** The writable sections in outline order; empty when the brief has nothing writable. */
export function writableSections(brief: ContentBrief): readonly PlannedSection[] {
  const plan = planSections(brief, brief.draft_readiness.writable);
  return "ok" in plan ? [] : plan.requested;
}

function Select<Value extends string>({
  id,
  label,
  value,
  options,
  optionLabel,
  onChange,
  disabled,
  describedBy,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: Value;
  readonly options: readonly Value[];
  readonly optionLabel: (option: Value) => string;
  readonly onChange: (next: Value) => void;
  readonly disabled: boolean;
  readonly describedBy?: string;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className={FIELD_LABEL}>{label}</span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as Value)}
        disabled={disabled}
        aria-describedby={describedBy}
        className={FIELD}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {optionLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ContentDraftSettings({
  brief,
  settings,
  onSettings,
  selected,
  onToggleSection,
  disabled,
  locale,
  t,
}: {
  readonly brief: ContentBrief;
  readonly settings: DraftSettings;
  readonly onSettings: (next: DraftSettings) => void;
  readonly selected: ReadonlySet<string>;
  readonly onToggleSection: (id: string, checked: boolean) => void;
  readonly disabled: boolean;
  readonly locale: string;
  readonly t: DraftTranslate;
}) {
  const sections = writableSections(brief);
  const gapHome = gapAngleSectionId(brief);
  return (
    <div data-content-draft-settings>
      <h3 className="text-[15px] font-semibold text-text-dark-primary">{t("settings.title")}</h3>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Select
          id="content-draft-tone"
          label={t("settings.tone.label")}
          value={settings.tone}
          options={TONES}
          optionLabel={(tone) => translated(t, `settings.tone.${tone}`)}
          onChange={(tone) => onSettings({ ...settings, tone })}
          disabled={disabled}
        />
        <Select
          id="content-draft-person"
          label={t("settings.person.label")}
          value={settings.person}
          options={PERSONS}
          optionLabel={(person) => translated(t, `settings.person.${person}`)}
          onChange={(person) => onSettings({ ...settings, person })}
          disabled={disabled}
        />
        <div>
          <Select
            id="content-draft-product-mention"
            label={t("settings.productMention.label")}
            value={settings.product_mention}
            options={PRODUCT_MENTIONS}
            optionLabel={(mention) => translated(t, `settings.productMention.${mention}`)}
            onChange={(product_mention) => onSettings({ ...settings, product_mention })}
            disabled={disabled}
            describedBy="content-draft-product-mention-help"
          />
          <p id="content-draft-product-mention-help" data-product-mention-help className={HELP}>
            {gapHome === null
              ? t("settings.productMention.helpNoGap")
              : t("settings.productMention.help", { section: gapHome })}
            {settings.product_mention === "throughout" ? (
              <span data-product-mention-throughout className="mt-1 block text-brand-warning">
                {t("settings.productMention.helpThroughout")}
              </span>
            ) : null}
          </p>
        </div>
      </div>
      <fieldset className="mt-5" disabled={disabled}>
        <legend className={FIELD_LABEL}>{t("settings.sections.label")}</legend>
        <p className={HELP}>
          {t("settings.sections.help", {
            timeout: Math.round(SECTION_TIMEOUT_MS / 1000),
            budget: Math.round(DRAFT_TOTAL_BUDGET_MS / 1000),
            attempts: SECTION_MAX_ATTEMPTS,
          })}
        </p>
        <ul className="mt-3 space-y-2">
          {sections.map((section) => (
            <li key={section.id} data-section-option={section.id}>
              <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-brand-border-card bg-brand-bg px-3 py-2.5">
                <input
                  type="checkbox"
                  data-section-checkbox={section.id}
                  checked={selected.has(section.id)}
                  onChange={(event) => onToggleSection(section.id, event.target.checked)}
                  className="mt-1 h-4 w-4 accent-brand-accent"
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={ID_CHIP}>{section.id}</span>
                    <span className="text-[13.5px] font-semibold text-text-dark-primary">
                      {section.h2}
                    </span>
                  </span>
                  <span className="mt-1.5 flex flex-wrap gap-1.5">
                    <span className={`${DATA_CHIP} ${chipTone("neutral")}`}>
                      {t("settings.sections.answers", { ids: joinList(section.answers, locale) })}
                    </span>
                    {section.id === gapHome ? (
                      <span data-gap-angle-home className={`${DATA_CHIP} ${chipTone("caution")}`}>
                        {t("settings.sections.gapAngleHere")}
                      </span>
                    ) : null}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {sections.length === 0 ? (
        <p className={`mt-3 ${BODY_TEXT}`}>{t("intake.noWritable")}</p>
      ) : null}
    </div>
  );
}
