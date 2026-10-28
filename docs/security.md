# Security

This plugin is local and experimental. It is not a security product and it has not had an external audit.

## Boundaries

- No network requests and no telemetry.
- No automatic plugin enable or disable.
- No vault file writes. The only persistence is the plugin data store for trial history.
- No note contents. Inventory uses public file stats only.
- No scraping of internal plugin objects.
- The measurement core does not import Electron.
- Default export is an explicit field list. Unknown platform or version strings become `unknown`.
- Extension totals use a null-prototype map and a closed set of extensions, so a strange suffix cannot become a prototype key or appear as its own bucket.
- A session that is hidden, blurred, cancelled, or unloaded is invalid and is not saved as a measurement.
- Clipboard text is rejected if it contains a disallowed field, a slash, or an `@`.

## Reporting

Use the privacy issue template for anything that might leak vault data. Do not paste a vault path, note text, or an unredacted export into an issue.
