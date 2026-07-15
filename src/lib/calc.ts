// ============================================================================
// Milk collection calculation engine.
//
// Reimplemented (clean-room) from the behaviour observed in the original app:
//   kg_fat   = round(fat * weight / 100)          [e2(fat, weight)]
//   kg_snf   = round(snf * weight / 100)          [e2(snf, weight)]
//   rate     = looked up from the fat->rate chart by fat value
//   price    = weight * rate
//   kapat    = weight * deduction% / 100          [pf_kapat]
//   payPrice = price - kapat
//   SNF from CLR (when analyzer/CLR used): SNF = CLR/4 + 0.21*fat + 0.36  (ISI-style)
// ============================================================================

export type RateEntry = { fat: number; snf?: number | null; rate: number };

export type MilkCalcInput = {
  weight: number;
  fat: number;
  snf?: number;
  clr?: number;
  deductionPct?: number; // per-litre "kapat" %
  roundTo?: number;      // 0 = 2 decimals, 1 = 1 decimal, 2 = integer
};

export type MilkCalcResult = {
  weight: number;
  fat: number;
  snf: number;
  rate: number;
  price: number;
  kgFat: number;
  kgSnf: number;
  deduction: number;
  payPrice: number;
};

/** Round using the society's rounding preference (mirrors amount_round setting). */
export function roundVal(v: number, mode = 0): number {
  if (!isFinite(v)) return 0;
  if (mode === 2) return Math.round(v);          // whole rupees
  if (mode === 1) return Math.round(v * 10) / 10; // 1 decimal
  return Math.round(v * 100) / 100;               // 2 decimals (default)
}

/** Round to a fixed number of decimal places (independent of the society mode). */
export function roundDp(v: number, dp = 2): number {
  if (!isFinite(v)) return 0;
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
}

/** SNF from CLR + fat (ISI-style), used when a lactometer/analyzer supplies CLR. */
export function snfFromClr(clr: number, fat: number): number {
  return roundVal(clr / 4 + 0.21 * fat + 0.36, 1);
}

/**
 * Generate a dense fat→rate chart from a single "rate per fat point" value.
 * rate(fat) = fat * perPoint. This is the simplest common dairy pricing model.
 */
export function linearRateChart(
  perPoint: number,
  minFat = 3.0,
  maxFat = 12.0,
  step = 0.1
): RateEntry[] {
  const out: RateEntry[] = [];
  for (let f = minFat; f <= maxFat + 1e-9; f += step) {
    const fat = Math.round(f * 10) / 10;
    out.push({ fat, rate: Math.round(fat * perPoint * 100) / 100 });
  }
  return out;
}

/**
 * Look up the ₹/litre rate for a given fat (and optionally snf) from a chart.
 * Matches the highest chart step that is <= the measured fat (floor match) —
 * the standard behaviour of a printed fat/rate table. Returns 0 if below the
 * lowest step.
 */
export function lookupRate(
  chart: RateEntry[],
  fat: number,
  snf?: number
): number {
  if (!chart.length) return 0;
  // fat_snf method: prefer exact (fat, snf) grid match, else nearest fat row.
  const usesSnf = snf != null && chart.some((e) => e.snf != null);
  if (usesSnf) {
    const exact = chart.find(
      (e) => Math.abs(e.fat - fat) < 0.05 && Math.abs((e.snf ?? 0) - (snf ?? 0)) < 0.05
    );
    if (exact) return exact.rate;
  }
  // floor match on fat
  const sorted = [...chart].sort((a, b) => a.fat - b.fat);
  let rate = 0;
  for (const e of sorted) {
    if (e.fat <= fat + 1e-9) rate = e.rate;
    else break;
  }
  return rate;
}

/** Full per-entry computation for one milk collection row. */
export function computeMilk(
  input: MilkCalcInput,
  chart: RateEntry[]
): MilkCalcResult {
  const round = input.roundTo ?? 0;
  const weight = input.weight || 0;
  const fat = input.fat || 0;
  const snf =
    input.snf != null && input.snf > 0
      ? input.snf
      : input.clr != null && input.clr > 0
      ? snfFromClr(input.clr, fat)
      : 0;

  const rate = lookupRate(chart, fat, snf > 0 ? snf : undefined);
  const price = roundVal(weight * rate, round);
  const kgFat = roundDp((fat * weight) / 100, 2);
  const kgSnf = roundDp((snf * weight) / 100, 2);
  const deduction = roundVal((weight * (input.deductionPct || 0)) / 100, round);
  const payPrice = roundVal(price - deduction, round);

  return { weight, fat, snf, rate, price, kgFat, kgSnf, deduction, payPrice };
}
