import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = spawnSync(process.execPath, ['esbuild.config.mjs', '--harness-core'], {
  cwd: root,
  stdio: 'inherit',
});
if (built.status !== 0) process.exit(built.status ?? 1);

const Core = await import(pathToFileURL(path.join(root, 'harness', 'core.js')).href);
let passed = 0;
let failed = 0;

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function createClock() {
  let time = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => time,
    pending: () => timers.size,
    schedule(callback, delayMs) {
      const id = nextId++;
      timers.set(id, { due: time + delayMs, callback });
      return id;
    },
    cancel(id) {
      timers.delete(id);
    },
    advance(ms) {
      time += ms;
      let progressed = true;
      while (progressed) {
        progressed = false;
        let chosen = null;
        for (const [id, timer] of timers) {
          if (timer.due <= time && (!chosen || timer.due < chosen.due)) chosen = { id, timer };
        }
        if (!chosen) break;
        timers.delete(chosen.id);
        progressed = true;
        chosen.timer.callback();
      }
    },
  };
}

function session(clock, extra = {}) {
  return Core.createMeasurementSession({
    probeIntervalMs: 100,
    maxSamples: 6,
    maxDurationMs: 1000,
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    ...extra,
  });
}

test('inventory ignores prototype keys and invalid sizes', () => {
  const aggregate = Core.aggregateInventory([
    { extension: '__proto__', size: 10 },
    { extension: 'constructor', size: 10 },
    { extension: 'md', size: 20 },
    { extension: '.png', size: -5 },
    { extension: '.pdf', size: Number.POSITIVE_INFINITY },
    { extension: '.json', size: 30 },
  ]);
  for (const key of Object.keys(aggregate.byExtension)) {
    assert.ok(['.md', '.png', '.jpg', '.jpeg', '.pdf', '.canvas', '.json', '.csv', '.txt', 'other'].includes(key), key);
  }
  assert.equal(aggregate.byExtension['.md'].count, 1);
  assert.equal(aggregate.byExtension['.json'].count, 1);
  assert.equal(Object.prototype.count, undefined);
});

test('report drops arbitrary platform and version strings', () => {
  const report = Core.buildReport(
    [{ scheduledAt: 0, executedAt: 12, delay: 12 }],
    { platform: 'C:/private/client-name', appVersion: 'secret-note.md', pluginVersion: 'user@example.com', durationMs: 12 },
  );
  assert.equal(report.platform, 'unknown');
  assert.equal(report.appVersion, 'unknown');
  assert.equal(report.pluginVersion, 'unknown');
  const json = JSON.stringify(report);
  assert.equal(json.includes('private'), false);
  assert.equal(json.includes('secret-note'), false);
  assert.equal(json.includes('@'), false);
});

test('on-time probes have exact zero delay and one live timer', () => {
  const clock = createClock();
  const recorder = session(clock);
  clock.advance(0);
  assert.deepEqual(recorder.getSamples().map((sample) => sample.delay), [0]);
  assert.equal(clock.pending(), 1);
  clock.advance(100);
  assert.deepEqual(recorder.getSamples().map((sample) => sample.delay), [0, 0]);
  assert.equal(clock.pending(), 1);
  assert.equal(recorder.getTerminal().status, 'running');
});

test('a long block is one sample and does not catch up', () => {
  const clock = createClock();
  const recorder = session(clock, { maxDurationMs: 5000, maxSamples: 10 });
  clock.advance(0);
  clock.advance(300);
  const delays = recorder.getSamples().map((sample) => sample.delay);
  assert.deepEqual(delays, [0, 200]);
  assert.equal(clock.pending(), 1);
  clock.advance(0);
  assert.equal(recorder.getSamples().length, 2);
  clock.advance(99);
  assert.equal(recorder.getSamples().length, 2);
  clock.advance(1);
  assert.deepEqual(recorder.getSamples().map((sample) => sample.delay), [0, 200, 0]);
});

test('callback after the deadline is an invalid terminal and leaves no timer', () => {
  const clock = createClock();
  const recorder = session(clock, { maxDurationMs: 150, probeIntervalMs: 100 });
  clock.advance(0);
  clock.advance(100);
  assert.equal(recorder.getSamples().length, 2);
  clock.advance(100);
  assert.equal(recorder.getTerminal().status, 'invalid');
  assert.equal(recorder.getTerminal().reason, 'deadline');
  assert.equal(recorder.getSamples().length, 0);
  assert.equal(clock.pending(), 0);
  assert.equal(recorder.isActive(), false);
});

