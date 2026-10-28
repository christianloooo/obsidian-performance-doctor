import { build } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({
  absWorkingDir: root,
  entryPoints: [path.join(root, 'src', 'obsidian', 'main.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  external: ['obsidian'],
  outfile: path.join(root, 'tests', 'adapter-bundle.cjs'),
});

const notices = [];
const opened = [];
const obsidian = {
  Platform: { isWin: true, isMacOS: false, isLinux: false },
  apiVersion: '1.14.5',
  Notice: class { constructor(message) { notices.push(String(message)); } },
  Modal: class {
    constructor() {
      this.titleEl = { setText() {} };
      this.contentEl = { empty() {}, createEl() { return { setText() {}, addEventListener() {} }; } };
    }
    open() { opened.push('modal'); }
    close() {}
  },
  Plugin: class {
    constructor(app, manifest) { this.app = app; this.manifest = manifest; }
    addCommand() {}
    addSettingTab() {}
    addStatusBarItem() { return { setText() {} }; }
    registerDomEvent() {}
    register() {}
    loadData() { return Promise.resolve(null); }
    saveData() { return Promise.resolve(); }
  },
  PluginSettingTab: class { constructor() {} },
  Setting: class {
    setName() { return this; }
    setDesc() { return this; }
    addDropdown() { return this; }
  },
  TFile: class {},
  getIcon: () => null,
  setIcon() {},
  setTooltip() {},
};

const require = createRequire(path.join(root, 'package.json'));
const Module = require('module');
const original = Module.prototype.require;
Module.prototype.require = function(id) {
  if (id === 'obsidian') return obsidian;
  return original.apply(this, arguments);
};
const { default: PerformanceDoctorPlugin } = require(path.join(root, 'tests', 'adapter-bundle.cjs'));

function plugin() {
  const instance = new PerformanceDoctorPlugin({ vault: { getFiles() { return []; } } }, { version: '0.1.0' });
  instance.ready = true;
  instance.saveData = () => Promise.reject(new Error('disk full'));
  return instance;
}

const samples = Array.from({ length: 12 }, (_, index) => ({ scheduledAt: index, executedAt: index + 20, delay: 20 }));

notices.length = 0;
opened.length = 0;
const recording = plugin();
recording.data = { experimentId: 1, workload: 'typing', trials: [] };
recording.session = {
  getSamples: () => samples,
  isValid: () => true,
  getTerminal: () => ({ status: 'completed', reason: 'stopped' }),
};
await recording.finishRecording(recording.gate.capture(), 'baseline', true);
assert.equal(recording.data.trials.length, 0);
assert.equal(opened.length, 0);
assert.equal(notices.some((message) => message.startsWith('Saved ')), false);
assert.equal(notices.some((message) => message.includes('Could not save')), true);

notices.length = 0;
const workload = plugin();
workload.data = { experimentId: 1, workload: 'typing', trials: [] };
await workload.setWorkload('scrolling');
assert.equal(workload.data.workload, 'typing');
assert.equal(opened.length, 0);

notices.length = 0;
const deleted = plugin();
deleted.data = { experimentId: 1, workload: 'typing', trials: [{ condition: 'baseline' }] };
await deleted.deleteHistory();
assert.equal(deleted.data.experimentId, 1);
assert.equal(deleted.data.trials.length, 1);
assert.equal(notices.some((message) => message.includes('deleted')), false);
assert.equal(notices.some((message) => message.includes('Could not save')), true);

notices.length = 0;
const replaced = plugin();
replaced.data = { experimentId: 1, workload: 'typing', trials: [{ condition: 'baseline' }] };
await replaced.replaceExperiment();
assert.equal(replaced.data.experimentId, 1);
assert.equal(replaced.data.trials.length, 1);
assert.equal(notices.some((message) => message.startsWith('Experiment ')), false);

console.log(JSON.stringify({ adapterDiskFailures: 'pass' }));
