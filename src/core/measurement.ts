/**
 * Scheduling-delay probes.
 *
 * Delay is max(0, executedAt - dueAt): how late the callback ran, not CPU time
 * and not a cause. The next probe is due at executedAt + interval. It is never
 * due at the previous due time, so a stall is recorded once and is not replayed
 * as a burst of zero-delay catch-up probes.
 *
 * A session ends in exactly one terminal state. `isActive() === false` is not
 * that state. Invalid terminals discard samples and must not be compared.
 */

import { DelaySample, SessionController, SessionTerminal } from './types';

export interface MeasurementOptions {
  probeIntervalMs?: number;
  maxSamples?: number;
  maxDurationMs?: number;
  now?: () => number;
  schedule?: (cb: () => void, delayMs: number) => number;
  cancel?: (id: number) => void;
  isSuspended?: () => boolean;
  onEnded?: (terminal: SessionTerminal) => void;
}

export function createMeasurementSession(options: MeasurementOptions = {}): SessionController {
  const probeIntervalMs = options.probeIntervalMs ?? 80;
  const maxSamples = options.maxSamples ?? 120;
  const maxDurationMs = options.maxDurationMs ?? 20000;
  const now = options.now ?? (() => performance.now());
  const schedule = options.schedule ?? ((cb, delayMs) => setTimeout(cb, delayMs) as unknown as number);
  const cancelTimer = options.cancel ?? ((id) => clearTimeout(id));
  const isSuspended = options.isSuspended ?? (() => false);

  const samples: DelaySample[] = [];
  let timer: number | null = null;
  let startWall = 0;
  let nextDue = 0;
  let probeCallbackSelfTimeMs = 0;
  let terminal: SessionTerminal = { status: 'running' };

  function clearTimer(): void {
    if (timer !== null) {
      cancelTimer(timer);
      timer = null;
    }
  }

  function finish(next: SessionTerminal): void {
    if (terminal.status !== 'running') return;
    terminal = next;
    clearTimer();
    options.onEnded?.(terminal);
  }

  function invalidate(reason: string): void {
    finish({ status: 'invalid', reason });
  }

  function complete(reason: 'stopped' | 'max-samples' | 'max-duration'): void {
    finish({ status: 'completed', reason });
  }

  function scheduleNext(): void {
    if (terminal.status !== 'running') return;
    if (isSuspended()) {
      invalidate('suspended');
      return;
    }
    if (samples.length >= maxSamples) {
      complete('max-samples');
      return;
    }
    if (now() - startWall > maxDurationMs) {
      complete('max-duration');
      return;
    }

    const due = nextDue;
    const wait = Math.max(0, due - now());
    timer = schedule(() => {
      timer = null;
      if (terminal.status !== 'running') return;
      if (isSuspended()) {
        invalidate('suspended');
        return;
      }
      const entered = now();
      if (entered - startWall > maxDurationMs) {
        invalidate('deadline');
        return;
      }
      const delay = Math.max(0, entered - due);
      samples.push({ scheduledAt: due, executedAt: entered, delay });
      probeCallbackSelfTimeMs += Math.max(0, now() - entered);
      nextDue = entered + probeIntervalMs;
      scheduleNext();
    }, wait);
  }

  startWall = now();
  nextDue = startWall;
  if (isSuspended()) {
    invalidate('suspended-at-start');
  } else {
    scheduleNext();
  }

  return {
    stop: () => complete('stopped'),
    cancel: (reason = 'cancelled') => invalidate(reason),
    notifySuspension: (reason = 'suspended') => invalidate(reason),
    getSamples: () => (terminal.status === 'invalid' ? [] : samples.slice()),
    isActive: () => terminal.status === 'running',
    isValid: () => terminal.status !== 'invalid',
    invalidReason: () => (terminal.status === 'invalid' ? terminal.reason : null),
    getTerminal: () => terminal,
    getProbeCallbackSelfTimeMs: () => probeCallbackSelfTimeMs,
  };
}
