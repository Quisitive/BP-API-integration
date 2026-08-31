# Client Onboarding Permissions Checklist

This document lists the permissions and tenant information required to onboard a client to the Unified SOC Command Dashboard and the related SecOps O365 Command Dashboard integration. Use it as the client-facing handoff before configuring `config/tenants.json` or using the Tenant Onboarding wizard.

## Scope

The integrated platform can connect to these provider surfaces for each client:

| Surface | Required for | Client approval needed |
| --- | --- | --- |
| Blackpoint CompassOne | Managed tenant lookup, detections, alert groups, analytics, reports, and assets. | Blackpoint API access for the client's customer/tenant ID. |
| Microsoft Graph Security | Incident list, incident detail, alert metadata, evidence links, and optional incident writeback. | Microsoft Entra app registration with Microsoft Graph application permissions and admin consent. |
| Defender XDR API | SecOps O365 Command Dashboard incident synchronization and case writeback. | Defender XDR application permissions for `api.security.microsoft.com`. |
| Defender Response MCP bridge | Optional future/advanced approved remediation execution. | Not required for initial onboarding. Grant action-specific permissions only if MCP remediation is explicitly enabled. |

Blackpoint-only onboarding is supported. Microsoft Defender XDR can be added later by updating the tenant entry. MCP remediation components are optional at this point and should not block client onboarding.

## Information To Collect

Collect the following before onboarding starts:

| Item | Required | Notes |
| --- | --- | --- |
| Client display name | Yes | Human-readable name shown in the dashboard. |
| Tenant alias | Yes | Lowercase URL-safe alias, for example `contoso-health`. |
| Primary SOC analyst | Recommended | Used for ownership and operations tracking. |
| Blackpoint customer ID | Yes for Blackpoint integration | UUID from CompassOne `/v1/tenants`; selected in the onboarding wizard when account-level access is available. |
| Microsoft Entra tenant ID | Yes for Defender XDR integration | Directory tenant ID for the client. |
| Entra application client ID | Yes for Defender XDR integration | App registration used by the backend client-credentials flow. |
| Entra application client secret | Yes for Defender XDR integration | Store as an environment variable or secret reference, not directly in source control. |
| Defender XDR API host | Required for SecOps O365 dashboard incident collection | Usually `https://api.security.microsoft.com`; may vary for sovereign or regional deployments. |
| Enabled Defender workloads | Recommended | Defaults can include `DefenderXdr` and `DefenderForOffice365`; add others only when used by the client. |
| MCP remediation bridge URL and signing secret | Optional | Collect only if the client approves automated remediation dispatch. Not needed for read-only dashboards, triage, case tracking, or manual response workflows. |

## Blackpoint CompassOne Permissions

The backend authenticates to CompassOne with a bearer API key and scopes tenant requests with the client's `x-tenant-id` customer ID header.

Required CompassOne access:

| Capability | API usage | Permission needed |
| --- | --- | --- |
| Tenant selection during onboarding | `GET /v1/tenants` | Account-level permission to list managed tenants. |
| Detection dashboard | `GET /v1/alert-groups`, `GET /v1/alert-groups/{id}`, `GET /v1/alert-groups/{id}/alerts` | Read access to alert groups and alerts for the client tenant. |
| Detection analytics | `GET /v1/alert-groups/count`, `/alert-groups-by-week`, `/top-detections-by-entity`, `/top-detections-by-threat` | Read access to alert group analytics. |
| Reports | `GET /v1/reports`, `/reports/{id}/url`, `/reports/{id}/json` | Read access to report runs and report content. |
| Assets | `GET /v1/assets` | Read access to asset inventory. |

Credential handling:

- Prefer one account-level `COMPASSONE_API_KEY` held by the backend when it is approved for all onboarded clients.
- Use a tenant-specific `blackpoint.apiKeyOverride` only when the client requires a separate key.
- Do not place CompassOne API keys in frontend `REACT_APP_*` or `VITE_*` variables.
- Rotate the API key immediately if it is pasted into chat, committed, or shared outside the approved secret store.

## Microsoft Defender XDR And O365 Dashboard Permissions

The backends use Microsoft Entra client credentials for each client tenant. Configure an app registration in the client's Entra tenant and grant application permissions with admin consent.

Minimum Microsoft Graph permissions by mode:

| Mode | Microsoft Graph application permissions | Why |
| --- | --- | --- |
| Read-only Defender XDR | `SecurityIncident.Read.All` | List and read Defender XDR incidents. |
| Read-only with alert evidence links | `SecurityIncident.Read.All`, `SecurityAlert.Read.All` | Read incidents and related alert metadata used for evidence/deep-link navigation. |
| Incident writeback enabled | `SecurityIncident.ReadWrite.All`, `SecurityAlert.Read.All` | Update incident assignment, status, classification, determination, and tags; continue reading alert metadata. |

Admin consent is required for these application permissions. Microsoft documents `SecurityIncident.Read.All` as the least-privileged application permission for listing incidents and `SecurityIncident.ReadWrite.All` as the higher-privileged permission when write operations are required.

