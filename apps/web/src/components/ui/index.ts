/**
 * SignalFrame accessible UI primitives. All styling is token-driven
 * (app/globals.css) and works in light + dark automatically.
 */
export { cx } from "./cx.ts";
export type { ClassValue } from "./cx.ts";

export { Button } from "./Button.tsx";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./Button.tsx";

export { Card, Panel, DarkPanel } from "./Card.tsx";
export type {
  CardProps,
  PanelProps,
  DarkPanelProps,
  CardTone,
  CardPadding,
} from "./Card.tsx";

export { StatusPill } from "./StatusPill.tsx";
export type { StatusPillProps, StatusTone } from "./StatusPill.tsx";

export { Badge } from "./Badge.tsx";
export type { BadgeProps, BadgeTone } from "./Badge.tsx";

export { Field, useFieldControl } from "./Field.tsx";
export type { FieldProps, FieldControl } from "./Field.tsx";

export { TextInput } from "./TextInput.tsx";
export type { TextInputProps } from "./TextInput.tsx";

export { TextArea } from "./TextArea.tsx";
export type { TextAreaProps } from "./TextArea.tsx";

export { EmptyState } from "./EmptyState.tsx";
export type { EmptyStateProps } from "./EmptyState.tsx";

export { Spinner } from "./Spinner.tsx";
export type { SpinnerProps, SpinnerSize } from "./Spinner.tsx";

export { LocaleSwitch } from "./LocaleSwitch.tsx";
export type { LocaleSwitchProps } from "./LocaleSwitch.tsx";

export {
  LimitationHint,
  limitationPopoverPosition,
} from "./LimitationHint.tsx";
export type {
  LimitationHintProps,
  LimitationPopoverPosition,
} from "./LimitationHint.tsx";
