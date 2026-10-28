# Privacy

Performance Doctor does not phone home. It does not include telemetry, analytics, or a network request.

## What a recording stores

A saved trial is a small local record in the plugin's own data: condition (`baseline` or `after`), probe interval, duration, sample count, delay summary (min, max, mean, percentiles, inconclusive flag), platform enum, app version, plugin version, and `terminal: completed`.

Preview, copy, and reload use one nested validator. It copies only those scalars. A free-text `reason`, an unknown nested field, a non-finite or negative number, or a sample count that does not match the summary is refused. The text in the modal's copy button is the same JSON as the preview.

It does not store note text, file paths, the vault name, a plugin list, or anything you typed.

History is capped at 24 trials. The command **Delete saved responsiveness history** replaces that data with an empty list. If the write fails, the plugin says the history was not deleted.

Rows that fail validation are dropped on load and are not shown.

## What the modal and clipboard can hold

The copy button copies the redacted report only, after a check that the JSON has only the allowed fields and no path or address characters. Inventory results are counts and extension buckets, not paths, and they are not copied by that button.

## What inventory reads

Inventory uses `Vault.getFiles()` and `TFile.stat` (size and extension bucket). It does not read note contents. It does not run during a recording. It does not write the vault.

## What this file does not claim

No external privacy review has been done. The proposed pilot gate is zero privacy, settings, or content-write defects. That gate has not been run.
