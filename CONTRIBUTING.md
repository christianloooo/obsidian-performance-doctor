# Contributing

Performance Doctor 0.1.0 is an experimental prerelease. It is not production-ready, and it has not been verified on mobile or on every desktop operating system. Community-directory submission is not done.

## What to keep it for

Measure a slowdown, then test whether one manual change helped. Record foreground scheduling delay only. That number is not the culprit. Do not add startup timing or automatic plugin bisection. Those already exist elsewhere.

## Checks

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

`typecheck` is `tsc --noEmit`. It is not a linter. `npm test` rebuilds the core bundle and runs the Node regressions. Do not claim a gate you did not run.

## Privacy

Do not add note reads, path logging, telemetry, or an unredacted export. See `docs/privacy.md` and `docs/security.md`.

## Scope

After two failed focused pilot iterations, contribute the idea to an existing tool or pivot instead of adding features. The bars in `docs/pilot-and-maintenance.md` are proposed, not achieved.
