/**
 * Serializes plugin load/save against unload and a newer recording.
 * Callers must check `current` after every await before showing UI or starting work.
 */

export class ActivityGate {
  generation = 0;
  unloaded = false;
  saving = false;
  recording = false;
  inventory = false;
  private tail: Promise<void> = Promise.resolve();
  private saves = 0;

  busy(): boolean {
    return this.saving || this.recording || this.inventory;
  }

  capture(): number {
    return this.generation;
  }

  current(token: number): boolean {
    return !this.unloaded && token === this.generation;
  }

  unload(): void {
    this.unloaded = true;
    this.generation += 1;
    this.recording = false;
    this.inventory = false;
  }

  async runSerialized<T>(token: number, work: () => Promise<T>): Promise<T | undefined> {
    if (!this.current(token)) return undefined;
    this.saves += 1;
    this.saving = true;
    const previous = this.tail;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tail = gate;
    try {
      await previous;
      if (!this.current(token)) return undefined;
      const value = await work();
      if (!this.current(token)) return undefined;
      return value;
    } finally {
      this.saves -= 1;
      this.saving = this.saves > 0;
      release();
    }
  }
}
