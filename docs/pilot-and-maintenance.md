# Pilot and maintenance

These gates are **proposed**. None of them have been run. Do not describe them as achieved.

The product sentence is: measure a slowdown, then test whether one manual change helped. Scheduling delay is not a culprit. An inconclusive result is a successful outcome when the runs do not support a claim.

No telemetry. Download counts are not active users. Do not publish, submit, or recruit until the founder explicitly approves outreach.

## Proposed pilot

A 12-person, 2-week pilot starts only after that approval. Volunteers use their own vaults. This repository does not contact them.

| Gate | Proposed bar | Status |
| --- | --- | --- |
| Independently finish a baseline / change / after comparison | 10 of 12 within 15 minutes, without the author driving the session | Not run |
| Understand the limit of the number | 10 of 12 can say scheduling delay is not the culprit, and that inconclusive means the runs do not support a claim | Not run |
| Leave with a useful next step | 8 of 12 can name the next experiment or say the redacted report is what they would keep | Not run |
| Same-condition control | At least 18 of 20 repeated comparisons with no real change stay inconclusive | Not run |
| Known strong change | At least 18 of 20 comparisons around an independently verified change move in the correct direction on p95 | Not run |
| Privacy and writes | Zero defects: no note contents, no paths, no vault name, no plugin list, no typed text in the default export; no settings or vault writes except the plugin's own saved trials | Not run |
| Later reuse | People who hit a new lag open it again on their own. That is episodic use, not a retention or active-user metric | Not run |

## After two failed iterations

Run at most two focused pilot iterations. A failed iteration is one that misses any of the bars above after a repair aimed at that bar.

If the second iteration still fails, stop adding product scope. Recommend contributing the measurement idea to an existing tool, or pivoting. Divide & Conquer already helps isolate plugins by hand. Obsidian's own startup-time debug already covers launch timing. This project should not become a third startup profiler or an automatic bisector.

## Maintenance while it stays local

- Keep `docs/status.md` tied to commands that were actually run.
- Do not claim a host, platform, or overhead result without the command output.
- Cap saved trials at 24. Delete history is a user command, and it must clear plugin data.
- Reject stored rows that fail validation instead of showing them.
- If saving fails, say so and do not claim the trial was stored.
- Clipboard and modals may carry only the redacted report text that passed the export check.
- No network calls from the plugin.
