// @input  -- calculation parameters (rates, costs, traffic)
// @output -- sample size results, ROI results
// @pos    -- pure calculation functions for free tools, 100% test coverage required
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SampleSizeParams {
  baselineRate: number;
  minimumDetectableEffect: number;
  significanceLevel: 0.9 | 0.95 | 0.99;
  power: 0.8 | 0.9;
}

export interface SampleSizeResult {
  sampleSizePerVariation: number;
  totalSampleSize: number;
}

export interface ROIParams {
  monthlyTraffic: number;
  currentConversionRate: number;
  revenuePerCustomer: number;
  manualHoursPerWeek: number;
  hourlyCost: number;
}

export interface ROIResult {
  timeSavedPerMonth: number;
  costSavingsPerMonth: number;
  projectedConversionLift: number;
  projectedAdditionalRevenue: number;
  roiPercentage: number;
  paybackPeriodMonths: number;
}

// ---------------------------------------------------------------------------
// Z-score lookup tables
// ---------------------------------------------------------------------------

const Z_ALPHA_HALF: Record<number, number> = {
  0.9: 1.6449,
  0.95: 1.96,
  0.99: 2.576,
};

const Z_BETA: Record<number, number> = {
  0.8: 0.842,
  0.9: 1.282,
};

// ---------------------------------------------------------------------------
// calculateSampleSize
// ---------------------------------------------------------------------------
// Standard two-proportion z-test sample size formula:
// n = ceil( (Z_alpha/2 * sqrt(2*pBar*(1-pBar)) + Z_beta * sqrt(p1*(1-p1)+p2*(1-p2)))^2 / (p2-p1)^2 )

export function calculateSampleSize(
  params: SampleSizeParams,
): SampleSizeResult {
  const { baselineRate, minimumDetectableEffect, significanceLevel, power } =
    params;

  if (baselineRate <= 0 || baselineRate > 1) {
    throw new Error(`baselineRate must be in (0, 1], got ${baselineRate}`);
  }
  if (minimumDetectableEffect <= 0) {
    throw new Error(
      `minimumDetectableEffect must be > 0, got ${minimumDetectableEffect}`,
    );
  }

  const p1 = baselineRate;
  const p2 = p1 * (1 + minimumDetectableEffect);

  if (p2 > 1) {
    throw new Error(
      `Computed variant rate (${p2.toFixed(4)}) exceeds 1.0. Reduce baselineRate or MDE.`,
    );
  }
  const pBar = (p1 + p2) / 2;
  const delta = p2 - p1;

  const zAlpha = Z_ALPHA_HALF[significanceLevel];
  const zBeta = Z_BETA[power];

  const term1 = zAlpha * Math.sqrt(2 * pBar * (1 - pBar));
  const term2 = zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  const n = Math.pow(term1 + term2, 2) / Math.pow(delta, 2);

  const sampleSizePerVariation = Math.ceil(n);
  return {
    sampleSizePerVariation,
    totalSampleSize: sampleSizePerVariation * 2,
  };
}

// ---------------------------------------------------------------------------
// calculateGrowthROI
// ---------------------------------------------------------------------------
// Assumed monthly platform cost used for ROI calculation (Pro plan price)
const ASSUMED_MONTHLY_COST = 199;
const CONVERSION_LIFT = 0.15;
const HOURS_AUTOMATION_EFFICIENCY = 0.7;
const WEEKS_PER_MONTH = 4;

export function calculateGrowthROI(params: ROIParams): ROIResult {
  const {
    monthlyTraffic,
    currentConversionRate,
    revenuePerCustomer,
    manualHoursPerWeek,
    hourlyCost,
  } = params;

  if (monthlyTraffic < 0) {
    throw new Error(`monthlyTraffic must be >= 0, got ${monthlyTraffic}`);
  }
  if (currentConversionRate < 0 || currentConversionRate > 1) {
    throw new Error(
      `currentConversionRate must be in [0, 1], got ${currentConversionRate}`,
    );
  }
  if (revenuePerCustomer < 0) {
    throw new Error(
      `revenuePerCustomer must be >= 0, got ${revenuePerCustomer}`,
    );
  }
  if (manualHoursPerWeek < 0) {
    throw new Error(
      `manualHoursPerWeek must be >= 0, got ${manualHoursPerWeek}`,
    );
  }
  if (hourlyCost < 0) {
    throw new Error(`hourlyCost must be >= 0, got ${hourlyCost}`);
  }

  const timeSavedPerMonth =
    manualHoursPerWeek * WEEKS_PER_MONTH * HOURS_AUTOMATION_EFFICIENCY;
  const costSavingsPerMonth = timeSavedPerMonth * hourlyCost;

  const projectedConversionLift = CONVERSION_LIFT;
  const projectedAdditionalRevenue =
    monthlyTraffic *
    currentConversionRate *
    CONVERSION_LIFT *
    revenuePerCustomer;

  const totalMonthlyBenefit = costSavingsPerMonth + projectedAdditionalRevenue;
  const roiPercentage =
    ((totalMonthlyBenefit - ASSUMED_MONTHLY_COST) / ASSUMED_MONTHLY_COST) * 100;
  const paybackPeriodMonths =
    totalMonthlyBenefit > 0 ? ASSUMED_MONTHLY_COST / totalMonthlyBenefit : 0;

  return {
    timeSavedPerMonth,
    costSavingsPerMonth,
    projectedConversionLift,
    projectedAdditionalRevenue,
    roiPercentage,
    paybackPeriodMonths,
  };
}
