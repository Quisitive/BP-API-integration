// ---------------------------------------------------------------------------
// Storage — Barrel Export
// ---------------------------------------------------------------------------

export type { CaseRepository } from './repository.js';
export { toCaseRecord, newAuditEvent } from './repository.js';

export { InMemoryCaseRepository } from './memory.js';
// PostgresCaseRepository and CosmosCaseRepository are dynamically imported by factory

export { createRepository, getRepository } from './factory.js';
export type { StorageBackend } from './factory.js';
