# Blackpoint Cyber Integration

> **Note**: This document covers the legacy direct-client usage. For the current unified backend,
> see [SECOPS_OPERATIONS_GUIDE.md](SECOPS_OPERATIONS_GUIDE.md) and the `/bp/*` routes
> in the [README](README.md#blackpoint-bp).

Environment variables needed for Blackpoint Cyber API integration:

```bash
# Blackpoint Cyber API Configuration
BLACKPOINT_API_URL=https://api.blackpointcyber.com
BLACKPOINT_API_KEY=<YOUR_API_KEY>
```

## Usage

### Initialize Services

```typescript
import { BlackpointApiClient, createApiClient } from './services/blackpoint-api.service';
import { createDashboardService } from './services/dashboard.service';

// Create API client
const apiClient = createApiClient();

// Test connection (discovers available endpoints)
const connected = await apiClient.testConnection();
console.log('Connected:', connected);

// Discover endpoints
const endpoints = await apiClient.discoverEndpoints();
console.log('Available endpoints:', endpoints);
```

### Get Dashboard Summary (for SOC team)

```typescript
const dashboardService = createDashboardService(apiClient);

// Get full dashboard summary
const summary = await dashboardService.getDashboardSummary();
console.log(`Total Tenants: ${summary.totalTenants}`);
console.log(`Outstanding Alerts: ${summary.totalOutstandingAlerts}`);
console.log(`Alerts by Severity:`, summary.alertsBySeverity);

// List tenant summaries sorted by alert count
summary.tenantAlerts.forEach((tenant) => {
  console.log(`${tenant.tenantName}: ${tenant.totalAlerts} alerts (${tenant.openAlerts} open, ${tenant.outstandingAlerts} outstanding)`);
});
```

### Get Critical Alerts

```typescript
const criticalAlerts = await dashboardService.getCriticalAlerts();
criticalAlerts.forEach((alert) => {
  console.log(`[${alert.severity}] ${alert.title} - ${alert.tenantName}`);
});
```

### Get Specific Tenant Alerts

```typescript
const tenantDetails = await dashboardService.getTenantAlertDetails('Tenant 1');
console.log(`Summary:`, tenantDetails.summary);
console.log(`Alerts:`, tenantDetails.alerts);
```

### Direct Tenant Service Usage

```typescript
import { createTenantService } from './services/tenant.service';

const tenantService = createTenantService(apiClient);

// Fetch all tenants
const allTenants = await tenantService.fetchAllTenants();

// Fetch with pagination
const page = await tenantService.fetchTenantsPage(1, 20, {
  sortBy: 'created',
  sortOrder: 'DESC',
});

// Get tenant by name
const tenant = await tenantService.getTenantByName('Tenant 1');
```

### Direct Alert Service Usage

```typescript
import { createAlertService } from './services/alert.service';

const alertService = createAlertService(apiClient);

// Fetch outstanding/open alerts
const outstanding = await alertService.fetchOutstandingAlerts();

// Fetch specific tenant alerts
const tenantAlerts = await alertService.fetchTenantAlerts('tenantId', {
  status: ['open', 'outstanding'],
  sortBy: 'createdAt',
  sortOrder: 'DESC',
});

// Fetch by specific statuses
const critical = await alertService.fetchAlertsByStatus(['critical', 'high']);
```

## Type Definitions

See `src/types/blackpoint.types.ts` for all available types:

- `Tenant` - Tenant object
- `Alert` - Alert/incident object
- `DashboardSummary` - Aggregated dashboard data
- `TenantAlertSummary` - Per-tenant alert summary
- `AlertStatus` - 'open' | 'outstanding' | 'closed' | 'resolved'
- `AlertSeverity` - 'critical' | 'high' | 'medium' | 'low' | 'info'
