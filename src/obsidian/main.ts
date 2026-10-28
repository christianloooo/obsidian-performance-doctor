import { Modal, Notice, Platform, Plugin, PluginSettingTab, Setting, TFile, apiVersion, getIcon, setIcon, setTooltip, type App } from 'obsidian';
import { ActivityGate } from '../core/lifecycle';
import { addInventoryEntry, createInventoryTotals } from '../core/inventory';
import { buildReport, clipboardExport, previewReport } from '../core/report';
import { parseStoredTrials, rememberTrial, type StoredTrial } from '../core/storage';
import { compareTrials, type ComparableTrial, summarize } from '../core/statistics';
import type { PerformanceReport, SessionController, Workload } from '../core/types';
import { createMeasurementSession } from '../core/measurement';

const WORKLOADS: Workload[] = ['typing', 'scrolling', 'opening-notes', 'other-repeated-task'];
const TASK_LABEL: Record<Workload, string> = {
  typing: 'Typing',
  scrolling: 'Scrolling',
  'opening-notes': 'Opening notes',
  'other-repeated-task': 'Other repeated task',
};
const FIXED_RECORDING_MS = 12000;
const PROBE_INTERVAL_MS = 80;
const MIN_SAMPLES = 8;
const INVENTORY_CHUNK = 200;
const NEEDED = 3;
const STALL_MS = 50;

interface PluginData {
  experimentId: number;
  workload: Workload;
  trials: StoredTrial[];
}

function taskLabel(workload: Workload): string {
  return TASK_LABEL[workload];
}

function paintIcon(parent: HTMLElement, iconId: string): void {
  parent.empty();
  if (!getIcon(iconId)) return;
  setIcon(parent, iconId);
}

function detectedPlatform(): string {
  if (Platform.isWin) return 'win32';
  if (Platform.isMacOS) return 'darwin';
  if (Platform.isLinux) return 'linux';
  return 'unknown';
}

function toComparable(trial: StoredTrial): ComparableTrial {
  return {
    summary: trial.summary,
    meta: {
      platform: trial.platform,
      appVersion: trial.appVersion,
      pluginVersion: trial.pluginVersion,
      scenario: trial.condition,
      workload: trial.workload,
      experimentId: trial.experimentId,
      durationMs: trial.durationMs,
      probeIntervalMs: trial.probeIntervalMs,
      terminal: trial.terminal,
    },
  };
}

export default class PerformanceDoctorPlugin extends Plugin {
  private data: PluginData = { experimentId: 1, workload: 'typing', trials: [] };
  private readonly gate = new ActivityGate();
  private statusEl: HTMLElement | null = null;
  private session: SessionController | null = null;
  private recordTimer: number | null = null;
  private inventoryTimer: number | null = null;
  private ready = false;

