# Verification

Performance Doctor 0.1.0 is an experimental prerelease. It is not production-ready. It was not tested on mobile or on another operating system. Community-directory submission has not been done.

The only Obsidian version run was 1.14.5, on Windows, in an isolated disposable vault. The personal app-data directory was not used.

## Package

Built locally for the release asset. These files are not committed.

| File | sha256 | Bytes |
| --- | --- | --- |
| `main.js` | `2b7ea67577323a60c1f33c46c80b1aaa052b121ff44ad3cbb2167150e50a541b` | 26888 |
| `manifest.json` | `62d2242af1c5d1428d5fdeb310baa250173db8a74100a544b55002a8c973964e` | 503 |
| `styles.css` | `44bcb2102e344dd0937ade685ecad2b6f1cac1beb037433eb92d5e9150ff6fc9` | 918 |
| release zip | `59f073730435db16efc19bef481a91af5b2093e723c02f3c90dfe9263bb9741e` | 9393 |

The zip contains only those three files.

## Commands on this source

- `npm run typecheck` (`tsc --noEmit`) exited 0.
- `npm test`: 18 core checks passed, then the adapter disk-full check passed.

The browser harness was run on this measurement core before the final front-door sentence. It reported no assertion errors. Clean-run max was about 2.6 ms. Armed 75 / 150 / 300 ms loops measured recorder max about 65.8 / 141.3 / 291.4 ms. The 300 ms sample was a little under the injected loop, so it is not an exact match. That harness was not repeated after the sentence change, which does not affect measurement.

## Obsidian host

A full cycle on Obsidian 1.14.5, before the final front-door sentence, used the same measurement code:

- No host errors. The plugin loaded. The installed `main.js` matched that build. The personal app-data directory stayed absent.
- Front-door buttons ran: compare, preview, inventory, and record baseline. Compare stayed blocked during a recording.
- A saved run was prose: "Run saved." 130 checks. Typical 13 ms late. 95% no more than 15 ms late. Slowest 16 ms. JSON was not shown.
- Three baseline runs and three after runs compared at 15 ms on both sides. The result was "No clear change measured."
- JSON appeared only for Preview redacted report.
- `getIcon` accepted `activity`, `gauge`, `play`, `square`, `git-compare`, `copy`, and `trash-2`. The dialog rendered five of those icons, each with a visible label.
- Light, dark, and a narrow modal used the interface font and did not overflow. Focus started on Record baseline. Tab moved it to Compare.
- Quitting the process and starting it again kept baseline 3 of 3 and after 3 of 3. After delete, a second fresh start showed baseline 0 of 3.

The front-door note was then shortened. It no longer mentions a 95% figure before a run exists. A later isolated launch opened the dialog, waited out notices, and saved the modal itself. The text included "Measurements show callback lateness, not a culprit" and did not include "that delay" or "95%". The recording cycle was not repeated for that sentence.

Current dialog shots: `docs/screenshots/modal-light.png`, `modal-dark.png`, and `modal-narrow.png`. Full-window copies: `front-light.png`, `front-dark.png`, and `front-narrow.png`. The saved-run shot `result-light.png` is from the earlier cycle.

## Not claimed

Any other Obsidian version, mobile, another operating system, the pilot bars in `docs/pilot-and-maintenance.md`, or a community-directory listing.
