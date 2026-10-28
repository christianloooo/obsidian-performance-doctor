/**
 * Paired recorder overhead benchmark.
 *
 * OFF and ON run the identical asynchronous workload: fixed short main-thread
 * slices separated by timer yields so the event loop can run probe callbacks.
 * A synchronous spin that prevents timers is not a valid ON condition.
 *
 * The result is raw evidence. It does not declare an overhead threshold met.
 */

import { createMeasurementSession } from './measurement';
import { summarize } from './statistics';

export interface BenchSide {
  recorder: 'off' | 'on';
  completedChunks: number;
  elapsedMs: number;
  probeCallbackSelfTimeMs: number;
  sampleCount: number;
  delayMin: number;
  delayMax: number;
  delayP50: number;
  sessionValid: boolean;
}

export interface BenchPair {
  index: number;
  off: BenchSide;
  on: BenchSide;
  sameCompletedWork: boolean;
}

export interface BenchResult {
  protocol: 'paired-async-v1';
  chunkBusyMs: number;
  gapMs: number;
  chunks: number;
  pairs: number;
  warmupPairs: number;
  discardedWarmup: number;
  kept: BenchPair[];
  validEvidence: boolean;
  invalidReasons: string[];
  note: string;
}

export interface BenchOptions {
  chunks?: number;
  chunkBusyMs?: number;
  gapMs?: number;
  pairs?: number;
  warmupPairs?: number;
  probeIntervalMs?: number;
  now?: () => number;
  busy?: (ms: number, now: () => number) => void;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULTS = {
  chunks: 16,
  chunkBusyMs: 8,
  gapMs: 20,
  pairs: 10,
  warmupPairs: 2,
  probeIntervalMs: 40,
};

function defaultBusy(ms: number, now: () => number): void {
  const start = now();
  while (now() - start < ms) {
    // short deterministic slice; both conditions use this
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function externalWorkload(opts: Required<Pick<BenchOptions, 'chunks' | 'chunkBusyMs' | 'gapMs' | 'now'>> & {
  busy: (ms: number, now: () => number) => void;
  sleep: (ms: number) => Promise<void>;
}): Promise<{ completedChunks: number; elapsedMs: number }> {
  const start = opts.now();
  let completedChunks = 0;
  for (let i = 0; i < opts.chunks; i++) {
    opts.busy(opts.chunkBusyMs, opts.now);
    completedChunks += 1;
    await opts.sleep(opts.gapMs);
  }
  return { completedChunks, elapsedMs: opts.now() - start };
}

async function runSide(recorder: 'off' | 'on', o: {
  chunks: number;
  chunkBusyMs: number;
  gapMs: number;
  probeIntervalMs: number;
  now: () => number;
  busy: (ms: number, now: () => number) => void;
  sleep: (ms: number) => Promise<void>;
}): Promise<BenchSide> {
  const session = recorder === 'on'
    ? createMeasurementSession({
      probeIntervalMs: o.probeIntervalMs,
      maxSamples: 500,
      maxDurationMs: 120000,
      now: o.now,
    })
    : null;

  const work = await externalWorkload(o);
  if (session) session.stop();
  const samples = session && session.isValid() ? session.getSamples() : [];
  const summary = summarize(samples);

  return {
    recorder,
    completedChunks: work.completedChunks,
    elapsedMs: work.elapsedMs,
    probeCallbackSelfTimeMs: session ? session.getProbeCallbackSelfTimeMs() : 0,
    sampleCount: samples.length,
    delayMin: samples.length ? summary.min : 0,
    delayMax: samples.length ? summary.max : 0,
    delayP50: samples.length ? summary.p50 : 0,
    sessionValid: session ? session.isValid() : true,
  };
}

export async function runPairedBenchmark(options: BenchOptions = {}): Promise<BenchResult> {
  const chunks = options.chunks ?? DEFAULTS.chunks;
  const chunkBusyMs = options.chunkBusyMs ?? DEFAULTS.chunkBusyMs;
  const gapMs = options.gapMs ?? DEFAULTS.gapMs;
  const pairs = options.pairs ?? DEFAULTS.pairs;
  const warmupPairs = options.warmupPairs ?? DEFAULTS.warmupPairs;
  const probeIntervalMs = options.probeIntervalMs ?? DEFAULTS.probeIntervalMs;
  const now = options.now ?? (() => performance.now());
  const busy = options.busy ?? defaultBusy;
  const sleep = options.sleep ?? defaultSleep;

  const all: BenchPair[] = [];
  const total = warmupPairs + pairs;
  for (let index = 0; index < total; index++) {
    const off = await runSide('off', { chunks, chunkBusyMs, gapMs, probeIntervalMs, now, busy, sleep });
    const on = await runSide('on', { chunks, chunkBusyMs, gapMs, probeIntervalMs, now, busy, sleep });
    all.push({
      index,
      off,
      on,
      sameCompletedWork: off.completedChunks === on.completedChunks && off.completedChunks === chunks,
    });
  }

  const kept = all.slice(warmupPairs);
  const invalidReasons: string[] = [];
  for (const pair of kept) {
    if (!pair.sameCompletedWork) invalidReasons.push(`pair ${pair.index} completed work mismatch`);
    if (pair.on.sampleCount < 1) invalidReasons.push(`pair ${pair.index} recorder produced zero samples`);
    if (!pair.on.sessionValid) invalidReasons.push(`pair ${pair.index} session invalid`);
  }
  if (kept.length < 10) invalidReasons.push(`only ${kept.length} kept pairs (need >= 10)`);

  return {
    protocol: 'paired-async-v1',
    chunkBusyMs,
    gapMs,
    chunks,
    pairs,
    warmupPairs,
    discardedWarmup: warmupPairs,
    kept,
    validEvidence: invalidReasons.length === 0,
    invalidReasons,
    note: 'Raw paired timings only. validEvidence means the protocol ran (same work, probes fired). It is not a claim that overhead is acceptable.',
  };
}