  async onload(): Promise<void> {
    const token = this.gate.capture();
    let stored: unknown = null;
    try {
      stored = await this.loadData();
    } catch {
      if (!this.gate.current(token)) return;
      new Notice('Could not read saved history. Starting from an empty experiment.');
    }
    if (!this.gate.current(token)) return;
    const parsed = parseStoredTrials(stored);
    const workload = this.readWorkload(stored);
    const experimentId = this.readExperimentId(stored);
    this.data = {
      experimentId,
      workload,
      trials: parsed.trials.filter((trial) => trial.experimentId === experimentId && trial.workload === workload),
    };
    if (parsed.dropped > 0) new Notice(`Ignored ${parsed.dropped} saved trial${parsed.dropped === 1 ? '' : 's'} that failed validation.`);
    this.statusEl = this.addStatusBarItem();
    const iconIds = ['activity', 'gauge', 'play', 'square', 'git-compare', 'copy', 'trash-2'];
    this.statusEl.dataset.pdIcons = iconIds.filter((id) => getIcon(id)).join(' ');
    this.refreshStatus();
    if (getIcon('activity')) this.addRibbonIcon('activity', 'Performance Doctor', () => this.openGuide());
    this.addSettingTab(new WorkloadTab(this.app, this));
    this.addCommand({ id: 'open-guide', name: 'Open experiment guide', callback: () => this.openGuide() });
    this.addCommand({ id: 'record-baseline', name: 'Record baseline run', callback: () => this.startRecording('baseline') });
    this.addCommand({ id: 'record-after', name: 'Record after-change run', callback: () => this.startRecording('after') });
    this.addCommand({ id: 'discard-recording', name: 'Discard current recording', callback: () => this.discardRecording() });
    this.addCommand({ id: 'compare-trials', name: 'Compare this experiment', callback: () => this.showComparison() });
    this.addCommand({ id: 'preview-export', name: 'Preview redacted report', callback: () => this.showExport() });
    this.addCommand({ id: 'new-experiment', name: 'Start a new experiment', callback: () => this.confirmNewExperiment() });
    this.addCommand({ id: 'delete-history', name: 'Delete saved responsiveness history', callback: () => this.deleteHistory() });
    this.addCommand({ id: 'inventory', name: 'Aggregate vault inventory (no note contents)', callback: () => this.startInventory() });
    this.registerDomEvent(document, 'visibilitychange', () => {
      if (document.hidden) this.session?.notifySuspension('hidden');
    });
    this.registerDomEvent(window, 'blur', () => {
      this.session?.notifySuspension('blur');
    });
    this.registerDomEvent(window, 'pagehide', () => {
      this.session?.notifySuspension('pagehide');
    });
    this.register(() => this.shutdown());
    this.ready = true;
  }

  onunload(): void {
    this.shutdown();
  }

  getWorkload(): Workload {
    return this.data.workload;
  }

  async setWorkload(next: Workload): Promise<void> {
    if (!this.guardIdle('Change the workload after the recording or inventory finishes.')) return;
    if (next === this.data.workload) return;
    if (this.data.trials.length > 0) {
      new Notice('Workload stays with this experiment. Start a new experiment before using a different task.');
      return;
    }
    const previous = this.data.workload;
    const token = this.gate.capture();
    this.data.workload = next;
    const saved = await this.persist(token);
    if (!this.gate.current(token)) return;
    if (!saved) this.data.workload = previous;
    this.refreshStatus();
  }

  private readWorkload(stored: unknown): Workload {
    const value = stored && typeof stored === 'object' ? (stored as { workload?: unknown }).workload : undefined;
    return WORKLOADS.includes(value as Workload) ? value as Workload : 'typing';
  }

  private readExperimentId(stored: unknown): number {
    const value = stored && typeof stored === 'object' ? (stored as { experimentId?: unknown }).experimentId : undefined;
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 1;
  }

  private shutdown(): void {
    this.gate.unload();
    this.session?.cancel('unloaded');
    this.session = null;
    if (this.recordTimer !== null) {
      window.clearTimeout(this.recordTimer);
      this.recordTimer = null;
    }
    if (this.inventoryTimer !== null) {
      window.clearTimeout(this.inventoryTimer);
      this.inventoryTimer = null;
    }
    this.setStatus('');
  }

  private setStatus(text: string): void {
    if (this.statusEl) this.statusEl.setText(text);
  }

  private refreshStatus(): void {
    if (this.gate.recording) return;
    this.setStatus(`${taskLabel(this.data.workload)} · baseline ${this.baselineCount()}/${NEEDED} · after ${this.afterCount()}/${NEEDED}`);
  }

  private guardIdle(message: string): boolean {
    if (!this.ready || this.gate.unloaded || this.gate.busy()) {
      new Notice(message);
      return false;
    }
    return true;
  }

  private baselineCount(): number {
    return this.data.trials.filter((trial) => trial.condition === 'baseline').length;
  }

  private afterCount(): number {
    return this.data.trials.filter((trial) => trial.condition === 'after').length;
  }