Additional SecOps O365 Command Dashboard permissions for Defender XDR API access:

| Mode | Defender XDR API application permission | Why |
| --- | --- | --- |
| Continuous incident collection | `Incident.Read.All` | Read the incident queue from `api.security.microsoft.com` for tenant synchronization. |
| Case writeback to Defender XDR | `Incident.ReadWrite.All` | Assign case owner, update status, and add investigation notes or comments where supported. |

For a client using both dashboards with read-only incident visibility, approve `SecurityIncident.Read.All`, `SecurityAlert.Read.All`, and `Incident.Read.All`. For a client using writeback, approve `SecurityIncident.ReadWrite.All`, `SecurityAlert.Read.All`, and `Incident.ReadWrite.All`.

The application currently writes only incident metadata through Graph:

| Writeback field | Purpose |
| --- | --- |
| `assignedTo` | Assign an incident owner. |
| `status` | Move incidents through active, in-progress, resolved, or redirected states. |
| `classification` | Record true positive, false positive, or related classification decisions where supported. |
| `determination` | Record incident determination where supported. |
| `customTags` | Add tags for SOC workflow tracking. |

Do not grant broader Microsoft Graph permissions such as `Directory.Read.All`, `User.Read.All`, `Mail.ReadWrite`, or device action permissions unless a future feature explicitly requires them.

## Installation And Human Operator Roles

Use least privilege for tenant installation and ongoing SOC operations:

| Task | Recommended role | Notes |
| --- | --- | --- |
| Create app registration or enterprise app | Application Administrator or Cloud Application Administrator | Global Administrator can also perform this but is broader than needed. |
| Configure app credentials | Application Administrator or app owner | Prefer certificate credentials in production; client secrets are acceptable for initial setup. |
| Grant tenant-wide admin consent | Global Administrator, or Cloud/Application Administrator where tenant policy allows | Required for application permissions. |
| Verify SOC operator access in Defender portal | Security Administrator or Security Operator | Needed for human investigation workflow validation. |
| View incidents and evidence in portal | Security Reader or Security Operator | Applies to analysts opening dashboard deep links. |
| Investigate and respond in portal | Security Operator | Required for hands-on portal response. |
| Change security policy or workload configuration | Security Administrator | Do not grant for routine dashboard usage. |

## Entra App Registration Setup

Use this process for each Microsoft-enabled client tenant:

1. Create or identify an Entra app registration dedicated to this integration.
2. Add Microsoft Graph and Defender XDR API application permissions for the selected mode above.
3. Have a tenant administrator grant admin consent.
4. Create a client secret or certificate credential.
5. Provide the tenant ID, client ID, and secret reference to the onboarding operator.
6. Store the secret in `.env`, a deployment secret store, or a future Key Vault reference; use `${ENV_VAR_NAME}` in `config/tenants.json`.

Recommended environment variable pattern:

```bash
CLIENT_ALIAS_MS_CLIENT_SECRET=secret-value
```

Example tenant entry shape:

```json
{
  "alias": "client-alias",
  "displayName": "Client Name",
  "blackpoint": {
    "customerId": "blackpoint-customer-uuid"
  },
  "microsoft": {
    "tenantId": "client-entra-tenant-id",
    "clientId": "app-registration-client-id",
    "clientSecret": "${CLIENT_ALIAS_MS_CLIENT_SECRET}",
    "securityApiHost": "https://api.security.microsoft.com",
    "enabledWorkloads": ["DefenderXdr", "DefenderForOffice365"]
  },
  "enabled": true
}
```

## Network And Portal Access

The workstation or hosting environment running the backend needs outbound HTTPS access to:

| Destination | Purpose |
| --- | --- |
| `https://api.blackpointcyber.com` | CompassOne API calls. |
| `https://login.microsoftonline.com` | Entra token acquisition. |
| `https://graph.microsoft.com` | Microsoft Graph Security API. |
| `https://api.security.microsoft.com` | Optional Defender security API host when configured for a tenant. |
| `https://security.microsoft.com` | Analyst portal deep links opened from the dashboard. |

Analysts who open Defender portal links need the appropriate interactive Defender portal role in the client tenant, such as Security Reader, Security Operator, Security Administrator, or another role approved by the client.

## Optional MCP Remediation Components

MCP remediation is optional at this stage. The dashboards can still onboard clients, collect incidents, show evidence links, support triage, create remediation proposals, and track approvals without any MCP bridge configuration or action permissions.

Only enable the MCP automation bridge after the client separately approves automated remediation dispatch. No remediation action should run without explicit analyst approval.

If the bridge is approved and enabled, configure:

| Setting | Purpose |
| --- | --- |
| `MCP_AUTOMATION_WEBHOOK_URL` | Target endpoint for approved remediation operations. |
| `MCP_AUTOMATION_WEBHOOK_SECRET` | HMAC signing secret for webhook integrity. |

