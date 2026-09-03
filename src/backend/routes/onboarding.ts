// ---------------------------------------------------------------------------
// Routes — Tenant Onboarding Wizard
// ---------------------------------------------------------------------------
// Creates new tenant entries in config/tenants.json and updates the in-memory
// tenant registry so newly onboarded tenants are immediately available.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import type { Request, Response } from 'express';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CompassOneClient, CompassOneApiError } from '../services/compassOneClient.js';
import type {
  DefenderWorkload,
  MicrosoftTenantConfig,
  UnifiedTenantConfig,
} from '../config/tenants.schema.js';

const TENANTS_CONFIG_PATH = path.join(process.cwd(), 'config', 'tenants.json');

interface TenantOnboardingRequest {
  alias: string;
  displayName: string;
  enabled?: boolean;
  tags?: string[];
  primaryAnalyst?: string;
  blackpoint?: {
    customerId: string;
    apiBaseUrl?: string;
    apiKeyOverride?: string;
  };
  microsoft?: {
    tenantId: string;
    clientId: string;
    clientSecret: string;
    securityApiHost?: string;
    enabledWorkloads?: DefenderWorkload[];
  };
}

interface TenantUpdateRequest {
  displayName?: string;
  enabled?: boolean;
  tags?: string[];
  primaryAnalyst?: string;
  blackpoint?: {
    customerId?: string;
    apiBaseUrl?: string;
    apiKeyOverride?: string;
  };
  microsoft?: {
    tenantId?: string;
    clientId?: string;
    clientSecret?: string;
    securityApiHost?: string;
    enabledWorkloads?: DefenderWorkload[];
  } | null;
}

function sanitizeAlias(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-');
  let start = 0;
  let end = normalized.length;
  while (normalized[start] === '-') start += 1;
  while (end > start && normalized[end - 1] === '-') end -= 1;
  return normalized.slice(start, end);
}

function isValidAlias(alias: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/.test(alias) || /^[a-z0-9]{1,2}$/.test(alias);
}

function resolveEnvPlaceholders(raw: string): string {
  let resolved = '';
  let cursor = 0;
  while (cursor < raw.length) {
    const start = raw.indexOf('${', cursor);
    if (start === -1) {
      return resolved + raw.slice(cursor);
    }
    const end = raw.indexOf('}', start + 2);
    if (end === -1) {
      return resolved + raw.slice(cursor);
    }
    resolved += raw.slice(cursor, start);
    const varName = raw.slice(start + 2, end);
    if (!varName) {
      resolved += raw.slice(start, end + 1);
      cursor = end + 1;
      continue;
    }
    const value = process.env[varName];
    if (value === undefined) {
      throw new Error(`Environment variable ${varName} is not set (referenced in tenant config)`);
    }
    resolved += value;
    cursor = end + 1;
  }
  return resolved;
}

function materializeTenantForRuntime(tenant: UnifiedTenantConfig): UnifiedTenantConfig {
  return {
    ...tenant,
    blackpoint: tenant.blackpoint
      ? {
          customerId: resolveEnvPlaceholders(tenant.blackpoint.customerId),
          apiBaseUrl: tenant.blackpoint.apiBaseUrl
            ? resolveEnvPlaceholders(tenant.blackpoint.apiBaseUrl)
            : tenant.blackpoint.apiBaseUrl,
          apiKeyOverride: tenant.blackpoint.apiKeyOverride
            ? resolveEnvPlaceholders(tenant.blackpoint.apiKeyOverride)
            : tenant.blackpoint.apiKeyOverride,
        }
      : tenant.blackpoint,
    microsoft: tenant.microsoft
      ? {
          tenantId: resolveEnvPlaceholders(tenant.microsoft.tenantId),
          clientId: resolveEnvPlaceholders(tenant.microsoft.clientId),
          clientSecret: resolveEnvPlaceholders(tenant.microsoft.clientSecret),
          securityApiHost: tenant.microsoft.securityApiHost
            ? resolveEnvPlaceholders(tenant.microsoft.securityApiHost)
            : tenant.microsoft.securityApiHost,
          enabledWorkloads: tenant.microsoft.enabledWorkloads,
        }
      : tenant.microsoft,
  };
}

