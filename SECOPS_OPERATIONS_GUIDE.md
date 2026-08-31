# SecOps Operations Guide — Unified SOC Command Dashboard

## Purpose

This guide is for Quisitive SecOps analysts and SOC operators who use the Unified SOC Command Dashboard daily. It covers common workflows, operational procedures, and troubleshooting.

---

## 1. Accessing the Dashboard

1. Navigate to the dashboard URL (default: `http://localhost:5173` in dev, or your deployed URL)
2. Sign in with your organizational Microsoft account (Entra ID SSO)
3. Enter your **tenant alias** in the top-right input (e.g., `contoso`, `fabrikam`)
4. The Unified Dashboard loads automatically with cross-source KPIs

---

## 2. Daily SOC Workflow

### 2.1 Morning Triage

1. Open **Unified Dashboard** tab
2. Review the KPI cards:
   - **BP Open Detections** — New Blackpoint alerts needing attention
   - **XDR Active Incidents** — Microsoft Defender incidents in progress
   - **High/Critical XDR** — Escalated items needing immediate response
   - **Correlations** — Linked cross-source events
3. Scan the **Recent Alert Timeline** for new entries from both sources
4. Prioritize: High/Critical XDR incidents first, then open BP detections

### 2.2 Incident Investigation

1. Click an incident in the **Defender XDR Incidents** table
2. Navigate to **Triage & Remediation** tab
3. Click **Get Playbook Recommendations** — the engine suggests actions based on learned patterns
4. Review recommendations (risk-tagged as Low/Medium/High/Critical)
5. Click **Create Remediation Plan** to generate formal proposals
6. **Approve** actions you want executed, or **Reject** with a reason

### 2.3 Cross-Source Correlation

When a Blackpoint detection appears related to an XDR incident:

1. Go to **Correlations** tab
2. Enter the BP Detection ID and XDR Incident ID
3. Select correlation type:
   - **Analyst Confirmed** — You've verified the link manually
   - **Entity Match** — Same host/user involved
   - **Temporal** — Events occurred within the same time window
   - **Title Match** — Similar alert descriptions
4. Set confidence (0.5–1.0) and click **Link**
5. The correlation appears in both the Correlations table and the Unified Dashboard KPIs

### 2.4 Case Closeout

When an investigation is complete:

1. Go to **Closeout Governance** tab
2. Enter the BP Detection ID and/or XDR Incident ID
3. Select a resolution:
   - **True Positive — Remediated** (threat confirmed and fixed)
   - **True Positive — No Action Needed** (self-resolved or accepted risk)
   - **False Positive** (not a real threat)
   - **Benign Positive** (real activity, not malicious)
   - **Duplicate** (already tracked elsewhere)
   - **Informational Only** (noted but not actionable)
4. Add analyst notes explaining your reasoning
5. Click **Close Case**
6. The closure is recorded with your identity and a full audit trail

---

## 3. API Endpoints (For Automation & Scripting)

All endpoints require tenant alias in the path: `/api/tenants/{alias}/...`

### Quick Reference

```bash
# List open BP detections
curl http://localhost:7071/api/tenants/contoso/bp/detections?status=OPEN

# List XDR incidents (top 20)
curl http://localhost:7071/api/tenants/contoso/xdr/incidents?top=20

# Get correlations
curl http://localhost:7071/api/tenants/contoso/unified/correlations

# Create a closeout
curl -X POST http://localhost:7071/api/tenants/contoso/unified/closeouts \
  -H "Content-Type: application/json" \
  -d '{"xdrIncidentId":"inc-123","resolution":"true-positive-remediated","closedBy":"jsmith","notes":"Phishing campaign contained"}'

# Get audit trail
curl http://localhost:7071/api/tenants/contoso/unified/audit
```

---

## 4. Tenant Configuration

### Adding a New Tenant

1. Edit `config/tenants.json`
2. Add an entry following this structure:

```json
{
  "alias": "newtenant",
  "displayName": "New Tenant Corp",
  "blackpoint": {
    "customerId": "bp-customer-uuid",
    "apiKeyOverride": null
  },
  "microsoft": {
    "tenantId": "azure-ad-tenant-id",
    "clientId": "app-registration-client-id",
    "clientSecret": "app-registration-secret",
    "workloads": ["DefenderForEndpoint", "DefenderForOffice365"]
  }
}
```