The client should approve any downstream permissions held by that separate remediation service. These permissions are not part of baseline onboarding. Grant them only when the corresponding automation action is enabled:

| Remediation capability | Example permission or API scope | Approval guidance |
| --- | --- | --- |
| Device isolation | `Machine.Isolate` for Defender for Endpoint API | Approve only if analysts may isolate devices through the bridge. |
| Device release from isolation | Defender for Endpoint machine action permission required by the bridge implementation | Pair with isolation only when release workflows are enabled. |
| Antivirus scan | `Machine.Scan` for Defender for Endpoint API | Approve only if analysts may trigger AV scans. |
| Advanced endpoint lookups | `Machine.Read.All`, `Alert.Read.All` | Use when remediation proposals require endpoint or alert enrichment beyond incident data. |
| Identity or session response | Action-specific Microsoft Graph or identity permissions | Define per action, for example session revocation or password reset, before requesting consent. |
| Mail purge or email remediation | Action-specific Exchange Online or Defender for Office 365 permissions | Define per action, for example purge or message remediation, before requesting consent. |

Baseline onboarding recommendation: leave `MCP_AUTOMATION_WEBHOOK_URL` and `MCP_AUTOMATION_WEBHOOK_SECRET` unset. Perform response actions manually in the client-approved portals until MCP remediation is formally approved.

## Validation Checklist

After credentials are configured, validate the client with these checks:

| Check | Expected result |
| --- | --- |
| `GET /api/tenants` | Client appears with `enabled: true`. |
| `GET /api/tenants/:alias/bp/analytics/count?status=OPEN` | Returns a count, or a clear CompassOne permission error. |
| `GET /api/tenants/:alias/bp/detections?status=OPEN` | Returns open detections for Blackpoint-enabled clients. |
| `GET /api/tenants/:alias/xdr/incidents?top=5` | Returns recent Defender XDR incidents for Microsoft-enabled clients. |
| `GET /api/tenants/{tenantAlias}/incidents?top=5` in the SecOps O365 dashboard | Returns recent Defender XDR incidents through the O365 dashboard API. |
| Open incident evidence links | Analyst can open `security.microsoft.com` links with their own portal permissions. |
| Incident writeback test | Only run when `SecurityIncident.ReadWrite.All` was approved; update a test incident and confirm the change in Defender. |
| O365 dashboard writeback test | Only run when `Incident.ReadWrite.All` was approved; update a controlled test incident or case field and confirm the change in Defender. |
| Optional MCP remediation bridge test | Skip for baseline onboarding. Only run when bridge action permissions were separately approved; create a low-risk proposal and verify approval, signing, dispatch, and audit logging. |

## Common Onboarding Failures

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| CompassOne returns `401 Unauthorized` | Missing, expired, or unauthorized CompassOne API key. | Verify `COMPASSONE_API_KEY` or tenant `apiKeyOverride`; confirm the key is approved for the client customer ID. |
| CompassOne returns tenant-specific failures | Wrong Blackpoint customer ID. | Re-select the customer from `/v1/tenants` or confirm the UUID with Blackpoint. |
| Defender token acquisition fails | Wrong tenant ID, client ID, secret, or expired secret. | Recreate the app credential and update the secret store. |
| Defender API returns `403 Forbidden` | Missing Graph application permission or admin consent. | Add the required application permissions and grant admin consent. |
| Incidents load but writeback fails | App has read-only incident permission. | Add and consent `SecurityIncident.ReadWrite.All`, or disable writeback for that client. |
| O365 dashboard incidents fail while Graph incidents work | Missing Defender XDR API permission such as `Incident.Read.All`, wrong `securityApiHost`, or API host blocked. | Add and consent the Defender XDR API permission and confirm outbound access to `api.security.microsoft.com`. |
| O365 dashboard writeback fails | Missing `Incident.ReadWrite.All` for the Defender XDR API. | Add and consent `Incident.ReadWrite.All`, or disable O365 dashboard writeback. |
| Optional remediation bridge approval succeeds but execution fails | Missing action-specific permission on the bridge service principal or webhook signing/configuration issue. | Confirm MCP remediation is actually enabled, confirm the bridge credential has only the approved action scopes, and verify `MCP_AUTOMATION_WEBHOOK_URL` / `MCP_AUTOMATION_WEBHOOK_SECRET`. |
| Portal links fail for an analyst | Analyst lacks interactive Defender portal access. | Assign an approved Defender or Entra security role for portal use. |

## Client Approval Summary

Before enabling production access, record approval for:

- Blackpoint CompassOne tenant read access for detections, reports, assets, and analytics.
- Microsoft Graph application permissions selected for the client's mode.
- Defender XDR API application permissions selected for SecOps O365 dashboard collection and writeback.
- Admin consent owner and date.
- Secret storage location and rotation owner.
- Whether incident writeback is approved.
- Whether optional MCP remediation is out of scope for baseline onboarding, or explicitly approved with the exact action-specific permissions granted.
