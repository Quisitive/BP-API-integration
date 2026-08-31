# Closed Detections & Reporting Dashboard - Integration Guide

> **Note**: This guide covers the legacy component-level integration.
> For the current unified closeout workflow with governance and audit trail,
> see [SECOPS_OPERATIONS_GUIDE.md](SECOPS_OPERATIONS_GUIDE.md#24-case-closeout).

## Overview

This update adds comprehensive support for **reviewing closed/resolved detections after-the-fact** and generating detailed **detection reports** directly in the application UI.

## What's New

### 1. **Closed Detections Viewer**
A rich table view of all resolved detections with:
- Sortable columns (creation date, days open, risk score, alert count)
- Filtering by risk score range
- Historical data access (up to 90 days)
- Export capabilities

### 2. **Detection Reporting Dashboard**
Comprehensive analytics dashboard showing:
- **Key Metrics:** Total detections, open/resolved counts, average risk scores
- **Risk Distribution:** Visual breakdown of detection risk scores (0-20, 21-40, 41-60, 61-80, 81-100)
- **Top Alert Types:** Most frequent detection types
- **Recent Closed Detections:** Latest resolved incidents with details
- **Export & Print:** Download reports as JSON or print for compliance

### 3. **Tabbed Interface**
Three-tab navigation in the Tenant Detail view:
- **📋 Open Detections** - Current/active detections
- **✓ Closed Detections** - Historical resolved detections
- **📊 Detection Report** - Analytics and statistics

## Features

### API Capabilities

✅ **Query Parameters:**
```bash
GET /v1/alert-groups?status=RESOLVED&since=2026-02-18T00:00:00Z&take=100&skip=0
```

- `status=RESOLVED` - Get only closed detections
- `since` - Historical cutoff (ISO 8601, max 90 days ago)
- `take` - Page size (default 100, max 100)
- `skip` - Pagination offset (increment by 100)
- `sortByColumn` - Sort by: `created`, `alertCount`, `username`, `hostname`, `alertTypes`, `status`
- `sortDirection` - `ASC` or `DESC`

### Data Available

Each closed detection includes:
```json
{
  "id": "string",
  "status": "RESOLVED",
  "alertCount": 42,
  "riskScore": 75,
  "alertTypes": ["type1", "type2"],
  "created": "2026-03-15T10:30:00Z",
  "updated": "2026-03-15T15:45:00Z",
  "ticketId": "optional"
}
```

## Usage

### In the React Dashboard

1. **View Tenant Details** - Click "View Details →" on any tenant card
2. **Navigate Tabs:**
   - **📋 Open Detections** - See current/active alerts
   - **✓ Closed Detections** - Browse recently resolved incidents
   - **📊 Detection Report** - View analytics and statistics
3. **Export Reports** - Click "📥 Export as JSON" to download
4. **Print Reports** - Click "🖨️ Print Report" for compliance records

### Programmatic Access

Using the services in `legacy/services/`:

```typescript
import { createClosedDetectionsService } from './legacy/services/closed-detections.service';
import { createAlertService } from './legacy/services/alert.service';
import { createTenantService } from './legacy/services/tenant.service';

// Initialize services
const alertService = createAlertService(apiClient);
const tenantService = createTenantService(apiClient);
const reportingService = createClosedDetectionsService(alertService, tenantService);

// Fetch closed detections
const closed = await reportingService.fetchClosedDetections(tenantId, {
  since: '2026-02-18T00:00:00Z',
  minRiskScore: 60
});

// Generate comprehensive report
const report = await reportingService.generateTenantDetectionReport(tenantId);

// Get statistics
const stats = await reportingService.getClosedDetectionStats(tenantId);

// Get top alert types
const topTypes = reportingService.getTopAlertTypes(closed, 10);

// Get risk distribution
const distribution = reportingService.getRiskScoreDistribution(closed);
```

## Components

### ClosedDetectionsViewer

```tsx
<ClosedDetectionsViewer
  detections={closedDetections}
  isLoading={loading}
  error={error}
  onSort={(column, direction) => console.log(column, direction)}
/>
```

**Props:**
- `detections: ClosedDetection[]` - Array of closed detections
- `isLoading?: boolean` - Loading state
- `error?: string | null` - Error message
- `onSort?: (column, direction) => void` - Sort callback

### DetectionReportingDashboard

```tsx
<DetectionReportingDashboard
  tenantName="Acme Corp"
  stats={stats}
  topAlertTypes={topAlertTypes}
  riskScoreDistribution={distribution}
  recentClosed={closedDetections}
  reportGeneratedAt={new Date().toISOString()}
  isLoading={false}
/>
```

**Props:**
- `tenantName: string` - Tenant display name
- `stats: DetectionStats` - Aggregated statistics
- `topAlertTypes: TopAlertType[]` - Top 10 alert types
- `riskScoreDistribution: RiskScoreRange[]` - Risk distribution (5 ranges)
- `recentClosed: ClosedDetection[]` - Recent closed detections
- `reportGeneratedAt: string` - ISO timestamp
- `isLoading?: boolean` - Loading state

## Grafana Integration

A new Grafana dashboard is available: `blackpoint-soc-dashboard-v3-closed-detections.json`

**Includes:**
- Detection trends (open vs resolved over time)
- Current status panels (open, critical, high risk counts)
- Closed detections metrics (total resolved, resolution rate)
- Risk distribution charts
- Top alert types pie chart
- Status breakdown pie chart
- Tenant health summary table

**Import:** Upload JSON to Grafana and connect to Blackpoint API data source

## API Limitations & Notes

### Time Window
- Maximum historical lookback: **90 days**
- Use `since` parameter for older data windows
- For data >90 days old, implement local archival

### Pagination
- Maximum page size: **100 items**
- For large datasets, increment `skip` by 100 until `items.length < 100`
- Service handles auto-pagination internally

### Performance
- First-time report generation may take 5-15 seconds depending on tenant size
- Reports are calculated on-demand (not cached)
- Close completed reports to free memory

### Access Rights
- Requires API key with `alert-groups:read` permission
- Note: Individual `incidents` endpoint requires separate role grant from Blackpoint

## Example Workflow

```typescript
// 1. Fetch tenant list
const tenants = await tenantService.fetchAllTenants();

// 2. For each tenant, generate report
for (const tenant of tenants) {
  const report = await reportingService.generateTenantDetectionReport(tenant.id);
  console.log(`${tenant.name}: ${report.stats.resolvedDetections} resolved`);

  // 3. Export or display report
  console.log(`Resolution rate: ${Math.round((report.stats.resolvedDetections / report.stats.totalDetections) * 100)}%`);
}

// 4. Generate all-tenants reports
const allReports = await reportingService.generateAllTenantsDetectionReports();

// 5. Generate compliance export
const exportData = allReports.map(r => ({
  tenant: r.tenantName,
  total: r.stats.totalDetections,
  open: r.stats.openDetections,
  resolved: r.stats.resolvedDetections,
  avgRisk: r.stats.averageRiskScore.toFixed(2),
  generated: r.reportGeneratedAt
}));

console.log(JSON.stringify(exportData, null, 2));
```

## Files Changed

### Core Services
- `legacy/services/alert.service.ts` - Added 3 new methods for closed detections
- `legacy/services/closed-detections.service.ts` - NEW reporting service
- `legacy/types/blackpoint.types.ts` - Added reporting types

### React Components
- `src/components/Dashboard.tsx` - Added tab navigation and closed/report interfaces
- `src/components/ClosedDetectionsViewer.tsx` - NEW closed detections table
- `src/components/DetectionReportingDashboard.tsx` - NEW reporting dashboard
- `src/components/ClosedDetectionsViewer.css` - Styling
- `src/components/DetectionReportingDashboard.css` - Styling
- `src/components/Dashboard.css` - Added tab navigation styles

### Grafana
- `grafana/blackpoint-soc-dashboard-v3-closed-detections.json` - NEW enhanced dashboard

## Building

```bash
npm run build
```

All TypeScript compiles to `dist/` with full type safety.

## Running

```bash
# Development server
npm run dashboard

# The app loads at http://localhost:3000
```

Update your `.env`:
```
REACT_APP_BLACKPOINT_API_KEY=bpc_...
REACT_APP_BLACKPOINT_TENANT_ID=your_tenant_id
```

## Next Steps

1. ✅ **Test with your tenant ID** - Update `.env` and reload dashboard
2. ✅ **Generate reports** - Click tenant card → "✓ Closed Detections" tab
3. ✅ **Export compliance data** - Use "📥 Export as JSON" button
4. ✅ **Import Grafana dashboard** - Add `blackpoint-soc-dashboard-v3-closed-detections.json` to Grafana
5. ✅ **Archive historical data** - Implement external archival for data >90 days

## Troubleshooting

### "No closed detections found"
- Verify API key has correct permissions
- Ensure tenant has resolved detections
- Check time window (max 90 days via `since`)

### "Slow report generation"
- Normal for large tenants with 1000+ detections
- Reports are fetched on-demand (not cached)
- Consider limiting date range for faster results

### Build errors
- Run `npm run build` to check TypeScript errors
- Clear `node_modules` and reinstall: `rm -rf node_modules && npm install`

## Support

For API questions or access issues, contact Blackpoint Cyber support.

---

**Updated:** March 20, 2026
**Version:** 3.0
**API Version:** CompassOne v1.4.0