3. Restart the server — the tenant is immediately available at `/api/tenants/newtenant/...`

### Removing a Tenant

Remove the entry from `config/tenants.json` and restart. Historical data remains in storage.

---

## 5. Storage Backends

| Backend | Use Case | Config |
|---------|----------|--------|
| `memory` | Development, testing | Default — no setup needed |
| `postgres` | Production with SQL-based tooling | Set `DATABASE_URL` env var |
| `cosmos` | Azure-native, global distribution | Set `COSMOS_ENDPOINT` + `COSMOS_KEY` |

Switch backends by setting `STORAGE_BACKEND` environment variable.

---

## 6. Understanding Correlations

### Correlation Types

| Type | Meaning | Typical Confidence |
|------|---------|-------------------|
| `analyst-confirmed` | Human verified the link | 0.9–1.0 |
| `entity` | Same host, user, or IP in both sources | 0.6–0.8 |
| `temporal` | Events within ±15 min window | 0.4–0.6 |
| `title` | Similar alert title keywords | 0.3–0.5 |

### Best Practices

- Always confirm automated correlations before closing cases
- Use `analyst-confirmed` when you've validated the link
- Low-confidence correlations (< 0.5) should be treated as leads, not facts

---

## 7. Remediation Proposals

### Lifecycle

```
Recommendation → Proposal (pending) → Approved / Rejected → Executed / Failed
```

### Risk Levels

| Level | Auto-Execute? | Requires |
|-------|---------------|----------|
| `low` | No | Analyst approval |
| `medium` | No | Analyst approval |
| `high` | No | Senior analyst approval |
| `critical` | No | SOC lead approval + documented reason |

All proposals require human approval. No automated execution occurs without explicit approval.

### MCP Bridge

When a proposal is approved and has an `mcpOperation`, the system dispatches it via the MCP Bridge (HMAC-signed webhook). If no webhook is configured, the proposal is marked as requiring manual execution with steps listed in the UI.

---

## 8. Audit Trail

Every significant action is logged:

- Incident syncs from both sources
- Correlation creates
- Remediation proposals (create, approve, reject, execute)
- Case closeouts

Access via:
- **UI**: Closeout Governance → Audit Trail tab
- **API**: `GET /api/tenants/:alias/unified/audit`

Filter by `?incidentId=` or `?actor=` to narrow results.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Failed to fetch incidents from Defender XDR" | Microsoft token expired or misconfigured | Check `microsoft.clientSecret` in tenants.json |
| 502 on BP endpoints | CompassOne API key invalid or rate-limited | Verify `COMPASSONE_API_KEY`, wait for rate limit reset |
| Empty correlations after linking | Storage not initialized | Check server logs for `[boot] Storage backend ready` |
| KPI shows 0 for everything | Tenant alias mismatch | Ensure the alias in the URL matches `config/tenants.json` |
| "Tenant not found" 404 | Alias not in registry | Add tenant to config and restart |

### Checking Server Health

```bash
curl http://localhost:7071/health
# Returns: { "status": "ok", "tenants": 2, "uptime": ... }
```

---

## 10. Security Responsibilities

- **Never share API keys** in chat, tickets, or public channels
- **Use SSO** — do not bypass authentication in production
- **Review audit logs** weekly for unexpected activity
- **Report** any 403/401 errors that shouldn't occur to the platform team
- **Rotate credentials** quarterly (BP API keys, Entra app secrets)

See [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md) for the full pre-deployment security checklist.

---

## 11. Legacy Dashboard

The original Blackpoint-only dashboard is still accessible via the **Legacy BP Dashboard** nav tab. It operates independently using `REACT_APP_BLACKPOINT_API_KEY` environment variable and direct browser-side API calls. Use the unified backend routes (`/bp/*`) for new integrations.

---

## Contact

- Platform issues: File in this repository's Issues tab
- Urgent SOC matters: Quisitive SecOps Slack channel