  private nextAction(): string {
    const task = taskLabel(this.data.workload);
    const baseline = this.baselineCount();
    const after = this.afterCount();
    if (baseline < NEEDED) return `Record ${NEEDED - baseline} more baseline run${NEEDED - baseline === 1 ? '' : 's'} of the same ${task} task.`;
    if (after === 0) return 'Make one manual reversible change, then record an after run of that same task.';
    if (after < NEEDED) return `Record ${NEEDED - after} more after run${NEEDED - after === 1 ? '' : 's'}. Do not change anything else.`;
    return 'Compare this experiment. If there is no clear change, restore the change.';
  }

  private startRecording(condition: 'baseline' | 'after'): void {
    if (!this.guardIdle('Finish the current recording, save, or inventory first.')) return;
    if (condition === 'after' && this.baselineCount() < NEEDED) {
      new Notice(this.nextAction());
      return;
    }
    const token = this.gate.capture();
    this.gate.recording = true;
    this.setStatus(condition === 'baseline' ? 'Recording baseline · 12 seconds' : 'Recording after change · 12 seconds');
    this.session = createMeasurementSession({
      probeIntervalMs: PROBE_INTERVAL_MS,
      maxSamples: 400,
      maxDurationMs: FIXED_RECORDING_MS + 10000,
      isSuspended: () => document.hidden || document.visibilityState === 'hidden',
      onEnded: (terminal) => {
        if (!this.gate.current(token)) return;
        void this.finishRecording(token, condition, terminal.status === 'completed');
      },
    });
    this.recordTimer = window.setTimeout(() => {
      this.recordTimer = null;
      if (!this.gate.current(token)) return;
      this.session?.stop();
    }, FIXED_RECORDING_MS);
    new Notice(`Recording ${condition} for ${FIXED_RECORDING_MS / 1000} seconds. Repeat the same ${taskLabel(this.data.workload)} task. No dialog is left open.`, 5000);
  }

  private discardRecording(): void {
    if (!this.session || !this.gate.recording) {
      new Notice('No recording is active.');
      return;
    }
    if (this.recordTimer !== null) {
      window.clearTimeout(this.recordTimer);
      this.recordTimer = null;
    }
    this.session.cancel('discarded');
    this.refreshStatus();
  }

  private async finishRecording(token: number, condition: 'baseline' | 'after', completed: boolean): Promise<void> {
    const session = this.session;
    this.session = null;
    this.gate.recording = false;
    if (this.recordTimer !== null) {
      window.clearTimeout(this.recordTimer);
      this.recordTimer = null;
    }
    this.refreshStatus();
    if (!session || !this.gate.current(token)) return;
    if (!completed || !session.isValid() || session.getTerminal().status !== 'completed') {
      if (this.gate.current(token)) new Notice('Recording discarded. It was hidden, cancelled, or did not finish the fixed window.');
      return;
    }
    const samples = session.getSamples();
    const summary = summarize(samples);
    const stalls = samples.filter((sample) => sample.delay >= STALL_MS).length;
    const report = buildReport(samples, {
      platform: detectedPlatform(),
      appVersion: apiVersion,
      pluginVersion: this.manifest.version,
      durationMs: FIXED_RECORDING_MS,
    });
    if (summary.isInconclusive || samples.length < MIN_SAMPLES) {
      if (this.gate.current(token)) {
        new Notice(`Not saved. ${summary.reason ?? 'Not enough samples.'}`);
        const measured = samples.length > 0;
        this.showText('Not saved', [
          'This run was not saved. This measures how late checks ran. It is not the cause.',
          `Checks: ${samples.length}`,
          measured ? `Typical: ${summary.p50.toFixed(0)} ms late` : 'Typical: not enough checks',
          measured ? `95%: no more than ${summary.p95.toFixed(0)} ms late` : '95%: not enough checks',
          'Not enough checks to keep this run.',
          this.nextAction(),
        ].join('\n'));
      }
      return;
    }
    const trial: StoredTrial = {
      condition,
      workload: this.data.workload,
      experimentId: this.data.experimentId,
      probeIntervalMs: PROBE_INTERVAL_MS,
      durationMs: FIXED_RECORDING_MS,
      sampleCount: report.sampleCount,
      summary: report.summary,
      platform: report.platform,
      appVersion: report.appVersion,
      pluginVersion: report.pluginVersion,
      terminal: 'completed',
    };
    const previousTrials = this.data.trials;
    this.data.trials = rememberTrial(previousTrials, trial);
    const saved = await this.persist(token);
    if (!this.gate.current(token)) return;
    if (!saved) {
      this.data.trials = previousTrials;
      return;
    }
    this.refreshStatus();
    new Notice(`Run saved. 95% of checks ran no more than ${summary.p95.toFixed(0)} ms late.`);
    this.showText('Run saved', [
      `${condition === 'baseline' ? 'Baseline' : 'After'} run saved. This measures how late checks ran. It is not the cause.`,
      `Checks: ${report.sampleCount}`,
      `Typical: ${summary.p50.toFixed(0)} ms late`,
      `95%: no more than ${summary.p95.toFixed(0)} ms late`,
      `Slowest: ${summary.max.toFixed(0)} ms late. Checks at or above ${STALL_MS} ms: ${stalls}. A rare stall can be missed.`,
      this.nextAction(),
    ].join('\n'));
  }

