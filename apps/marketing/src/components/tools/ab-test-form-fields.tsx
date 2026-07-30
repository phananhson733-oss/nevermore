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
      <span className="text-text-dark-secondary text-[13px] mb-1.5 block">
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
        className="w-full rounded-lg border border-brand-border/60 bg-brand-bg-alt/30 px-3 py-2 text-text-dark-primary text-[14px] outline-none transition-colors focus:border-[#D97757] placeholder:text-text-dark-secondary/40"
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
      <span className="text-text-dark-secondary text-[13px] mb-1.5 block">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-brand-border/60 bg-brand-bg-alt/30 px-3 py-2 text-text-dark-primary text-[14px] outline-none transition-colors focus:border-[#D97757]"
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
    <div>
      <p className="text-text-dark-secondary text-[13px] mb-1">{label}</p>
      <p
        className={`font-semibold text-[24px] tracking-tight ${
          accent ? "text-[#D97757]" : "text-text-dark-primary"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
