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
const result = await Core.runPairedBenchmark();
const out = path.join(root, 'docs', 'bench-node.json');
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify({
  validEvidence: result.validEvidence,
  invalidReasons: result.invalidReasons,
  pairs: result.kept.map((pair) => ({
    completedOff: pair.off.completedChunks,
    completedOn: pair.on.completedChunks,
    elapsedOff: Number(pair.off.elapsedMs.toFixed(2)),
    elapsedOn: Number(pair.on.elapsedMs.toFixed(2)),
    samples: pair.on.sampleCount,
    selfMs: Number(pair.on.probeCallbackSelfTimeMs.toFixed(3)),
    p50: Number(pair.on.delayP50.toFixed(2)),
  })),
}, null, 2));
console.log('Wrote', out);
console.log(result.note);
if (!result.validEvidence) process.exit(1);
