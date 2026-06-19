// ---------------------------------------------------------------------------
// Storage — Repository Factory
// ---------------------------------------------------------------------------
// Creates the appropriate CaseRepository implementation based on the
// STORAGE_BACKEND environment variable. Defaults to 'memory' for local dev.
//
// STORAGE_BACKEND values:
//   'memory'   — InMemoryCaseRepository (default, dev only)
//   'postgres' — PostgresCaseRepository (requires DATABASE_URL)
//   'cosmos'   — CosmosCaseRepository (requires COSMOS_CONNECTION_STRING)
// ---------------------------------------------------------------------------

import type { CaseRepository } from './repository.js';
import { InMemoryCaseRepository } from './memory.js';

export type StorageBackend = 'memory' | 'postgres' | 'cosmos';

let instance: CaseRepository | null = null;

/**
 * Create and initialize a CaseRepository. Caches the singleton.
 * Call once at server startup.
 */
export async function createRepository(
  backend?: StorageBackend,
): Promise<CaseRepository> {
  if (instance) return instance;

  const resolved = backend || (process.env.STORAGE_BACKEND as StorageBackend) || 'memory';

  switch (resolved) {
    case 'postgres': {
      const { PostgresCaseRepository } = await import('./postgres.js');
      instance = new PostgresCaseRepository();
      break;
    }
    case 'cosmos': {
      const { CosmosCaseRepository } = await import('./cosmos.js');
      instance = new CosmosCaseRepository();
      break;
    }
    case 'memory':
    default:
      instance = new InMemoryCaseRepository();
      break;
  }

  await instance.init();
  return instance;
}

/**
 * Get the cached repository instance. Throws if createRepository hasn't been called.
 */
export function getRepository(): CaseRepository {
  if (!instance) {
    throw new Error('Repository not initialized. Call createRepository() at startup.');
  }
  return instance;
}
