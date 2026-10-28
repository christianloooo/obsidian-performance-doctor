/**
 * One constructor for anything shown, copied, or reloaded as a report.
 * It copies explicit scalars only. Unknown fields are refused, not stripped.
 * Summary text such as `reason` is not part of the export.
 */

import { summarize } from './statistics';
import { DelaySample, PerformanceReport, StatsSummary } from './types';

const PLATFORMS = ['win32', 'darwin', 'linux', 'unknown'] as const;
const SUMMARY_KEYS = ['count', 'min', 'max', 'mean', 'p50', 'p75', 'p95', 'p99', 'isInconclusive'] as const;
const REPORT_KEYS = ['platform', 'appVersion', 'pluginVersion', 'durationMs', 'sampleCount', 'summary'] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function ownKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value);
}

function versionOk(value: unknown): value is string {
  return value === 'unknown'
    || (typeof value === 'string' && /^\d+\.\d+\.\d+(-[a-z0-9._-]+)?$/i.test(value) && value.length <= 32);
}

function finiteNonNeg(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function integerNonNeg(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function parseSummary(value: unknown): StatsSummary {
  if (!isObject(value)) throw new Error('summary is not an object');
  for (const key of ownKeys(value)) {
    if (!(SUMMARY_KEYS as readonly string[]).includes(key)) throw new Error('summary has an unknown field');
  }
  if (!integerNonNeg(value.count)) throw new Error('summary count is not a nonnegative integer');
  const count = value.count;
  const metrics = [value.min, value.max, value.mean, value.p50, value.p75, value.p95, value.p99];
  for (const metric of metrics) {
    if (!finiteNonNeg(metric)) throw new Error('summary metric is not a finite nonnegative number');
  }
  const min = value.min as number;
  const max = value.max as number;
  const mean = value.mean as number;
  const p50 = value.p50 as number;
  const p75 = value.p75 as number;
  const p95 = value.p95 as number;
  const p99 = value.p99 as number;
  if (typeof value.isInconclusive !== 'boolean') throw new Error('summary inconclusive flag is missing');
  if (min > max) throw new Error('summary min exceeds max');
  if (count === 0) {
    if (!value.isInconclusive) throw new Error('empty summary must be inconclusive');
    for (const metric of [min, max, mean, p50, p75, p95, p99]) {
      if (metric !== 0) throw new Error('empty summary must use zero metrics');
    }
  } else if (!(min <= p50 && p50 <= p75 && p75 <= p95 && p95 <= p99 && p99 <= max && mean >= min && mean <= max)) {
    throw new Error('summary metrics are inconsistent');
  }
  return { count, min, max, mean, p50, p75, p95, p99, isInconclusive: value.isInconclusive };
}

/** Build the only object that preview, copy, and reload may use. */
export function toExportReport(input: unknown): PerformanceReport {
  const value = typeof input === 'string' ? JSON.parse(input) as unknown : input;
  if (!isObject(value)) throw new Error('report is not an object');
  for (const key of ownKeys(value)) {
    if (!(REPORT_KEYS as readonly string[]).includes(key)) throw new Error('report has an unknown field');
  }
  const platform = value.platform;
  if (typeof platform !== 'string' || !(PLATFORMS as readonly string[]).includes(platform)) {
    throw new Error('report platform is not allowed');
  }
  if (!versionOk(value.appVersion) || !versionOk(value.pluginVersion)) throw new Error('report version is not allowed');
  if (!finiteNonNeg(value.durationMs)) throw new Error('report duration is not a finite nonnegative number');
  if (!integerNonNeg(value.sampleCount)) throw new Error('report sample count is not a nonnegative integer');
  const summary = parseSummary(value.summary);
  if (summary.count !== value.sampleCount) throw new Error('report sample count does not match summary');
  return {
    platform,
    appVersion: value.appVersion,
    pluginVersion: value.pluginVersion,
    durationMs: value.durationMs,
    sampleCount: value.sampleCount,
    summary,
  };
}

export function previewReport(input: unknown): string {
  return JSON.stringify(toExportReport(input), null, 2);
}

export function clipboardExport(input: unknown): string {
  return previewReport(input);
}

export function buildReport(
  samples: DelaySample[],
  allowedMeta: { platform: string; appVersion: string; pluginVersion: string; durationMs: number },
): PerformanceReport {
  const measured = summarize(Array.isArray(samples) ? samples : []);
  const summary: StatsSummary = {
    count: measured.count,
    min: measured.min,
    max: measured.max,
    mean: measured.mean,
    p50: measured.p50,
    p75: measured.p75,
    p95: measured.p95,
    p99: measured.p99,
    isInconclusive: measured.isInconclusive,
  };
  return toExportReport({
    platform: sanitizePlatform(allowedMeta.platform),
    appVersion: sanitizeVersion(allowedMeta.appVersion),
    pluginVersion: sanitizeVersion(allowedMeta.pluginVersion),
    durationMs: finiteNonNeg(allowedMeta.durationMs) ? allowedMeta.durationMs : 0,
    sampleCount: summary.count,
    summary,
  });
}

function sanitizePlatform(value: string): string {
  const lower = String(value || '').toLowerCase();
  return (PLATFORMS as readonly string[]).includes(lower) ? lower : 'unknown';
}

function sanitizeVersion(value: string): string {
  const text = String(value || '').trim();
  return versionOk(text) ? text : 'unknown';
}
