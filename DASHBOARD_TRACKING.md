# SOC Alert Dashboard with Lifecycle Tracking

> **Note**: This document describes the legacy Blackpoint-only alert dashboard.
> The unified platform now provides cross-source triage, correlation, and closeout
> governance. See [SECOPS_OPERATIONS_GUIDE.md](SECOPS_OPERATIONS_GUIDE.md) for
> current operational procedures.

Visual dashboard for monitoring Blackpoint Cyber alerts with real-time timers, prioritized by severity, and comprehensive lifecycle tracking for SOC analysts.

## Features

### 🎯 Alert Prioritization
- **Severity-based sorting**: Critical → High → Medium → Low → Info
- **Status-based filtering**: Only shows open/outstanding alerts
- **Live timer**: Shows exactly how long each alert has been open
- **Color-coded severity**: Visual indicators for quick identification

### ⏱️ Time Tracking
- **Open time counter**: Continuously updates showing elapsed time since alert creation
- **Lifecycle tracking**: Records exact timestamps for all state changes
- **Duration metrics**: Calculates time from alert open to resolution
- **Historical reports**: Export alert metrics in CSV format

### 📋 Action Logging
- **Automatic logging**: All actions are timestamped and recorded
- **User attribution**: Track who performed each action
- **Action history**: View all actions taken on an alert
- **Detailed notes**: Add and track analyst notes
- **Assignment tracking**: See who is working on each alert

## Installation

### Prerequisites
- React 16.8+ (for the dashboard component)
- TypeScript support

### Setup

```bash
# 1. Install dependencies (if not using monorepo)
npm install react

# 2. Configure environment variables
cp .env.example .env
# Edit .env with your Blackpoint API key

# 3. Import components in your React app
import AlertDashboard from './components/AlertDashboard';
import DashboardWithTracking from './components/DashboardWithTracking';
```

## Usage

### Basic Dashboard Usage

```typescript
import { Alert } from './types/blackpoint.types';
import AlertDashboard from './components/AlertDashboard';
import { createLifecycleService } from './services/lifecycle.service';

const lifecycleService = createLifecycleService();
const alerts: Alert[] = [...]; // From API

<AlertDashboard 
  alerts={alerts}
  alertLifecycleService={lifecycleService}
  onAlertClick={(alert) => console.log('Alert clicked:', alert)}
  refreshInterval={1000}
/>
```

### With Full Tracking

```typescript
import DashboardWithTracking from './components/DashboardWithTracking';

// In your React app
function App() {
  return <DashboardWithTracking />;
}
```

## Lifecycle Service API

### Initialize Alert Tracking

```typescript
const lifecycleService = createLifecycleService();

lifecycleService.initializeAlert(
  'alert_123',
  'Client Name',
  'Unusual login activity detected',
  'high'
);
```

### Log Actions

```typescript
// Log an action with details
lifecycleService.logAction(
  'alert_123',
  'investigation_started',
  'Initial investigation begun',
  'john.doe@company.com',
  { investigationId: 'INV-001' }
);
```

### Change Alert Status

```typescript
// Change status (automatically records closure time if moved to closed/resolved)
lifecycleService.changeStatus(
  'alert_123',
  'investigating',
  'Currently investigating the activity'
);

// Later, close the alert
lifecycleService.changeStatus(
  'alert_123',
  'resolved',
  'False positive - verified safe activity'
);
```

### Assign Alert

```typescript
lifecycleService.assignAlert('alert_123', 'jane.smith@company.com');
```

### Add Notes

```typescript
lifecycleService.addNotes(
  'alert_123',
  'Correlates with known maintenance window. Not a threat.',
  'john.doe@company.com'
);
```

### Get Alert Information

```typescript
// Get single alert lifecycle
const lifecycle = lifecycleService.getLifecycle('alert_123');
// Returns: AlertLifecycle object with all tracking data

// Get current open duration (in milliseconds)
const durationMs = lifecycleService.getCurrentDuration('alert_123');

// Get formatted duration
const formatted = lifecycleService.formatDuration(durationMs); // "2h 30m 45s"

// Get alert statistics
const stats = lifecycleService.getAlertStats('alert_123');
// Returns: { alertId, totalDuration, totalDurationFormatted, status }

// Get all alerts (sorted by duration)
const byDuration = lifecycleService.getAlertsByDuration('investigating');
```

## Data Export

### CSV Export

```typescript
// Export all alerts as CSV for reporting/analysis
const csv = lifecycleService.exportAsCsv();

// Save to file
const blob = new Blob([csv], { type: 'text/csv' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = `alerts-${new Date().toISOString()}.csv`;
a.click();
```

### JSON Export

```typescript
// Export raw lifecycle logs
const logs = lifecycleService.exportLog();

// Each entry contains:
// {
//   timestamp: "2025-02-24T10:30:45.123Z",
//   alertId: "alert_123",
//   eventType: "action" | "status_change" | "closed" | ...,
//   eventData: {...}
// }
```

## Dashboard Components

### AlertDashboard Component Props

