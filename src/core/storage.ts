/**
 * Local trial history. Bounded, validated, and free of note contents or paths.
 * Callers persist the returned array. A save failure is the caller's to report.
 */

import { toExportReport } from './report';
import type { StatsSummary, Workload } from './types';

export const MAX_SAVED_TRIALS = 24;

const PLATFORMS = ['win32', 'darwin', 'linux', 'unknown'] as const;
const CONDITIONS = ['baseline', 'after'] as const;
const WORKLOADS: Workload[] = ['typing', 'scrolling', 'opening-notes', 'other-repeated-task'];
const TRIAL_KEYS = ['condition', 'workload', 'experimentId', 'probeIntervalMs', 'durationMs', 'sampleCount', 'summary', 'platform', 'appVersion', 'pluginVersion', 'terminal'];

export interface StoredTrial {
  condition: 'baseline' | 'after';
  workload: Workload;
  experimentId: number;
  probeIntervalMs: number;
  durationMs: number;
  sampleCount: number;
  summary: StatsSummary;
  platform: string;
  appVersion: string;
  pluginVersion: string;
  terminal: 'completed';
}

export interface ParseResult {
  trials: StoredTrial[];
  dropped: number;
}

function finiteNonNeg(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function versionOk(value: unknown): value is string {
  return value === 'unknown' || (typeof value === 'string' && /^\d+\.\d+\.\d+(-[a-z0-9._-]+)?$/i.test(value) && value.length <= 32);
}

export function parseStoredTrial(value: unknown): StoredTrial | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (!TRIAL_KEYS.includes(key)) return null;
  }
  if (!CONDITIONS.includes(row.condition as 'baseline')) return null;
  if (!WORKLOADS.includes(row.workload as Workload)) return null;
  if (typeof row.experimentId !== 'number' || !Number.isInteger(row.experimentId) || row.experimentId <= 0) return null;
  if (row.terminal !== 'completed') return null;
  if (!PLATFORMS.includes(row.platform as 'win32')) return null;
  if (!versionOk(row.appVersion) || !versionOk(row.pluginVersion)) return null;
  if (!finiteNonNeg(row.probeIntervalMs) || row.probeIntervalMs <= 0 || !Number.isInteger(row.probeIntervalMs)) return null;
  if (!finiteNonNeg(row.durationMs) || !finiteNonNeg(row.sampleCount) || !Number.isInteger(row.sampleCount)) return null;
  let summary: StatsSummary;
  try {
    summary = toExportReport({
      platform: row.platform,
      appVersion: row.appVersion,
      pluginVersion: row.pluginVersion,
      durationMs: row.durationMs,
      sampleCount: row.sampleCount,
      summary: row.summary,
    }).summary;
  } catch {
    return null;
  }
  return {
    condition: row.condition as 'baseline' | 'after',
    workload: row.workload as Workload,
    experimentId: row.experimentId,
    probeIntervalMs: row.probeIntervalMs,
    durationMs: row.durationMs,
    sampleCount: row.sampleCount,
    summary,
    platform: row.platform as string,
    appVersion: row.appVersion,
    pluginVersion: row.pluginVersion,
    terminal: 'completed',
  };
}

export function parseStoredTrials(raw: unknown): ParseResult {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { trials?: unknown }).trials)
    ? (raw as { trials: unknown[] }).trials
    : [];
  const trials: StoredTrial[] = [];
  let dropped = 0;
  for (const item of list) {
    const parsed = parseStoredTrial(item);
    if (parsed) trials.push(parsed);
    else dropped += 1;
  }
  const bounded = trials.slice(-MAX_SAVED_TRIALS);
  dropped += trials.length - bounded.length;
  return { trials: bounded, dropped };
}

export function rememberTrial(existing: StoredTrial[], next: StoredTrial): StoredTrial[] {
  return [...existing, next].slice(-MAX_SAVED_TRIALS);
}
