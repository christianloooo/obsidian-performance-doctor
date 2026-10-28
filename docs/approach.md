# Approach

Performance Doctor measures how late a short foreground callback ran while you repeat one task. That number is scheduling delay. It is not CPU time, not a startup time, and not the cause of a slow vault.

The display name is Performance Doctor. The manifest `name` must not contain "Obsidian" ([manifest rules](https://docs.obsidian.md/Reference/Manifest)).

## What already exists

Startup timing is already covered. Obsidian's own startup timer is documented in the [load-time guide](https://docs.obsidian.md/plugins/guides/load-time). [Lazy Loader](https://github.com/alangrainger/obsidian-lazy-plugins) delays plugin activation. [Startup Metrics Logger](https://github.com/hannesdelbeke/obsidian-startup-metrics-logger) records launch time, per-plugin init time, history, and exports. [Divide and Conquer](https://github.com/mikedidomizio/obsidian-divide-and-conquer) is a manual way to turn groups of plugins and snippets off. This plugin does not do those jobs, and it does not toggle plugins.

People have asked for runtime observation that is not a raw profiler, including [event and performance discussion](https://forum.obsidian.md/t/events-observation-and-control-for-performance/83574) and [which plugins slow indexing](https://forum.obsidian.md/t/identifying-which-plugins-are-slowing-down-indexing/84577). Those threads are not evidence that any particular vault is slow, and this plugin does not attribute a delay to a plugin.

## What this plugin does

A fixed 12 second run records how late each check was. You keep the task, file, and settings the same, make one change you can undo, and repeat the run. A comparison uses repeated trials. It can say there is no clear change. It does not name a culprit.

Inventory is separate. It counts files with the public `Vault.getFiles()` and `TFile.stat` APIs and does not read note text. It does not run during a recording.

The redacted report is the only JSON view. It keeps an allowlist of aggregate fields and drops vault name, paths, plugin lists, and typed text.

## API limits

Icons use Obsidian's built-in `setIcon` and `getIcon` ([setIcon](https://docs.obsidian.md/Reference/TypeScript+API/setIcon), [icon guide](https://docs.obsidian.md/Plugins/User%20interface/Icons)). The names are Lucide names already shipped with Obsidian. This plugin does not add a Lucide package.

The measurement core does not use `app.plugins`, monkey patching, `performance.memory`, Electron, or the network. A hidden or cancelled run is discarded. It is not recorded as a slow run.
