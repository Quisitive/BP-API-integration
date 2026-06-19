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
import { CompassOneClient } from '../services/compassOneClient.js';
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
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isValidAlias(alias: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/.test(alias) || /^[a-z0-9]{1,2}$/.test(alias);
}

function resolveEnvPlaceholders(raw: string): string {
  return raw.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
    const value = process.env[varName];
    if (value === undefined) {
      throw new Error(`Environment variable ${varName} is not set (referenced in tenant config)`);
    }
    return value;
  });
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

      const microsoft: MicrosoftTenantConfig | undefined = body.microsoft
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
        microsoft: mergedMicrosoft,
      };

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