async function loadTenantConfigFile(): Promise<UnifiedTenantConfig[]> {
  const raw = await readFile(TENANTS_CONFIG_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('config/tenants.json must be a JSON array');
  }
  return parsed as UnifiedTenantConfig[];
}

async function saveTenantConfigFile(tenants: UnifiedTenantConfig[]): Promise<void> {
  await mkdir(path.dirname(TENANTS_CONFIG_PATH), { recursive: true });
  const json = JSON.stringify(tenants, null, 2) + '\n';
  await writeFile(TENANTS_CONFIG_PATH, json, 'utf-8');
}

const ENV_FILE_PATH = path.join(process.cwd(), '.env');

function envKeyPrefix(alias: string): string {
  return alias.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// Upsert KEY=value pairs into .env and process.env so they resolve immediately.
async function upsertEnvVars(vars: Record<string, string>): Promise<void> {
  let content = '';
  try {
    content = await readFile(ENV_FILE_PATH, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const lines = content.length ? content.split(/\r?\n/) : [];
  for (const [key, value] of Object.entries(vars)) {
    process.env[key] = value;
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^\\s*${escaped}\\s*=`);
    const idx = lines.findIndex(line => re.test(line));
    const entry = `${key}=${value}`;
    if (idx >= 0) lines[idx] = entry;
    else lines.push(entry);
  }
  let out = lines.join('\n');
  if (!out.endsWith('\n')) out += '\n';
  await writeFile(ENV_FILE_PATH, out, 'utf-8');
}

// Move raw (non-placeholder) Microsoft secret values into .env, replacing them
// with ${ENV} placeholders so nothing sensitive is written to tenants.json.
function externalizeMicrosoftSecrets(
  alias: string,
  ms: MicrosoftTenantConfig,
): { config: MicrosoftTenantConfig; env: Record<string, string> } {
  const prefix = envKeyPrefix(alias);
  const env: Record<string, string> = {};
  const fieldSuffix: Record<'tenantId' | 'clientId' | 'clientSecret', string> = {
    tenantId: 'MS_TENANT_ID',
    clientId: 'MS_CLIENT_ID',
    clientSecret: 'MS_CLIENT_SECRET',
  };
  const config: MicrosoftTenantConfig = { ...ms };
  (['tenantId', 'clientId', 'clientSecret'] as const).forEach(field => {
    const value = ms[field];
    if (typeof value === 'string' && value && !/^\$\{[^}]+\}$/.test(value)) {
      const key = `${prefix}_${fieldSuffix[field]}`;
      env[key] = value;
      config[field] = `\${${key}}`;
    }
  });
  return { config, env };
}

function toSafeSummary(tenant: UnifiedTenantConfig) {
  return {
    alias: tenant.alias,
    displayName: tenant.displayName,
    enabled: tenant.enabled,
    hasBlackpoint: !!tenant.blackpoint,
    hasMicrosoft: !!tenant.microsoft,
    tags: tenant.tags,
    primaryAnalyst: tenant.primaryAnalyst,
    onboardedAt: tenant.onboardedAt,
    enabledWorkloads: tenant.microsoft?.enabledWorkloads ?? [],
  };
}

export function createOnboardingRouter(registry: Map<string, UnifiedTenantConfig>) {
  const router = Router();
  const compassOne = new CompassOneClient();

  // Returns current onboarded tenants without secrets.
  router.get('/tenants', (_req: Request, res: Response) => {
    const tenants = [...registry.values()].map(toSafeSummary);
    res.json(tenants);
  });

  // Returns account-level Blackpoint tenants for onboarding selection.
  router.get('/blackpoint-tenants', async (_req: Request, res: Response) => {
    try {
      const response = await compassOne.listTenants({ pageSize: 200 });
      const tenants = (response.data || []).map((t) => ({ id: t.id, name: t.name }));
      res.json({ data: tenants });
    } catch (err) {
      if (err instanceof CompassOneApiError && (err.status === 401 || err.status === 403)) {
        res.status(err.status).json({
          error:
            'Blackpoint API key is invalid or expired. Update COMPASSONE_API_KEY in .env with a current CompassOne key, then restart the server.',
          detail: err.body || err.message,
        });
        return;
      }
      res.status(502).json({
        error: 'Failed to fetch Blackpoint tenants',
        detail: (err as Error).message,
      });
    }
  });

  // Creates a new tenant entry and persists it to config/tenants.json.
  router.post('/tenants', async (req: Request, res: Response) => {
    const body = req.body as TenantOnboardingRequest;

    const alias = sanitizeAlias(body.alias || '');
    const displayName = (body.displayName || '').trim();

    if (!alias || !isValidAlias(alias)) {
      res.status(400).json({
        error: 'Invalid alias. Use lowercase letters, numbers, and hyphens only.',
      });
      return;
    }

    if (!displayName) {
      res.status(400).json({ error: 'displayName is required.' });
      return;
    }

    if (!body.blackpoint?.customerId?.trim()) {
      res.status(400).json({ error: 'blackpoint.customerId is required.' });
      return;
    }

    if (body.microsoft) {
      const ms = body.microsoft;
      if (!ms.tenantId?.trim() || !ms.clientId?.trim() || !ms.clientSecret?.trim()) {
        res.status(400).json({
          error: 'microsoft.tenantId, microsoft.clientId, and microsoft.clientSecret are required when Microsoft is configured.',
        });
        return;
      }
    }

    if (registry.has(alias)) {
      res.status(409).json({ error: `Tenant alias already exists: ${alias}` });
      return;
    }

    try {
      const tenants = await loadTenantConfigFile();
      if (tenants.some(t => t.alias === alias)) {
        res.status(409).json({ error: `Tenant alias already exists: ${alias}` });
        return;
      }

      let microsoft: MicrosoftTenantConfig | undefined = body.microsoft
        ? {
            tenantId: body.microsoft.tenantId.trim(),
            clientId: body.microsoft.clientId.trim(),
            clientSecret: body.microsoft.clientSecret.trim(),
            securityApiHost: body.microsoft.securityApiHost?.trim() || undefined,
            enabledWorkloads: body.microsoft.enabledWorkloads?.length
              ? body.microsoft.enabledWorkloads
              : ['DefenderXdr', 'DefenderForOffice365'],
          }
        : undefined;

      let microsoftEnv: Record<string, string> = {};
      if (microsoft) {
        const externalized = externalizeMicrosoftSecrets(alias, microsoft);
        microsoft = externalized.config;
        microsoftEnv = externalized.env;
      }

      const tenant: UnifiedTenantConfig = {
        alias,
        displayName,
        enabled: body.enabled ?? true,
        tags: body.tags?.filter(Boolean) || [],
        primaryAnalyst: body.primaryAnalyst?.trim() || undefined,
        onboardedAt: new Date().toISOString(),
        blackpoint: {
          customerId: body.blackpoint.customerId.trim(),
          apiBaseUrl: body.blackpoint.apiBaseUrl?.trim() || undefined,
          apiKeyOverride: body.blackpoint.apiKeyOverride?.trim() || undefined,
        },
        microsoft,
      };

      if (Object.keys(microsoftEnv).length) {
        await upsertEnvVars(microsoftEnv);
      }
      tenants.push(tenant);
      await saveTenantConfigFile(tenants);
      registry.set(alias, materializeTenantForRuntime(tenant));

      res.status(201).json(toSafeSummary(tenant));
    } catch (err) {
      res.status(500).json({
        error: 'Failed to onboard tenant',
        detail: (err as Error).message,
      });
    }
  });

  // Updates an existing tenant entry and persists it to config/tenants.json.
  router.patch('/tenants/:alias', async (req: Request, res: Response) => {
    const alias = sanitizeAlias(req.params.alias || '');
    const body = req.body as TenantUpdateRequest;

    if (!alias || !isValidAlias(alias)) {
      res.status(400).json({
        error: 'Invalid alias. Use lowercase letters, numbers, and hyphens only.',
      });
      return;
    }

    try {
      const tenants = await loadTenantConfigFile();
      const index = tenants.findIndex(t => t.alias === alias);
      if (index === -1) {
        res.status(404).json({ error: `Tenant not found: ${alias}` });
        return;
      }

      const existing = tenants[index];
      const existingBlackpoint = existing.blackpoint;

      if (body.displayName !== undefined && !body.displayName.trim()) {
        res.status(400).json({ error: 'displayName cannot be empty.' });
        return;
      }

      if (body.blackpoint?.customerId !== undefined && !body.blackpoint.customerId.trim()) {
        res.status(400).json({ error: 'blackpoint.customerId cannot be empty when provided.' });
        return;
      }

      if (!existingBlackpoint && !body.blackpoint?.customerId?.trim()) {
        res.status(400).json({ error: 'blackpoint.customerId is required for tenants without existing Blackpoint config.' });
        return;
      }

      if (body.microsoft && body.microsoft !== null) {
        const hasTenantId = (body.microsoft.tenantId ?? existing.microsoft?.tenantId ?? '').trim();
        const hasClientId = (body.microsoft.clientId ?? existing.microsoft?.clientId ?? '').trim();
        const hasClientSecret = (body.microsoft.clientSecret ?? existing.microsoft?.clientSecret ?? '').trim();
        if (!hasTenantId || !hasClientId || !hasClientSecret) {
          res.status(400).json({
            error: 'microsoft.tenantId, microsoft.clientId, and microsoft.clientSecret are required when Microsoft is configured.',
          });
          return;
        }
      }

      const mergedMicrosoft =
        body.microsoft === null
          ? undefined
          : body.microsoft
            ? {
                tenantId: (body.microsoft.tenantId ?? existing.microsoft?.tenantId ?? '').trim(),
                clientId: (body.microsoft.clientId ?? existing.microsoft?.clientId ?? '').trim(),
                clientSecret: (body.microsoft.clientSecret ?? existing.microsoft?.clientSecret ?? '').trim(),
                securityApiHost:
                  body.microsoft.securityApiHost !== undefined
                    ? body.microsoft.securityApiHost?.trim() || undefined
                    : existing.microsoft?.securityApiHost,
                enabledWorkloads:
                  body.microsoft.enabledWorkloads !== undefined
                    ? body.microsoft.enabledWorkloads
                    : existing.microsoft?.enabledWorkloads ?? ['DefenderXdr', 'DefenderForOffice365'],
              }
            : existing.microsoft;

      let microsoftEnv: Record<string, string> = {};
      let microsoftForStorage = mergedMicrosoft;
      if (microsoftForStorage) {
        const externalized = externalizeMicrosoftSecrets(alias, microsoftForStorage);
        microsoftForStorage = externalized.config;
        microsoftEnv = externalized.env;
      }

      const updated: UnifiedTenantConfig = {
        ...existing,
        displayName:
          body.displayName !== undefined ? body.displayName.trim() : existing.displayName,
        enabled: body.enabled !== undefined ? body.enabled : existing.enabled,
        tags: body.tags !== undefined ? body.tags.filter(Boolean) : existing.tags,
        primaryAnalyst:
          body.primaryAnalyst !== undefined
            ? body.primaryAnalyst.trim() || undefined
            : existing.primaryAnalyst,
        blackpoint: {
          ...existingBlackpoint,
          customerId:
            body.blackpoint?.customerId !== undefined
              ? body.blackpoint.customerId.trim()
              : existingBlackpoint?.customerId || '',
          apiBaseUrl:
            body.blackpoint?.apiBaseUrl !== undefined
              ? body.blackpoint.apiBaseUrl?.trim() || undefined
              : existingBlackpoint?.apiBaseUrl,
          apiKeyOverride:
            body.blackpoint?.apiKeyOverride !== undefined
              ? body.blackpoint.apiKeyOverride?.trim() || undefined
              : existingBlackpoint?.apiKeyOverride,
        },
        microsoft: microsoftForStorage,
      };

      if (Object.keys(microsoftEnv).length) {
        await upsertEnvVars(microsoftEnv);
      }
      tenants[index] = updated;
      await saveTenantConfigFile(tenants);
      registry.set(alias, materializeTenantForRuntime(updated));

      res.json(toSafeSummary(updated));
    } catch (err) {
      res.status(500).json({
        error: 'Failed to update tenant',
        detail: (err as Error).message,
      });
    }
  });

  return router;
}
