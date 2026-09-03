// ---------------------------------------------------------------------------
// Tenant Configuration Loader
// ---------------------------------------------------------------------------
// Loads tenant config from JSON file with environment variable interpolation
// for secrets. Validates tenant aliases and provides lookup helpers.
// ---------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { UnifiedTenantConfig } from './tenants.schema.js';

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'config', 'tenants.json');

/**
 * Interpolate ${ENV_VAR} placeholders in string values with environment variables.
 * Throws if a referenced env var is not set, unless `lenient` is true (used for
 * the example-config fallback), in which case missing vars become empty strings.
 */
function interpolateSecrets(obj: unknown, lenient = false): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
      const value = process.env[varName];
      if (value === undefined) {
        if (lenient) {
          return '';
        }
        throw new Error(`Environment variable ${varName} is not set (referenced in tenant config)`);
      }
      return value;
    });
  }

  if (Array.isArray(obj)) {
    return obj.map(item => interpolateSecrets(item, lenient));
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateSecrets(value, lenient);
    }
    return result;
  }

  return obj;
}

/**
 * Validate a tenant alias format: lowercase alphanumeric + hyphens, 2-64 chars.
 */
function validateAlias(alias: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/.test(alias) || /^[a-z0-9]{1,2}$/.test(alias);
}

/**
 * Load all tenant configurations from disk.
 * Interpolates secrets from environment variables.
 *
 * If `config/tenants.json` is missing (e.g. a fresh clone — the file is
 * gitignored because it holds per-tenant IDs), the server no longer crashes:
 * it falls back to `config/tenants.example.json` when present, otherwise starts
 * with zero tenants and logs an actionable warning.
 */
export async function loadTenants(configPath?: string): Promise<UnifiedTenantConfig[]> {
  const filePath = configPath || DEFAULT_CONFIG_PATH;

  let raw: string;
  let lenient = false;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }

    const examplePath = path.join(path.dirname(filePath), 'tenants.example.json');
    try {
      raw = await readFile(examplePath, 'utf-8');
      lenient = true;
      console.warn(
        `[config] ${filePath} not found — falling back to ${examplePath}. ` +
          `Copy it to config/tenants.json and set the referenced env vars for real tenants.`,
      );
    } catch {
      console.warn(
        `[config] No tenant config found at ${filePath} (and no tenants.example.json). ` +
          `Starting with 0 tenants. Create config/tenants.json to onboard tenants.`,
      );
      return [];
    }
  }

  const parsed = JSON.parse(raw) as unknown[];

  if (!Array.isArray(parsed)) {
    throw new Error('Tenant config must be a JSON array');
  }

  const tenants = parsed.map(entry => interpolateSecrets(entry, lenient)) as UnifiedTenantConfig[];

  // Validate aliases
  const aliases = new Set<string>();
  for (const tenant of tenants) {
    if (!tenant.alias) {
      throw new Error('Every tenant must have an alias');
    }
    if (!validateAlias(tenant.alias)) {
      throw new Error(`Invalid tenant alias format: "${tenant.alias}" — must be lowercase alphanumeric + hyphens`);
    }
    if (aliases.has(tenant.alias)) {
      throw new Error(`Duplicate tenant alias: "${tenant.alias}"`);
    }
    aliases.add(tenant.alias);
  }

  return tenants;
}

/**
 * Build a lookup map from alias → tenant config.
 */
export function buildTenantRegistry(tenants: UnifiedTenantConfig[]): Map<string, UnifiedTenantConfig> {
  const registry = new Map<string, UnifiedTenantConfig>();
  for (const tenant of tenants) {
    registry.set(tenant.alias, tenant);
  }
  return registry;
}

/**
 * Find a tenant by alias from the loaded list.
 */
export function findTenantByAlias(
  tenants: UnifiedTenantConfig[],
  alias: string,
): UnifiedTenantConfig | undefined {
  return tenants.find(t => t.alias === alias);
}
