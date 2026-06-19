# Unified SOC Command Dashboard

Centralized Security Operations dashboard combining **Blackpoint Cyber (CompassOne)** and **Microsoft Defender XDR** into a single multi-tenant command surface. Built for Quisitive SecOps teams managing MDR-protected environments.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  React SPA (Vite, port 3000 in dev)                     │
│  ┌─────────┬─────────┬─────────┬─────────┬─────────────┐ │
│  │ Unified │ Correla-│ Triage &│ Closeout│ Tenant      │ │
│  │ Dash    │ tions   │ Remediat│ Govern. │ Onboarding  │ │
│  └─────────┴─────────┴─────────┴─────────┴─────────────┘ │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTP /api/* (Vite proxies to backend)
┌───────────────────────────┴─────────────────────────────┐
│  Express Backend (port 3001)                            │
│  ┌────────┬────────┬───────────┬────────────────────────┐│
│  │ /bp/*  │ /xdr/* │ /unified/*│ /onboarding/*          ││
│  │Compass-│Defender│Correlation│ List/add/update tenants││
│  │One API │XDR API │Triage etc │ (writes tenants.json)  ││
│  └────────┴────────┴───────────┴────────────────────────┘│
│  Middleware: Auth · RBAC · Tenant Isolation · Rate Limit│
│  Storage: Memory | PostgreSQL | Cosmos DB               │
└───────┬───────────────────┬──────────────────────┬──────┘
        │                   │                      │
        ▼                   ▼                      ▼
┌───────────────┐  ┌──────────────────┐  ┌───────────────────────┐
│ CompassOne    │  │ Microsoft Graph  │  │ Defender Response MCP │
│ (Blackpoint)  │  │ Security API     │  │ gateway (SecOps-O365  │
│ api.black...  │  │ graph.microsoft  │  │ module) — signed      │
│               │  │                  │  │ webhook, optional     │
└───────────────┘  └──────────────────┘  └───────────────────────┘
```

### Deployment Model (Alpha)

The product is split into cooperating modules. Their alpha-stage hosting differs:

| Component | Alpha hosting | Notes |
|-----------|---------------|-------|
| **Unified SOC Command Dashboard** (this repo) | **Local install** | Runs on an analyst workstation via `npm run dev` (backend `:3001`, Vite UI `:3000`). Reads provider credentials from local `.env` + `config/tenants.json`. |
| **CompassOne / Blackpoint API** | Network (vendor SaaS) | `https://api.blackpointcyber.com`. Reached directly from the local backend with the account-level `COMPASSONE_API_KEY`. |
| **Microsoft Defender XDR** | Network (Microsoft cloud) | Microsoft Graph Security API. Reached via MSAL `client_credentials` using per-tenant Entra app registrations stored in `config/tenants.json`. |
| **Defender Response MCP gateway** (`SecOps-O365-Command-Dashboard` module) | **Network application** (deployed separately) | Receives approved remediation proposals from this module over a signed webhook (`MCP_AUTOMATION_WEBHOOK_URL` / `MCP_AUTOMATION_WEBHOOK_SECRET`). Optional in alpha — if unset, remediation falls back to manual steps. |

**Module interaction summary:** this dashboard is the local control surface. It *reads* from CompassOne and Defender XDR (both network SaaS), and *writes back* incident updates to Defender XDR. Approved automated responses are *dispatched* to the network-deployed Defender Response MCP gateway (the SecOps-O365 module), which performs the privileged device/identity actions. For alpha, everything except the MCP gateway runs locally on the operator's machine.


## Features

- **Multi-tenant architecture** — Per-tenant config with isolated API credentials and data scoping
- **Tenant onboarding wizard** — Pull the account's Blackpoint customers and onboard them from the UI (no manual JSON editing required)
- **Blackpoint CompassOne integration** — Detections, analytics, reports, and asset inventory
- **Microsoft Defender XDR integration** — Incidents, evidence links, writeback, and remediation
- **Cross-source correlation** — Link BP detections to XDR incidents (entity, temporal, title, or analyst-confirmed)
- **Learning Playbook Engine** — Adaptive triage recommendations with confidence scoring
- **Remediation proposals** — Human-in-the-loop approve/reject workflow with MCP bridge execution
- **Closeout governance** — Formal case closure with resolution taxonomy and audit trail
- **Full audit log** — Every action recorded with actor, timestamp, and context
- **Pluggable storage** — Memory (dev), PostgreSQL, or Cosmos DB backends (lazily imported — no extra dependencies needed for default memory mode)

## Quick Start

### Prerequisites

- Node.js 20+
- npm 9+

### Install

```bash
npm install
```

### Configure Environment

Copy the template and fill in your real values. **Never commit `.env`** — it is gitignored.

```bash
cp .env.example .env
```

`.env` keys (see [.env.example](.env.example)):

```bash
# Blackpoint CompassOne — account-level API key (backend only)
COMPASSONE_API_URL=https://api.blackpointcyber.com
COMPASSONE_API_KEY=bpc_your-account-level-key

# Legacy Node scripts (optional — same key/url as above)
BLACKPOINT_API_URL=https://api.blackpointcyber.com
BLACKPOINT_API_KEY=bpc_your-account-level-key

# Per-tenant Microsoft secrets referenced from config/tenants.json
# (one set per tenant, e.g. NONIN_*, CONTOSO_*)
NONIN_MS_CLIENT_SECRET=your-entra-app-secret

# Defender Response MCP gateway (optional — alpha falls back to manual steps)
MCP_AUTOMATION_WEBHOOK_URL=
MCP_AUTOMATION_WEBHOOK_SECRET=

# Optional storage (default: memory)
STORAGE_BACKEND=memory          # memory | postgres | cosmos
DATABASE_URL=postgresql://...   # for postgres
COSMOS_ENDPOINT=https://...     # for cosmos
COSMOS_KEY=...                  # for cosmos

# Backend port (default 3001)
PORT=3001
```

> **Do not** put Blackpoint or Microsoft secrets in `REACT_APP_*` variables. The frontend calls the backend `/api` endpoints and must never carry provider tokens.

### Tenant Configuration

`config/tenants.json` holds your real tenant entries and is **gitignored** (it contains customer/tenant identifiers). Start from the committed template:

```bash
cp config/tenants.example.json config/tenants.json
```

Each tenant entry includes:
- `alias` — URL-safe identifier used in all API paths
- `blackpoint.customerId` — the Blackpoint customer UUID (optional `apiBaseUrl`, `apiKeyOverride`)
- `microsoft` — `tenantId`, `clientId`, `clientSecret`, `enabledWorkloads[]` (set the whole object to `null` for BP-only tenants / local dev without Entra credentials)

**Keep secrets out of `tenants.json`.** Reference them from `.env` using `${VAR_NAME}` placeholders, which the loader resolves at runtime:

```jsonc
"microsoft": {
  "tenantId": "b46b48f9-...",
  "clientId": "f02061d7-...",
  "clientSecret": "${NONIN_MS_CLIENT_SECRET}",   // resolved from .env
  "enabledWorkloads": ["DefenderXdr", "DefenderForOffice365"]
}
```

#### Onboarding tenants from the UI

Instead of hand-editing JSON, use the **Tenant Onboarding** panel in the dashboard:

1. Open the dashboard and select **Tenant Onboarding**.
2. The wizard calls `GET /api/onboarding/blackpoint-tenants` to list every Blackpoint customer on your account.
3. Pick a customer, set an alias/display name, and (optionally) add Microsoft Defender credentials.
4. Submit — the backend appends the entry to `config/tenants.json` and registers it live (no restart needed).

For Microsoft-enabled tenants, add the matching secret to `.env` (e.g. `NONIN_MS_CLIENT_SECRET=...`) and reference it as `${NONIN_MS_CLIENT_SECRET}` in the wizard's client-secret field so the secret never lands in `tenants.json`.

### Run (Development)

```bash
npm run dev          # Starts both backend (tsx watch :3001) + Vite dev server (:3000)
```

Access:
- **Dashboard UI**: http://localhost:3000 (Vite dev server proxies `/api` to the backend)
- **API Health**: http://localhost:3001/api/health

### Build & Production

```bash
npm run build        # Builds client (Vite) + server (tsc → dist-server/)
npm start            # Runs compiled server (node dist-server/backend/server.js)
```

### Docker

```bash
docker build -t soc-command .
docker run -p 3001:3001 --env-file .env soc-command
```


## API Reference

All tenant-scoped routes: `GET|POST|PATCH /api/tenants/:alias/...`

### Onboarding (`/api/onboarding`)

Account-level routes (not tenant-scoped) that power the Tenant Onboarding wizard.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/onboarding/tenants` | List onboarded tenants (secret-free summaries) |
| GET | `/api/onboarding/blackpoint-tenants` | List all Blackpoint customers on the account (max `pageSize` 200) |
| POST | `/api/onboarding/tenants` | Onboard a new tenant; persists to `config/tenants.json` and registers it live |
| PATCH | `/api/onboarding/tenants/:alias` | Update an existing tenant's config |

### Blackpoint (`/bp`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/bp/detections` | List detections (?status, ?skip, ?take) |
| GET | `/bp/detections/:id` | Get single detection |
| GET | `/bp/detections/:id/alerts` | Get alerts for detection |
| GET | `/bp/analytics/count` | Detection count (?status) |
| GET | `/bp/analytics/weekly-trends` | Weekly trend metrics |
| GET | `/bp/analytics/top-entities` | Top entities (?top) |
| GET | `/bp/analytics/top-threats` | Top threats (?top) |
| GET | `/bp/reports` | List reports (?reportType, ?page) |
| GET | `/bp/reports/:id/pdf` | Get signed PDF URL |
| GET | `/bp/reports/:id/json` | Get JSON report payload |
| GET | `/bp/assets` | List assets (?page, ?pageSize) |
| GET | `/bp/assets/count` | Asset count |

### Defender XDR (`/xdr`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/xdr/incidents` | List incidents (?top, ?filter) |
| GET | `/xdr/incidents/:id` | Get single incident |
| PATCH | `/xdr/incidents/:id` | Update incident (writeback) |
| GET | `/xdr/incidents/:id/case` | Get local case record |
| GET | `/xdr/evidence/:id` | Evidence links for incident |
| POST | `/xdr/remediation/plan` | Create remediation plan |
| GET | `/xdr/remediation/proposals` | List proposals (?incidentId) |
| GET | `/xdr/remediation/proposals/:id` | Get proposal |
| POST | `/xdr/remediation/proposals/:id/decide` | Approve/reject |

### Unified (`/unified`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/unified/alerts` | Cross-source alert timeline (?limit, ?source) |
| POST | `/unified/alerts` | Record alert snapshot |
| GET | `/unified/correlations` | List all correlations |
| POST | `/unified/correlations` | Create correlation link |
| GET | `/unified/correlations/by-detection/:id` | Correlations for BP detection |
| GET | `/unified/correlations/by-incident/:id` | Correlations for XDR incident |
| GET | `/unified/closeouts` | List closeout records (?limit) |
| POST | `/unified/closeouts` | Close a case |
| GET | `/unified/audit` | Audit event trail (?incidentId, ?actor) |
| GET | `/unified/audit/cases` | Local case records |
| GET | `/unified/audit/detections` | Local BP detections |
| POST | `/unified/triage/recommend` | Get playbook recommendations |
| GET | `/unified/triage/playbooks` | Export all playbooks |
| PUT | `/unified/triage/playbooks/:id` | Upsert playbook entry |
| POST | `/unified/triage/playbooks/:id/feedback` | Record feedback |

## Project Structure

```
src/
  backend/
    config/          # Tenant schema, loader, example JSON
    middleware/      # Auth, RBAC, rate limit, audit, tenant isolation
    routes/
      bp/            # Blackpoint CompassOne route handlers
      xdr/           # Defender XDR + remediation route handlers
      unified/       # Correlation, triage, closeout, audit
      onboarding.ts  # Tenant onboarding (list/add/update tenants)
    services/        # API clients, playbook engine, MCP bridge
    storage/         # Repository interface + memory/postgres/cosmos
    server.ts        # Express entry point
  components/        # React UI panels (incl. TenantOnboardingWizard)
  services/          # Frontend API client (unifiedApi.ts)
  auth/              # MSAL config + React hooks
legacy/              # Original BP-only services (preserved)
config/              # tenants.json (gitignored), tenants.example.json
docs/                # Architecture proposals
grafana/             # Pre-built Grafana dashboards
```

## Development Scripts

```bash
npm run dev           # Full-stack dev (backend + Vite)
npm run dev:client    # Vite only
npm run dev:server    # Backend only (tsx watch)
npm run build         # Production build
npm run type-check    # TypeScript validation
npm run legacy:dev    # Legacy workflow sample
```

## Security

- **Secrets never committed** — `.env`, `.env.*`, and `config/tenants.json` are gitignored; only `.env.example` and `config/tenants.example.json` (placeholders) are tracked
- Tenant secrets live in `.env` and are referenced from `config/tenants.json` via `${VAR}` placeholders (resolved at runtime)
- API keys never logged (audit logger redacts sensitive fields)
- Per-tenant credential isolation — no cross-tenant data leakage
- Rate limiting per IP (100 req/15min default)
- Security headers via Helmet
- Input validation on all mutation endpoints
- MSAL PKCE for frontend auth, client_credentials for backend token acquisition

See [SECURITY_SUMMARY.md](SECURITY_SUMMARY.md) and [SECURITY_REVIEW.md](SECURITY_REVIEW.md).

## License

Proprietary — Quisitive