test('hide then return stays invalid and does not resume', () => {
  const clock = createClock();
  let hidden = false;
  const recorder = session(clock, { isSuspended: () => hidden, maxDurationMs: 5000 });
  clock.advance(0);
  hidden = true;
  clock.advance(100);
  assert.equal(recorder.getTerminal().status, 'invalid');
  assert.equal(recorder.invalidReason(), 'suspended');
  assert.equal(clock.pending(), 0);
  hidden = false;
  clock.advance(1000);
  assert.equal(recorder.getSamples().length, 0);
  assert.equal(clock.pending(), 0);
  assert.equal(recorder.getTerminal().status, 'invalid');
});

test('cancel and unload clear the timer and ignore a stale callback', () => {
  const clock = createClock();
  let stale = () => {};
  const wrapped = {
    ...clock,
    schedule(callback, delayMs) {
      stale = callback;
      return clock.schedule(callback, delayMs);
    },
  };
  const recorder = Core.createMeasurementSession({
    probeIntervalMs: 100,
    maxDurationMs: 5000,
    now: clock.now,
    schedule: wrapped.schedule,
    cancel: clock.cancel,
  });
  clock.advance(0);
  assert.equal(clock.pending(), 1);
  recorder.cancel('unloaded');
  assert.equal(clock.pending(), 0);
  assert.deepEqual(recorder.getTerminal(), { status: 'invalid', reason: 'unloaded' });
  stale();
  assert.equal(recorder.getSamples().length, 0);
  assert.equal(clock.pending(), 0);
});

test('user stop is a completed terminal, not merely inactive', () => {
  const clock = createClock();
  const recorder = session(clock);
  clock.advance(0);
  clock.advance(100);
  recorder.stop();
  assert.equal(clock.pending(), 0);
  assert.deepEqual(recorder.getTerminal(), { status: 'completed', reason: 'stopped' });
  assert.equal(recorder.isValid(), true);
  assert.equal(recorder.getSamples().length, 2);
  assert.equal(recorder.isActive(), false);
});

function flatTrial(delay, meta) {
  const samples = Array.from({ length: 12 }, (_, index) => ({
    scheduledAt: index * 80,
    executedAt: index * 80 + delay,
    delay,
  }));
  return { summary: Core.summarize(samples), meta };
}

function meta(overrides = {}) {
  return {
    platform: 'win32',
    appVersion: '1.6.5',
    pluginVersion: '0.1.0',
    scenario: 'baseline',
    workload: 'typing',
    experimentId: 1,
    durationMs: 10000,
    probeIntervalMs: 80,
    terminal: 'completed',
    ...overrides,
  };
}

test('p95 tail drop is an improvement only when metadata matches', () => {
  const baseline = [40, 42, 38].map((delay) => flatTrial(delay, meta()));
  const after = [15, 16, 14].map((delay) => flatTrial(delay, meta({ scenario: 'after' })));
  const comparison = Core.compareTrials(baseline, after);
  assert.equal(comparison.metric, 'p95');
  assert.equal(comparison.valid, true);
  assert.equal(comparison.improvement, true);
  assert.ok(comparison.deltaMedianP95 < -5);
});

test('mismatched platform, version, scenario, or duration is not a benefit', () => {
  const lower = [10, 11, 12].map((delay) => flatTrial(delay, meta({ scenario: 'after' })));
  const cases = [
    [40, 40, 40].map((delay) => flatTrial(delay, meta({ platform: 'darwin' }))),
    [40, 40, 40].map((delay) => flatTrial(delay, meta({ appVersion: '1.7.0' }))),
    [40, 40, 40].map((delay) => flatTrial(delay, meta({ pluginVersion: '0.2.0' }))),
    [40, 40, 40].map((delay) => flatTrial(delay, meta({ scenario: 'after' }))),
    [40, 40, 40].map((delay) => flatTrial(delay, meta({ durationMs: 2000 }))),
  ];
  for (const baseline of cases) {
    const comparison = Core.compareTrials(baseline, lower);
    assert.equal(comparison.improvement, false);
    assert.equal(comparison.valid, false);
    assert.equal(comparison.inconclusive, true);
    assert.match(comparison.reason, /mismatched/);
  }
});