  private async persist(token: number): Promise<boolean> {
    let failed = false;
    let saved = false;
    try {
      const result = await this.gate.runSerialized(token, async () => {
        try {
          await this.saveData(this.data);
          return true;
        } catch {
          return false;
        }
      });
      saved = result === true && this.gate.current(token);
      failed = result === false;
    } catch {
      failed = true;
      saved = false;
    }
    if (failed && this.gate.current(token)) new Notice('Could not save local history. Nothing new was stored.');
    return saved;
  }

  private showComparison(): void {
    if (!this.guardIdle('Compare after the recording and save finish.')) return;
    const trials = this.data.trials.filter((trial) => trial.experimentId === this.data.experimentId && trial.workload === this.data.workload);
    const comparison = compareTrials(
      trials.filter((trial) => trial.condition === 'baseline').map(toComparable),
      trials.filter((trial) => trial.condition === 'after').map(toComparable),
    );
    const lines = [
      comparison.improvement ? 'Faster by more than the minimum gap. That is not the cause.' : 'No clear change measured.',
      `Experiment ${this.data.experimentId}. Task: ${taskLabel(this.data.workload)}.`,
      `Baseline ${this.baselineCount()} of ${NEEDED}. After ${this.afterCount()} of ${NEEDED}.`,
      comparison.baselineMedianP95 !== undefined
        ? `95% of checks ran no more than ${comparison.baselineMedianP95.toFixed(0)} ms late before the change, and ${comparison.afterMedianP95?.toFixed(0)} ms after.`
        : 'Not enough matched runs to compare a tail delay.',
      this.nextAction(),
    ];
    this.showText('This experiment', lines.join('\n'));
  }

  private showExport(): void {
    if (!this.guardIdle('Open the report after the recording and save finish.')) return;
    const latest = this.data.trials[this.data.trials.length - 1];
    if (!latest || latest.experimentId !== this.data.experimentId) {
      new Notice('No saved run in this experiment.');
      return;
    }
    const report: PerformanceReport = {
      platform: latest.platform,
      appVersion: latest.appVersion,
      pluginVersion: latest.pluginVersion,
      durationMs: latest.durationMs,
      sampleCount: latest.sampleCount,
      summary: latest.summary,
    };
    const body = this.safePreview(report);
    this.showText('Redacted report', `${body}\n\nNo vault name, paths, plugin list, typed text, or workload sentence.`, body);
  }

  private confirmNewExperiment(): void {
    if (!this.guardIdle('Start a new experiment after the current work finishes.')) return;
    new ConfirmModal(this.app, 'Replace the saved runs for this experiment?', () => {
      void this.replaceExperiment();
    }).open();
  }

  private async replaceExperiment(): Promise<void> {
    const token = this.gate.capture();
    if (!this.gate.current(token) || this.gate.busy()) return;
    const previous = this.data;
    this.data = { experimentId: previous.experimentId + 1, workload: previous.workload, trials: [] };
    const saved = await this.persist(token);
    if (!this.gate.current(token)) return;
    if (!saved) {
      this.data = previous;
      return;
    }
    this.refreshStatus();
    new Notice(`Experiment ${this.data.experimentId}. Record 3 baseline runs of ${taskLabel(this.data.workload)}. Previous runs are not reused.`);
  }

