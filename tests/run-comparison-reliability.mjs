/**
 * Standalone browser study of compareTrials.
 * Uses the same harness core bundle as the other browser checks.
 * Not part of npm test. Not a 12 second vault benchmark.
 *
 * node tests/run-comparison-reliability.mjs <control|strong> <startIndex> <count>
 */
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const kind = process.argv[2];
const startIndex = Number(process.argv[3]);
const count = Number(process.argv[4]);
if ((kind !== 'control' && kind !== 'strong') || !Number.isInteger(startIndex) || !Number.isInteger(count) || count < 1) {
  console.error('usage: node tests/run-comparison-reliability.mjs <control|strong> <startIndex> <count>');
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = spawnSync(process.execPath, ['esbuild.config.mjs', '--harness-core'], { cwd: root, stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);

const edge = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((item) => existsSync(item));
if (!edge) {
  console.error('Edge not found');
  process.exit(2);
}

const harness = path.join(root, 'harness');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const rel = url.pathname === '/' ? 'comparison-reliability.html' : url.pathname.replace(/^\/+/, '');
  const file = path.normalize(path.join(harness, rel));
  if (!file.startsWith(harness)) {
    res.writeHead(403);
    res.end('no');
    return;
  }
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('missing');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;

const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: edge, headless: true });
let batch = [];
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);
  await page.goto(`http://127.0.0.1:${port}/comparison-reliability.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.body.dataset.ready === '1', { timeout: 30000 });
  batch = await page.evaluate(
    ([nextKind, nextCount, nextStart]) => window.__runBatch(nextKind, nextCount, nextStart),
    [kind, count, startIndex],
  );
} finally {
  await browser.close();
  server.close();
}

const outDir = path.join(root, 'qa-local');
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'comparison-reliability.json');
const prior = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : {
  windowMs: 1000,
  probeIntervalMs: 80,
  strongBlockTargetMs: 40,
  trialsPerSide: 3,
  rows: [],
};
const keys = new Set(prior.rows.map((row) => `${row.kind}:${row.index}`));
for (const row of batch) {
  if (!keys.has(`${row.kind}:${row.index}`)) prior.rows.push(row);
}
writeFileSync(outFile, JSON.stringify(prior, null, 2));
const kept = batch.filter((row) => row.kept).length;
const claimed = batch.filter((row) => row.observedImprovement === true).length;
console.log(JSON.stringify({ kind, startIndex, count, kept, claimed, totalRows: prior.rows.length }));