test('invalid terminal and tiny tail delta do not count as improvement', () => {
  const baseline = [40, 40, 40].map((delay) => flatTrial(delay, meta({ terminal: 'invalid' })));
  const after = [10, 10, 10].map((delay) => flatTrial(delay, meta({ scenario: 'after' })));
  const invalid = Core.compareTrials(baseline, after);
  assert.equal(invalid.improvement, false);
  assert.match(invalid.reason, /terminal/);

  const tinyBase = [30, 30, 30].map((delay) => flatTrial(delay, meta()));
  const tinyAfter = [28, 28, 28].map((delay) => flatTrial(delay, meta({ scenario: 'after' })));
  const tiny = Core.compareTrials(tinyBase, tinyAfter);
  assert.equal(tiny.improvement, false);
  assert.equal(tiny.inconclusive, true);
  assert.match(tiny.reason, /meaningful/);
});

test('an inconclusive summary stays inconclusive', () => {
  const short = {
    summary: Core.summarize([{ scheduledAt: 0, executedAt: 40, delay: 40 }]),
    meta: meta(),
  };
  const after = [10, 10, 10].map((delay) => flatTrial(delay, meta({ scenario: 'after' })));
  const comparison = Core.compareTrials([short, short, short], after);
  assert.equal(comparison.improvement, false);
  assert.equal(comparison.inconclusive, true);
  assert.match(comparison.reason, /inconclusive/);
});

function storedSummary(delay) {
  return {
    count: 12, min: delay, max: delay, mean: delay,
    p50: delay, p75: delay, p95: delay, p99: delay,
    isInconclusive: false,
  };
}

test('storage drops invalid trials, bounds history, and blocks leaky clipboard text', () => {
  const good = {
    condition: 'baseline',
    workload: 'typing',
    experimentId: 1,
    probeIntervalMs: 80,
    durationMs: 10000,
    sampleCount: 12,
    summary: storedSummary(20),
    platform: 'win32',
    appVersion: '1.6.5',
    pluginVersion: '0.1.0',
    terminal: 'completed',
  };
  const parsed = Core.parseStoredTrials({
    trials: [
      good,
      { ...good, condition: 'after', notePath: 'C:/secret/note.md' },
      { ...good, platform: 'C:/private/vault' },
      { ...good, terminal: 'invalid' },
      { ...good, appVersion: 'user@example.com' },
      { ...good, summary: { ...storedSummary(20), reason: 'CONFIDENTIAL client merger deadline Friday' } },
      { ...good, summary: { ...storedSummary(20), secret: 'confidential vault note text' } },
    ],
  });
  assert.equal(parsed.trials.length, 1);
  assert.equal(parsed.dropped, 6);
  const storedJson = JSON.stringify(parsed.trials);
  assert.equal(storedJson.includes('CONFIDENTIAL'), false);
  assert.equal(storedJson.includes('confidential vault'), false);
  assert.equal(storedJson.includes('secret'), false);
  const many = Array.from({ length: 30 }, () => good);
  const bounded = Core.parseStoredTrials({ trials: many });
  assert.equal(bounded.trials.length, 24);
  assert.equal(bounded.dropped, 6);
  const safeInput = {
    platform: 'win32', appVersion: '1.6.5', pluginVersion: '0.1.0', durationMs: 10, sampleCount: 12,
    summary: storedSummary(4),
  };
  const preview = Core.previewReport(safeInput);
  const copied = Core.clipboardExport(safeInput);
  assert.equal(preview, copied);
  assert.equal(copied.includes('CONFIDENTIAL'), false);
  assert.throws(() => Core.clipboardExport({ ...safeInput, path: 'C:/secret' }));
  assert.throws(() => Core.previewReport({
    ...safeInput,
    summary: { ...storedSummary(4), reason: 'CONFIDENTIAL client merger deadline Friday' },
  }));
  assert.throws(() => Core.clipboardExport({
    ...safeInput,
    summary: { secret: 'confidential vault note text' },
  }));
  assert.throws(() => Core.clipboardExport({
    ...safeInput,
    summary: { ...storedSummary(4), note: { text: 'confidential vault note text' } },
  }));
  assert.throws(() => Core.toExportReport({
    ...safeInput,
    sampleCount: 3,
    summary: storedSummary(4),
  }));
});

test('quantiles for empty, single, even, odd, and a known sorted fixture', () => {
  assert.equal(Core.summarize([]).isInconclusive, true);
  const single = Core.summarize([{ scheduledAt: 0, executedAt: 7, delay: 7 }]);
  assert.equal(single.p50, 7);
  assert.equal(single.p95, 7);
  const even = Core.summarize([0, 10, 20, 30].map((delay, index) => ({ scheduledAt: index, executedAt: index + delay, delay })));
  assert.equal(even.p50, 15);
  assert.ok(Math.abs(even.p95 - 28.5) < 1e-9);
  const odd = Core.summarize([0, 10, 20].map((delay, index) => ({ scheduledAt: index, executedAt: index + delay, delay })));
  assert.equal(odd.p50, 10);
  const known = [1, 2, 3, 4, 5].map((delay, index) => ({ scheduledAt: index, executedAt: index + delay, delay }));
  const summary = Core.summarize(known);
  assert.equal(summary.count, 5);
  assert.equal(summary.min, 1);
  assert.equal(summary.max, 5);
  assert.equal(summary.p50, 3);
  assert.equal(summary.p99, 4.96);
});