  private async deleteHistory(): Promise<void> {
    if (!this.guardIdle('Delete history after the current work finishes.')) return;
    const token = this.gate.capture();
    const previous = this.data;
    this.data = { experimentId: previous.experimentId + 1, workload: previous.workload, trials: [] };
    const saved = await this.persist(token);
    if (!this.gate.current(token)) return;
    if (!saved) {
      this.data = previous;
      return;
    }
    this.refreshStatus();
    new Notice('Saved responsiveness history deleted.');
  }

  private startInventory(): void {
    if (!this.guardIdle('Inventory waits until recording and saving finish.')) return;
    const token = this.gate.capture();
    this.gate.inventory = true;
    const files = this.app.vault.getFiles();
    const totals = createInventoryTotals();
    let index = 0;
    this.setStatus('Reading vault inventory');
    const step = (): void => {
      this.inventoryTimer = null;
      if (!this.gate.current(token)) {
        this.gate.inventory = false;
        return;
      }
      const end = Math.min(index + INVENTORY_CHUNK, files.length);
      for (; index < end; index++) {
        const file = files[index];
        if (!(file instanceof TFile)) continue;
        const size = file.stat?.size;
        addInventoryEntry(totals, file.extension ? `.${file.extension}` : 'other', typeof size === 'number' ? size : 0);
      }
      if (index < files.length) {
        this.inventoryTimer = window.setTimeout(step, 0);
        return;
      }
      this.gate.inventory = false;
      this.refreshStatus();
      if (!this.gate.current(token)) return;
      const buckets = Object.keys(totals.byExtension).sort().map((key) => `${key}: ${totals.byExtension[key]?.count ?? 0} files`).join('\n');
      this.showText('Vault inventory', `Files counted: ${totals.totalFiles}\nTotal bytes: ${totals.totalSize}\n\n${buckets}`);
    };
    step();
  }

  private openGuide(): void {
    if (!this.guardIdle('The guide waits until recording and saving finish.')) return;
    const baseline = this.baselineCount();
    const after = this.afterCount();
    const primary = baseline < NEEDED
      ? { icon: 'play', label: 'Record baseline · 12 seconds', run: () => this.startRecording('baseline') }
      : after < NEEDED
        ? { icon: 'play', label: 'Record after change · 12 seconds', run: () => this.startRecording('after') }
        : { icon: 'git-compare', label: 'Compare this experiment', run: () => this.showComparison() };
    const secondary = [
      { icon: 'git-compare', label: 'Compare this experiment', run: () => this.showComparison() },
      { icon: 'copy', label: 'Preview redacted report', run: () => this.showExport() },
      { icon: 'gauge', label: 'Vault inventory', run: () => this.startInventory() },
    ].filter((item) => item.label !== primary.label);
    new HomeModal(this.app, {
      lead: `Experiment ${this.data.experimentId}. ${taskLabel(this.data.workload)}.`,
      progress: `Baseline ${baseline} of ${NEEDED}. After ${after} of ${NEEDED}.`,
      note: 'Each run lasts 12 seconds. Repeat the same task, file, and settings. Make one reversible change after the baseline runs. Measurements show callback lateness, not a culprit.',
      actions: [{ ...primary, primary: true }, ...secondary.map((item) => ({ ...item, primary: false }))],
    }).open();
  }

  private safePreview(report: PerformanceReport): string {
    const text = previewReport(report);
    return clipboardExport(text);
  }

  private showText(title: string, body: string, copyText?: string): void {
    if (!this.ready || this.gate.unloaded || this.gate.recording || this.gate.saving) return;
    new TextModal(this.app, title, body, copyText).open();
  }
}

class WorkloadTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: PerformanceDoctorPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName('Repeated task')
      .setDesc('Closed choice used on both sides of this experiment. Not typed text, and not included in the redacted report.')
      .addDropdown((dropdown) => {
        for (const workload of WORKLOADS) dropdown.addOption(workload, taskLabel(workload));
        dropdown.setValue(this.plugin.getWorkload());
        dropdown.onChange((value) => {
          if (value === this.plugin.getWorkload()) return;
          void this.plugin.setWorkload(value as Workload).then(() => {
            if (dropdown.getValue() !== this.plugin.getWorkload()) dropdown.setValue(this.plugin.getWorkload());
          });
        });
      });
  }
}

class HomeModal extends Modal {
  constructor(app: App, private readonly view: {
    lead: string;
    progress: string;
    note: string;
    actions: { icon: string; label: string; primary: boolean; run: () => void }[];
  }) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('mod-pd');
    this.titleEl.setText('Performance Doctor');
    this.contentEl.empty();
    const lead = this.contentEl.createDiv({ cls: 'pd-lead' });
    const mark = lead.createSpan({ cls: 'pd-icon' });
    mark.setAttr('aria-hidden', 'true');
    paintIcon(mark, 'activity');
    lead.createSpan({ text: this.view.lead });
    this.contentEl.createEl('p', { text: this.view.progress });
    const actions = this.contentEl.createDiv({ cls: 'pd-actions' });
    let primaryButton: HTMLButtonElement | null = null;
    for (const action of this.view.actions) {
      const button = actions.createEl('button', { cls: action.primary ? 'mod-cta' : '' });
      button.setAttr('aria-label', action.label);
      const icon = button.createSpan({ cls: 'pd-icon' });
      icon.setAttr('aria-hidden', 'true');
      paintIcon(icon, action.icon);
      button.createSpan({ text: action.label });
      setTooltip(button, action.label);
      button.addEventListener('click', () => {
        this.close();
        action.run();
      });
      if (action.primary) primaryButton = button;
    }
    this.contentEl.createEl('p', { cls: 'pd-note', text: this.view.note });
    const close = this.contentEl.createEl('button', { text: 'Close' });
    close.addEventListener('click', () => this.close());
    window.setTimeout(() => (primaryButton ?? close).focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class ConfirmModal extends Modal {
  constructor(app: App, private readonly heading: string, private readonly onYes: () => void) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('mod-pd');
    this.titleEl.setText(this.heading);
    this.contentEl.empty();
    this.contentEl.createEl('p', { text: 'This deletes the saved runs for the current experiment. It does not change your notes.' });
    const yes = this.contentEl.createEl('button', { text: 'Replace saved runs' });
    yes.addEventListener('click', () => {
      this.close();
      this.onYes();
    });
    const no = this.contentEl.createEl('button', { text: 'Cancel' });
    no.addEventListener('click', () => this.close());
    window.setTimeout(() => no.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class TextModal extends Modal {
  constructor(app: App, private readonly heading: string, private readonly body: string, private readonly copyText?: string) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('mod-pd');
    this.titleEl.setText(this.heading);
    this.contentEl.empty();
    if (this.copyText === undefined) {
      const prose = this.contentEl.createDiv({ cls: 'pd-prose' });
      for (const line of this.body.split('\n')) {
        if (line.trim()) prose.createEl('p', { text: line });
      }
    } else {
      this.contentEl.createEl('p', { text: 'Redacted report. It has no vault name, paths, or typed notes.' });
      this.contentEl.createEl('pre', { cls: 'pd-report', text: this.copyText });
      const copy = this.contentEl.createEl('button', { text: 'Copy redacted report' });
      const icon = copy.createSpan({ cls: 'pd-icon' });
      icon.setAttr('aria-hidden', 'true');
      paintIcon(icon, 'copy');
      const text = this.copyText;
      copy.addEventListener('click', () => {
        void navigator.clipboard.writeText(text).then(
          () => new Notice('Copied the redacted report.'),
          () => new Notice('Could not copy the redacted report.'),
        );
      });
    }
    const close = this.contentEl.createEl('button', { text: 'Close' });
    close.addEventListener('click', () => this.close());
    window.setTimeout(() => close.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
