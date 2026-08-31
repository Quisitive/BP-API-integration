// ---------------------------------------------------------------------------
// Unified Tenant Configuration Schema
// ---------------------------------------------------------------------------
// Each tenant entry combines Blackpoint CompassOne credentials with
// Microsoft Entra ID / Defender XDR credentials in a single config object.
// Secrets use ${ENV_VAR} interpolation resolved at load time from
// environment variables or Azure Key Vault references.
// ---------------------------------------------------------------------------

export type DefenderWorkload =
  | 'DefenderForEndpoint'
  | 'DefenderForIdentity'
  | 'DefenderForOffice365'
  | 'DefenderForCloudApps'
  | 'DefenderXdr';

export interface BlackpointTenantConfig {
  /** CompassOne customer/tenant ID (UUID from /v1/tenants) */
  customerId: string;
  /** Override base URL if customer is on a regional endpoint */
  apiBaseUrl?: string;
  /** Tenant-specific API key if not using account-level key */
  apiKeyOverride?: string;
}

export interface MicrosoftTenantConfig {
  /** Azure AD / Entra tenant ID */
  tenantId: string;
  /** Entra app registration client ID */
  clientId: string;
  /** Client secret (prefer cert in production) — resolved from env/KV */
  clientSecret: string;
  /** Override security API host for regional deployments */
  securityApiHost?: string;
  /** Which Defender workloads are enabled for this tenant */
  enabledWorkloads: DefenderWorkload[];
}

export interface UnifiedTenantConfig {
  /** Human-readable alias used in URLs and UI (e.g., "contoso") */
  alias: string;
  /** Customer display name */
  displayName: string;

  /** Blackpoint CompassOne configuration (optional — tenant may be BP-only or MS-only) */
  blackpoint?: BlackpointTenantConfig;

  /** Microsoft Defender XDR / Entra ID configuration */
  microsoft?: MicrosoftTenantConfig;

  /** Whether tenant is active */
  enabled: boolean;
  /** Tags for filtering/grouping (e.g., "tier-1", "healthcare") */
  tags?: string[];
  /** Primary SOC analyst assigned */
  primaryAnalyst?: string;
  /** Onboarding date */
  onboardedAt?: string;
}

/** Tenant summary safe to return in API responses (no secrets) */
export interface TenantSummary {
  alias: string;
  displayName: string;
  enabled: boolean;
  tags?: string[];
  primaryAnalyst?: string;
  onboardedAt?: string;
  capabilities: {
    blackpoint: boolean;
    microsoft: boolean;
    enabledWorkloads: DefenderWorkload[];
  };
}

export function toTenantSummary(tenant: UnifiedTenantConfig): TenantSummary {
  return {
    alias: tenant.alias,
    displayName: tenant.displayName,
    enabled: tenant.enabled,
    tags: tenant.tags,
    primaryAnalyst: tenant.primaryAnalyst,
    onboardedAt: tenant.onboardedAt,
    capabilities: {
      blackpoint: !!tenant.blackpoint,
      microsoft: !!tenant.microsoft,
      enabledWorkloads: tenant.microsoft?.enabledWorkloads ?? [],
    },
  };
}