test('summary percentiles must be monotonic', () => {
  const bad = {
    platform: 'win32', appVersion: '1.6.5', pluginVersion: '0.1.0', durationMs: 10, sampleCount: 100,
    summary: { count: 100, min: 1, max: 10, mean: 2, p50: 9, p75: 8, p95: 7, p99: 6, isInconclusive: false },
  };
  assert.throws(() => Core.parseSummary(bad.summary));
  assert.throws(() => Core.toExportReport(bad));
  const parsed = Core.parseStoredTrials({
    trials: [{
      condition: 'baseline', workload: 'typing', experimentId: 1, probeIntervalMs: 80,
      durationMs: 10, sampleCount: 100, platform: 'win32', appVersion: '1.6.5', pluginVersion: '0.1.0',
      terminal: 'completed', summary: bad.summary,
    }],
  });
  assert.equal(parsed.trials.length, 0);
  assert.equal(parsed.dropped, 1);
});

test('mixed experiments and workloads are not one comparison', () => {
  const baseline = [40, 40, 40].map((delay, index) => flatTrial(delay, meta(index === 2 ? { experimentId: 2 } : {})));
  const after = [10, 10, 10].map((delay) => flatTrial(delay, meta({ scenario: 'after' })));
  const mixedExperiment = Core.compareTrials(baseline, after);
  assert.equal(mixedExperiment.improvement, false);
  assert.match(mixedExperiment.reason, /experiment/);
  const otherTask = [40, 40, 40].map((delay) => flatTrial(delay, meta({ workload: 'scrolling' })));
  const mixedWorkload = Core.compareTrials(otherTask, after);
  assert.equal(mixedWorkload.improvement, false);
  assert.match(mixedWorkload.reason, /workload/);
});

test('save and load gates do not show UI after unload or during a pending save', async () => {
  const gate = new Core.ActivityGate();
  const token = gate.capture();
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const finished = gate.runSerialized(token, () => pending);
  assert.equal(gate.busy(), true);
  assert.equal(gate.saving, true);
  gate.unload();
  release(true);
  const saved = await finished;
  assert.equal(saved, undefined);
  assert.equal(gate.current(token), false);
  let shown = false;
  if (gate.current(token)) shown = true;
  assert.equal(shown, false);

  const again = new Core.ActivityGate();
  const loadToken = again.capture();
  let loadRelease;
  const loading = new Promise((resolve) => { loadRelease = resolve; });
  const init = (async () => {
    await loading;
    return again.current(loadToken);
  })();
  again.unload();
  loadRelease();
  assert.equal(await init, false);
});

test('a failed save clears the busy flag and does not authorize UI after unload', async () => {
  const gate = new Core.ActivityGate();
  const token = gate.capture();
  let noticed = false;
  try {
    await gate.runSerialized(token, async () => {
      throw new Error('disk full');
    });
  } catch {
    if (gate.current(token)) noticed = true;
  }
  assert.equal(gate.saving, false);
  assert.equal(gate.busy(), false);
  assert.equal(noticed, true);

  const pendingGate = new Core.ActivityGate();
  const pendingToken = pendingGate.capture();
  let rejectSave;
  const disk = new Promise((_resolve, reject) => { rejectSave = reject; });
  const pending = pendingGate.runSerialized(pendingToken, () => disk);
  await Promise.resolve();
  assert.equal(pendingGate.busy(), true);
  pendingGate.unload();
  rejectSave(new Error('disk full'));
  let lateNotice = false;
  try {
    await pending;
  } catch {
    if (pendingGate.current(pendingToken)) lateNotice = true;
  }
  assert.equal(lateNotice, false);
  assert.equal(pendingGate.saving, false);
});

for (const item of tests) {
  try {
    await item.fn();
    console.log('PASS', item.name);
    passed += 1;
  } catch (error) {
    console.error('FAIL', item.name);
    console.error(error);
    failed += 1;
  }
}
const summary = { passed, failed };
writeFileSync(path.join(root, 'docs', 'regression-results.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
if (failed > 0) process.exit(1);
