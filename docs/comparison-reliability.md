# Comparison reliability study

This is a synthetic browser study of `compareTrials`. It is not a user pilot, not a CPU measurement, not a real-vault result, and not a validation of the product's 12 second recording.

## Protocol

The page imports the same harness core bundle as the other browser checks (`createMeasurementSession`, `summarize`, `compareTrials`). Each comparison is 3 baseline trials and 3 after trials.

Each trial is a disclosed 1000 ms nominal window with an 80 ms probe interval. A trial is excluded from comparison only when the session does not complete or has fewer than 8 conclusive samples. The comparison receives each trial's measured `wallMs` as `durationMs`, so the core duration rule can reject a material overrun. The nominal window is also stored. Probe interval and the 40 ms spin target were not changed after the first look at the results.

Matched controls run the same yielding loop on both sides, with no busy spin.

The strong change spins the main thread toward 40 ms, then yields, and repeats that for the baseline window only. The after window does not spin. Each spin is timed with `performance.now()` independently of the recorder. The expected direction is a lower after p95. An improvement is counted only when `compareTrials` returns `valid: true` and `improvement: true`. An inconclusive or invalid result is not a detection.

Headless Edge 156.0.4314.50. Rows were recorded from 2026-10-28T20:51:18Z through 2026-10-28T20:55:15Z. Raw rows are local, in `qa-local/comparison-reliability-elapsed.json`. An earlier file that mixed nominal-duration strong rows with a later control rerun is kept as `qa-local/comparison-reliability-superseded-mixed.json` and is not used below.

Commands, from this folder:

```powershell
node tests/run-comparison-reliability.mjs control 0 5
node tests/run-comparison-reliability.mjs control 5 5
node tests/run-comparison-reliability.mjs control 10 5
node tests/run-comparison-reliability.mjs control 15 5
node tests/run-comparison-reliability.mjs strong 0 5
node tests/run-comparison-reliability.mjs strong 5 5
node tests/run-comparison-reliability.mjs strong 10 5
node tests/run-comparison-reliability.mjs strong 15 5
```

## Results

All 40 attempts used this elapsed-duration protocol. None were excluded for an unusable trial. Sample counts were 12 or 13 when idle, and 8 on every strong baseline trial.

Elapsed time versus the 1000 ms nominal window was 1000–1005.7 ms for controls, 1000.7–1036.5 ms for strong baselines, and 1000–1005.9 ms for strong after-trials. None of those gaps reached the core mismatch limit (the larger of 250 ms and 15% of the reference duration), so none were rejected for duration.

| Set | Attempted | Excluded | Kept | `valid` | Inconclusive | Valid improvement |
| --- | --- | --- | --- | --- | --- | --- |
| Matched control | 20 | 0 | 20 | 0 | 20 | 0 |
| Strong synthetic speedup | 20 | 0 | 20 | 20 | 0 | 20 |

False positives are valid improvements on controls: 0 of 20 attempts. True positives are valid improvements on the strong set: 20 of 20 attempts. Inconclusive controls are not counted as detections.

Control reasons were 12 near-zero baseline tails and 8 deltas below the meaningful threshold. Their median-p95 deltas were about -1.1 ms to +1.1 ms. Baseline median p95 was about 4.1–5.5 ms.

Strong baselines independently recorded a median of about 920 ms of busy time inside the nominal window. Trial p95 was about 54–75 ms on those baselines and about 4.1–5.9 ms after. Valid deltas were about -51.3 ms to -49.9 ms, all in the expected direction.

## Conclusion

On this machine, in that Edge session, idle matched trials produced no valid improvement claim. The 40 ms spin did make probes late: the measured tail dropped by about 50 ms, and all 20 strong comparisons were valid improvements. The thresholds were not edited.

This does not show that a 12 second vault session will detect a real user change, or that a missed rare stall will be seen.
