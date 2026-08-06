// @input  -- label, value, onChange, options props
// @output -- InputField, SelectField, ResultRow form sub-components
// @pos    -- shared form primitives for ab-test-calculator.tsx
// once this file is updated, update header comments and _DIR.md in this folder
"use client";

export function InputField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  optional,
}: {
  readonly label: string;
  readonly value: number | string;
  readonly onChange: (v: number) => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly optional?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-2 block font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
        {label}
      </span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        required={!optional}
        className="h-12.5 w-full rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 font-mono text-[14px] text-text-dark-primary outline-none transition-colors focus-visible:border-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent placeholder:text-text-dark-secondary"
      />
    </label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly options: ReadonlyArray<{
    readonly value: string;
    readonly label: string;
  }>;
}) {
  return (
    <label className="block">
      <span className="mb-2 block font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-12.5 w-full rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 font-mono text-[14px] text-text-dark-primary outline-none transition-colors focus-visible:border-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ResultRow({
  label,
  value,
  accent,
}: {
  readonly label: string;
  readonly value: string;
  readonly accent?: boolean;
}) {
  return (
    /* 指标格：外层网格用 1px gap + 分隔色底拼出伪表格，格子自己只负责底色和内距 */
    <div
      className={`bg-brand-panel-sunken px-5 py-4 ${
        accent ? "shadow-[inset_2px_0_0_#3DDC97]" : ""
      }`}
    >
      <p className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
        {label}
      </p>
      <p
        className={`mt-2 font-mono text-[22px] ${
          accent ? "text-brand-accent-text" : "text-text-dark-primary"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
