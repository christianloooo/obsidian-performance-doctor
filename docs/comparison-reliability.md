# Comparison reliability study

This is a synthetic browser study of `compareTrials`. It is not a user pilot, not a CPU measurement, not a real-vault result, and not a validation of the product's 12 second recording.

## Protocol

The page imports the same harness core bundle as the other browser checks (`createMeasurementSession`, `summarize`, `compareTrials`). Each comparison is 3 baseline trials and 3 after trials.

Each trial is a disclosed 1000 ms window with an 80 ms probe interval, not the product's 12 second window. A trial is kept only when the session completes and has at least 8 conclusive samples. Duration metadata is the planned 1000 ms on both sides. The raw log also stores the measured wall time.

Matched controls run the same yielding loop on both sides, with no busy spin.

The strong change spins the main thread toward 40 ms, then yields, and repeats that for the baseline window only. The after window does not spin. Each spin is timed with `performance.now()` independently of the recorder. The expected direction is a lower after p95, which is the only direction `compareTrials` can call an improvement. The thresholds were not changed: meaningful drop at least 5 ms and 10% of the baseline p95, and within-side p95 coefficient of variation at most 0.35.

Command, from this folder:

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

40 of 40 comparisons were kept. None were discarded for a short or invalid trial. Sample counts were 12 or 13 on controls and 8 to 13 on the strong baselines.

| Set | n | Improvement claimed | Other results |
| --- | --- | --- | --- |
| Matched control | 20 | 0 | 9 near-zero baseline tail, 11 tail delta below the meaningful threshold |
| Strong synthetic speedup | 20 | 19 | 1 high within-condition p95 noise |

Control deltas of median p95 were about -1.3 ms to +0.8 ms, median about 0 ms. No control was called an improvement.

Strong baseline trials independently recorded about 920 ms of busy time inside the 1000 ms window. Kept strong deltas of median p95 were about -51.6 ms to -49.8 ms, median about -50.5 ms. Nineteen were called improvements, in the expected direction.

The one strong comparison that was not called an improvement still moved about -51.4 ms (baseline median p95 about 56 ms, after about 4.7 ms). Its after-side p95 values were about 4.0, 4.7, and 9.8 ms, so the coefficient of variation exceeded 0.35. The existing rule refused the claim. That is an inconclusive result, not a wrong-direction claim.

## Conclusion

On this machine, in headless Edge, the current rule did not claim an improvement when both sides were idle. It usually detected a large, independently timed main-thread speedup, and once refused that same speedup because the fast side was noisy in relative terms. There is no evidence from this study for changing the thresholds.

This does not show that a 12 second vault session will detect a real user change, or that a missed rare stall will be seen.
