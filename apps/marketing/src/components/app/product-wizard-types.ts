// @input  -- (none)
// @output -- WizardStepProps and related types for ProductWizard step components
// @pos    -- Products module, shared type definitions for ProductWizard (SPEC 3.3)
// Once this file is updated, update the header comment and the folder _DIR.md

/** Props shared by step 1 (URL input) */
export interface StepUrlProps {
  readonly productUrl: string;
  readonly onProductUrlChange: (value: string) => void;
}

/** Props shared by step 2 (region selection) */
export interface StepRegionsProps {
  readonly targetRegions: readonly string[];
  readonly onToggleRegion: (region: string) => void;
}

/** Props shared by step 3 (experiment goal) */
export interface StepGoalProps {
  readonly experimentGoal: string;
  readonly onExperimentGoalChange: (value: string) => void;
}

/** Props shared by step 4 (conversion event + optional advanced settings) */
export interface StepEventProps {
  readonly conversionEvent: string;
  readonly onConversionEventChange: (value: string) => void;
  readonly showAdvanced?: boolean;
  readonly onToggleAdvanced?: () => void;
  readonly languageOverride?: string;
  readonly onLanguageOverrideChange?: (value: string) => void;
  readonly productionCapOverride?: string;
  readonly onProductionCapOverrideChange?: (value: string) => void;
  readonly brandSafetyPolicy?: string;
  readonly onBrandSafetyPolicyChange?: (value: string) => void;
}
