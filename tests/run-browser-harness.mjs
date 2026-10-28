import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const mainJs = readFileSync(path.join(root, 'main.js'), 'utf8');
const bundleProblems = ['compareTrialSummaries', 'blockMainThread', 'runBlock('].filter((needle) => mainJs.includes(needle));
if (bundleProblems.length > 0) {
  console.error('Shipped bundle contains test-only API:', bundleProblems.join(', '));
  process.exit(1);
}

const { chromium } = await import('playwright-core');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const rel = url.pathname === '/' ? 'browser-harness.html' : url.pathname.replace(/^\/+/, '');
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
const browser = await chromium.launch({ executablePath: edge, headless: true });
const errors = [];
try {
  const page = await browser.newPage();
  const client = await page.context().newCDPSession(page);
  let traceNote = 'not collected';
  try {
    await client.send('Tracing.start', { categories: 'devtools.timeline' });
    traceNote = 'started';
  } catch (error) {
    traceNote = `trace start failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  await page.goto(`http://127.0.0.1:${port}/browser-harness.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.body.dataset.done === '1', { timeout: 30000 });
  const result = await page.evaluate(() => window.__HARNESS__);
  if (traceNote === 'started') {
    try {
      await client.send('Tracing.end');
      traceNote = 'ended';
    } catch (error) {
      traceNote = `trace end failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  const controlMax = result.control.max;
  for (const ms of [75, 150, 300]) {
    const row = result.blocks[String(ms)];
    const measuredMax = Math.max(...row.during, 0);
    if (!(row.injectedMs >= ms * 0.8)) errors.push(`${ms} injected clock ${row.injectedMs}`);
    if (!(measuredMax >= row.injectedMs * 0.5)) errors.push(`${ms} recorder max ${measuredMax} vs injected ${row.injectedMs}`);
    if (!(measuredMax > controlMax)) errors.push(`${ms} max ${measuredMax} did not exceed clean control ${controlMax}`);
  }
  if (result.invalid.afterHide.terminal.status !== 'invalid') errors.push('hide did not invalidate');
  if (result.invalid.afterHide.samples !== 0) errors.push('hide kept samples');
  if (result.invalid.cancel.terminal.status !== 'invalid') errors.push('cancel did not invalidate');
  const out = { errors, controlMax, blocks: result.blocks, invalid: result.invalid, traceNote };
  writeFileSync(path.join(root, 'docs', 'browser-block-results.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ errors, controlMax, traceNote, blocks: Object.fromEntries(Object.entries(result.blocks).map(([ms, row]) => [ms, { injectedMs: row.injectedMs, max: Math.max(...row.during, 0), samples: row.during.length }])) }, null, 2));
  if (errors.length > 0) process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
