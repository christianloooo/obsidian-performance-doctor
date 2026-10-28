/**
 * Pure vault inventory aggregation (POC).
 * Input is already public data (getFiles + stat only). No content.
 * Bounded chunking expected from caller.
 *
 * Security:
 * - Use null-prototype object (or Map) to avoid __proto__ pollution.
 * - Only known closed extension buckets are emitted.
 * - Sizes must be finite and nonnegative; invalid entries are ignored.
 */

import { InventoryAggregate, SyntheticFile } from './types';

const KNOWN_EXTS = ['.md', '.png', '.jpg', '.jpeg', '.pdf', '.canvas', '.json', '.csv', '.txt'] as const;
type KnownExt = typeof KNOWN_EXTS[number] | 'other';

function normalizeExt(raw: string | undefined): KnownExt {
  if (!raw) return 'other';
  const lower = raw.toLowerCase();
  const dotted = lower.startsWith('.') ? lower : `.${lower}`;
  if ((KNOWN_EXTS as readonly string[]).includes(dotted)) return dotted as KnownExt;
  return 'other';
}

function isValidSize(n: number): boolean {
  return Number.isFinite(n) && n >= 0;
}

export function createInventoryTotals(): InventoryAggregate {
  return {
    totalFiles: 0,
    totalSize: 0,
    byExtension: Object.create(null),
    largestFilesCounted: 0,
  };
}

export function addInventoryEntry(totals: InventoryAggregate, extension: string | undefined, size: number): void {
  if (!isValidSize(size)) return;
  const bucket = normalizeExt(extension);
  const current = totals.byExtension[bucket] ?? { count: 0, totalSize: 0 };
  current.count += 1;
  current.totalSize += size;
  totals.byExtension[bucket] = current;
  totals.totalFiles += 1;
  totals.totalSize += size;
  totals.largestFilesCounted = totals.totalFiles;
}

export function aggregateInventory(files: SyntheticFile[]): InventoryAggregate {
  const totals = createInventoryTotals();
  for (const file of files) {
    addInventoryEntry(totals, file.extension, typeof file.size === 'number' ? file.size : 0);
  }
  return totals;
}

/**
 * Generate large synthetic inventory for harness testing.
 * Always produces valid sizes and closed extensions.
 */
export function generateSyntheticInventory(count: number): SyntheticFile[] {
  const files: SyntheticFile[] = [];
  for (let i = 0; i < count; i++) {
    const bucket = KNOWN_EXTS[i % KNOWN_EXTS.length];
    const size = 100 + Math.floor(Math.random() * 50000);
    files.push({ extension: bucket as string, size });
  }
  return files;
}
