/**
 * Single shared statistics implementation.
 * Empty input is inconclusive. Percentiles are not reported as a real zero measurement
 * without the inconclusive flag.
 */

import { DelaySample, StatsSummary, TrialComparison, TrialMeta } from './types';

function computePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const pos = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  const weight = pos - lower;
  const low = sorted[lower] ?? 0;
  if (lower === upper) return low;
  const high = sorted[upper] ?? 0;
  return low * (1 - weight) + high * weight;
}

export function summarize(samples: DelaySample[], minSamplesForConclusive = 8): StatsSummary {
  if (!samples || samples.length === 0) {
    return {
      count: 0, min: 0, max: 0, mean: 0,
      p50: 0, p75: 0, p95: 0, p99: 0,
      isInconclusive: true,
      reason: 'zero samples',
    };
  }

  const delays = samples.map((sample) => sample.delay).filter((delay) => Number.isFinite(delay)).sort((a, b) => a - b);
  const count = delays.length;
  if (count === 0) {
    return {
      count: 0, min: 0, max: 0, mean: 0,
      p50: 0, p75: 0, p95: 0, p99: 0,
      isInconclusive: true,
      reason: 'zero finite samples',
    };
  }

  const sum = delays.reduce((total, delay) => total + delay, 0);
  return {
    count,
    min: delays[0] ?? 0,
    max: delays[count - 1] ?? 0,
    mean: sum / count,
    p50: computePercentile(delays, 50),
    p75: computePercentile(delays, 75),
    p95: computePercentile(delays, 95),
    p99: computePercentile(delays, 99),
    isInconclusive: count < minSamplesForConclusive,
    reason: count < minSamplesForConclusive ? `insufficient samples (${count} < ${minSamplesForConclusive})` : undefined,
  };
}

export interface ComparableTrial {
  summary: StatsSummary;
  meta: TrialMeta;
}

const MIN_TRIALS = 3;
const MIN_MEANINGFUL_MS = 5;
const MIN_MEANINGFUL_RATIO = 0.1;
const MAX_NOISE = 0.35;
const DURATION_RATIO = 0.15;
const DURATION_ABS_MS = 250;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function refused(reason: string, extra: Partial<TrialComparison> = {}): TrialComparison {
  return {
    valid: false,
    inconclusive: true,
    reason,
    improvement: false,
    noiseHigh: false,
    metric: 'p95',
    ...extra,
  };
}

function sameMeta(trials: ComparableTrial[]): string | null {
  const first = trials[0];
  if (!first) return 'no trials';
  for (const trial of trials) {
    if (trial.meta.terminal !== 'completed') return 'invalid or incomplete terminal state';
    if (trial.summary.isInconclusive) return 'inconclusive trial summary';
    if (trial.meta.platform !== first.meta.platform) return 'mismatched platform';
    if (trial.meta.appVersion !== first.meta.appVersion) return 'mismatched app version';
    if (trial.meta.pluginVersion !== first.meta.pluginVersion) return 'mismatched plugin version';
    if (trial.meta.probeIntervalMs !== first.meta.probeIntervalMs) return 'mismatched probe interval';
    if (trial.meta.scenario !== first.meta.scenario) return 'mismatched scenario';
    if (trial.meta.workload !== first.meta.workload) return 'mismatched workload';
    if (trial.meta.experimentId !== first.meta.experimentId) return 'mismatched experiment';
    const durationGap = Math.abs(trial.meta.durationMs - first.meta.durationMs);
    const durationLimit = Math.max(DURATION_ABS_MS, Math.abs(first.meta.durationMs) * DURATION_RATIO);
    if (durationGap > durationLimit) return 'mismatched duration';
  }
  return null;
}

/**
 * Compare repeated trials on the p95 of scheduling delay.
 *
 * p95 is the lag-relevant tail: a sporadic stall raises it while p50 can stay
 * small. The number compared is the median of each side's trial p95s.
 * That is a difference in the measurement, not a cause.
 * improvement is true only when the tail drop is at least 5 ms and 10% of the
 * baseline, and every trial is a completed matching run. A negative delta on
 * an invalid comparison is not a benefit.
 */
export function compareTrials(baseline: ComparableTrial[], after: ComparableTrial[]): TrialComparison {
  if (baseline.length < MIN_TRIALS || after.length < MIN_TRIALS) {
    return refused(`need >=${MIN_TRIALS} trials per condition`);
  }
  const baselineProblem = sameMeta(baseline);
  if (baselineProblem) return refused(baselineProblem);
  const afterProblem = sameMeta(after);
  if (afterProblem) return refused(afterProblem);

  const anchor = baseline[0]!.meta;
  const other = after[0]!.meta;
  if (anchor.scenario !== 'baseline' || other.scenario !== 'after') return refused('mismatched scenario');
  if (anchor.platform !== other.platform) return refused('mismatched platform');
  if (anchor.appVersion !== other.appVersion) return refused('mismatched app version');
  if (anchor.pluginVersion !== other.pluginVersion) return refused('mismatched plugin version');
  if (anchor.probeIntervalMs !== other.probeIntervalMs) return refused('mismatched probe interval');
  if (anchor.workload !== other.workload) return refused('mismatched workload');
  if (anchor.experimentId !== other.experimentId) return refused('mismatched experiment');
  const durationGap = Math.abs(anchor.durationMs - other.durationMs);
  const durationLimit = Math.max(DURATION_ABS_MS, Math.abs(anchor.durationMs) * DURATION_RATIO);
  if (durationGap > durationLimit) return refused('mismatched duration');

  const baseP95 = baseline.map((trial) => trial.summary.p95).filter(Number.isFinite);
  const afterP95 = after.map((trial) => trial.summary.p95).filter(Number.isFinite);
  if (baseP95.length < MIN_TRIALS || afterP95.length < MIN_TRIALS) {
    return refused('insufficient finite p95 values');
  }

  const baselineMedianP95 = median(baseP95);
  const afterMedianP95 = median(afterP95);
  const deltaMedianP95 = afterMedianP95 - baselineMedianP95;
  const noiseOf = (values: number[], center: number): number => {
    if (center <= 0) return Infinity;
    const variance = values.reduce((sum, value) => sum + (value - center) ** 2, 0) / values.length;
    return Math.sqrt(variance) / center;
  };
  const noiseHigh = Math.max(noiseOf(baseP95, baselineMedianP95), noiseOf(afterP95, afterMedianP95)) > MAX_NOISE;
  const numbers = { baselineMedianP95, afterMedianP95, deltaMedianP95 };
  if (noiseHigh) return refused('high within-condition p95 noise', { ...numbers, noiseHigh: true });
  if (baselineMedianP95 < MIN_MEANINGFUL_MS) return refused('near-zero baseline tail', numbers);

  const meaningful = Math.max(MIN_MEANINGFUL_MS, baselineMedianP95 * MIN_MEANINGFUL_RATIO);
  if (Math.abs(deltaMedianP95) < meaningful) return refused('tail delta below meaningful threshold', numbers);

  const improvement = deltaMedianP95 <= -meaningful;
  return {
    valid: true,
    inconclusive: false,
    improvement,
    noiseHigh: false,
    metric: 'p95',
    ...numbers,
    reason: improvement ? undefined : 'tail did not drop',
  };
}
