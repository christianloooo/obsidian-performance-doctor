/**
 * Pure core types for Obsidian Performance Doctor (POC).
 * No Obsidian, no DOM, no side effects.
 */

export interface DelaySample {
  scheduledAt: number;
  executedAt: number;
  delay: number;
}

export type SessionTerminal =
  | { status: 'running' }
  | { status: 'completed'; reason: 'stopped' | 'max-samples' | 'max-duration' }
  | { status: 'invalid'; reason: string };

export interface SessionController {
  stop: () => void;
  cancel: (reason?: string) => void;
  notifySuspension: (reason?: string) => void;
  getSamples: () => DelaySample[];
  isActive: () => boolean;
  isValid: () => boolean;
  invalidReason: () => string | null;
  getTerminal: () => SessionTerminal;
  getProbeCallbackSelfTimeMs: () => number;
}

/** Metadata required before two sets of trials may be compared. */
export type Workload = 'typing' | 'scrolling' | 'opening-notes' | 'other-repeated-task';

export interface TrialMeta {
  platform: string;
  appVersion: string;
  pluginVersion: string;
  scenario: 'baseline' | 'after';
  workload: Workload;
  experimentId: number;
  durationMs: number;
  probeIntervalMs: number;
  /** Only a completed terminal may be compared. Invalid sessions are not completed. */
  terminal: 'completed' | 'invalid';
}

export interface StatsSummary {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p75: number;
  p95: number;
  p99: number;
  isInconclusive: boolean;
  reason?: string;
}

export interface ReportMeta {
  platform: string;
  appVersion: string;
  pluginVersion: string;
  durationMs: number;
  // scenario, startedAt, paths, error text, raw user data are deliberately omitted from the exported schema
}

export interface PerformanceReport {
  platform: string;
  appVersion: string;
  pluginVersion: string;
  durationMs: number;
  sampleCount: number;
  summary: StatsSummary;
  // No arbitrary fields. This is the only shape allowed for default export.
}

export interface TrialComparison {
  valid: boolean;
  inconclusive: boolean;
  reason?: string;
  improvement: boolean;
  noiseHigh: boolean;
  metric: 'p95';
  baselineMedianP95?: number;
  afterMedianP95?: number;
  deltaMedianP95?: number;
}

export interface InventoryAggregate {
  totalFiles: number;
  totalSize: number;
  byExtension: Record<string, { count: number; totalSize: number }>;
  // For default export we will not include individual paths
  largestFilesCounted: number; // count only, no paths in redacted
}

export interface SyntheticFile {
  // path omitted from reports
  extension: string;
  size: number;
}
