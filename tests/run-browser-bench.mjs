import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = spawnSync(process.execPath, ['esbuild.config.mjs', '--harness-core'], {
  cwd: root,
  stdio: 'inherit',
});
if (built.status !== 0) process.exit(built.status ?? 1);

const edgeCandidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const edge = edgeCandidates.find((p) => existsSync(p));
if (!edge) {
  console.error('Edge executable not found. Browser bench not run.');
  process.exit(2);
}

const { chromium } = await import('playwright-core');

const harness = path.join(root, 'harness');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const rel = url.pathname === '/' ? 'bench.html' : url.pathname.replace(/^\/+/, '');
  const file = path.join(harness, rel);
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
let browser;
try {
  browser = await chromium.launch({
    executablePath: edge,
    headless: true,
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/bench.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.body.dataset.done === '1', { timeout: 120000 });
  const result = await page.evaluate(() => window.__BENCH__);
  const out = path.join(root, 'docs', 'bench-browser.json');
  writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({
    browser: edge,
    validEvidence: result.validEvidence,
    invalidReasons: result.invalidReasons,
    pairs: result.kept.map((pair) => ({
      elapsedOff: Number(pair.off.elapsedMs.toFixed(2)),
      elapsedOn: Number(pair.on.elapsedMs.toFixed(2)),
      samples: pair.on.sampleCount,
      completed: pair.on.completedChunks,
    })),
  }, null, 2));
  console.log('Wrote', out);
  if (!result.validEvidence) process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