```typescript
interface AlertDashboardProps {
  alerts: Alert[];                          // Array of alerts to display
  alertLifecycleService: AlertLifecycleService;  // Service instance for tracking
  onAlertClick?: (alert: Alert) => void;   // Callback when alert is clicked
  refreshInterval?: number;                 // Timer update interval (default: 1000ms)
}
```

### AlertCard Features

Each alert card displays:
- **Severity Badge**: Color-coded severity level with visual indicator
- **Alert Title**: Main alert description
- **Status Badge**: Current status with color coding
- **Open Timer**: Time elapsed since alert created
- **Client Name**: Which client/tenant this affects
- **Creation Timestamp**: When the alert was created
- **Action History** (expandable): All actions taken on this alert
- **Notes** (expandable): Any notes added by analysts
- **Assignment** (expandable): Who this is assigned to

### Color Coding

**Severity Colors:**
- 🔴 Critical (Red): #dc2626
- 🟠 High (Orange): #ea580c
- 🟡 Medium (Yellow): #eab308
- 🔵 Low (Blue): #3b82f6
- ⚪ Info (Purple): #8b5cf6

**Status Colors:**
- Open (Red): #ef4444
- Outstanding (Orange): #f97316
- Investigating (Yellow): #eab308
- Closed (Green): #22c55e
- Resolved (Teal): #10b981

## Complete Example

```typescript
import React, { useState, useEffect } from 'react';
import DashboardWithTracking from './components/DashboardWithTracking';
import { createLifecycleService } from './services/lifecycle.service';

function SocDashboard() {
  const lifecycleService = createLifecycleService();

  // Example: Simulate alert creation and actions
  useEffect(() => {
    // Initialize sample alert
    lifecycleService.initializeAlert(
      'ALERT-001',
      'Acme Corp',
      'Unusual login from new IP',
      'high'
    );

    // Simulate analyst actions
    setTimeout(() => {
      lifecycleService.logAction(
        'ALERT-001',
        'acknowledged',
        'Alert acknowledged by SOC'
      );
      lifecycleService.changeStatus('ALERT-001', 'investigating');
    }, 5000);

    // Simulate resolution after 15 seconds
    setTimeout(() => {
      lifecycleService.logAction(
        'ALERT-001',
        'verified',
        'Verified legitimate user login from home office'
      );
      lifecycleService.changeStatus('ALERT-001', 'resolved', 'False positive');
    }, 15000);
  }, []);

  return (
    <div>
      <h1>🔴 SOC Operations Center</h1>
      <DashboardWithTracking />
      
      {/* Export button */}
      <button
        onClick={() => {
          const csv = lifecycleService.exportAsCsv();
          console.log(csv);
        }}
        style={{ margin: '20px' }}
      >
        📊 Export Alerts CSV
      </button>
    </div>
  );
}

export default SocDashboard;
```

## Metrics & Reporting

### Alert Lifecycle Metrics

Track these metrics for SOC performance:

```typescript
// Get average time to close alert
const stats = lifecycleService.getAlertsByDuration('resolved');
const avg = stats.reduce((sum, s) => sum + s.totalDuration, 0) / stats.length;
console.log(`Average resolution time: ${lifecycleService.formatDuration(avg)}`);

// Count alerts by status
const allLifecycles = lifecycleService.getAllLifecycles();
const byStatus = allLifecycles.reduce((acc, l) => {
  acc[l.status] = (acc[l.status] || 0) + 1;
  return acc;
}, {});

// Most active analysts
const analysts = new Map<string, number>();
allLifecycles.forEach(l => {
  l.actions.forEach(a => {
    if (a.user) analysts.set(a.user, (analysts.get(a.user) || 0) + 1);
  });
});
```

## TypeScript Types

### Alert Lifecycle Type
```typescript
interface AlertLifecycle {
  alertId: string;
  tenantName: string;
  title: string;
  status: 'open' | 'outstanding' | 'investigating' | 'closed' | 'resolved';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  createdAt: string;
  openedAt: string;
  closedAt?: string;
  durationMs?: number;
  actions: AlertAction[];
  assignedTo?: string;
  notes?: string;
}
```

### Alert Action Type
```typescript
interface AlertAction {
  timestamp: string;
  action: string;
  description: string;
  user?: string;
  details?: Record<string, unknown>;
}
```

## Performance Tips

1. **Update Interval**: Set `refreshInterval={5000}` for less frequent updates if you have many alerts
2. **Pagination**: For >100 alerts, implement pagination in the dashboard
3. **Virtual Scrolling**: Use react-window for large alert lists
4. **Debounce**: Batch lifecycle updates to reduce re-renders

## Troubleshooting

### Timer not updating
- Check that `refreshInterval` prop is set (default: 1000ms)
- Verify `AlertLifecycleService` instance is mounted

### Alerts not appearing
- Ensure alerts are properly formatted with required fields: `id`, `title`, `status`, `severity`, `createdAt`, `tenantName`
- Check that alert status is not 'closed' or 'resolved' (they're hidden by default)

### Export not working
- Verify browser supports `Blob` and `URL.createObjectURL`
- Check browser console for errors

## Security Notes

- Never store API keys in localStorage; use environment variables
- Sanitize user input in notes and action descriptions
- Consider row-level security for client data
- Log all analyst actions for audit trails (which this system does!)
