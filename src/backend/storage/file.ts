// ---------------------------------------------------------------------------
// Storage — JSON File Implementation
// ---------------------------------------------------------------------------
// Dev-friendly persistence: reuses all InMemoryCaseRepository logic but loads
// state from a JSON file on init and writes it back after every mutation, so
// trend snapshots, correlations and closeouts survive a server restart.
// Not intended for production or concurrent processes — use postgres/cosmos.
// ---------------------------------------------------------------------------

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { InMemoryCaseRepository } from './memory.js';

const DEFAULT_FILE = '.data/repository.json';

export class FileCaseRepository extends InMemoryCaseRepository {
  private readonly filePath: string;
  /** Serializes writes so concurrent mutations don't clobber the file. */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(filePath?: string) {
    super();
    this.filePath = path.resolve(filePath || process.env.STORAGE_FILE || DEFAULT_FILE);
  }

  override async init(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      this.hydrateState(JSON.parse(raw));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      // First run: no file yet — start empty and create it on first write.
    }
  }

  /** Atomically write current state (temp file + rename), serialized. */
  protected override async persist(): Promise<void> {
    this.writeChain = this.writeChain.then(() => this.writeState());
    return this.writeChain;
  }

  private async writeState(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.serializeState(), null, 2), 'utf-8');
    await fs.rename(tmp, this.filePath);
  }
}
