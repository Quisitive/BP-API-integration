import React, { useEffect, useMemo, useState } from 'react';
import Dashboard from './components/Dashboard';
import UnifiedCommandDashboard from './components/UnifiedCommandDashboard';
import CorrelationPanel from './components/CorrelationPanel';
import TriageRemediationPanel from './components/TriageRemediationPanel';
import CloseoutGovernancePanel from './components/CloseoutGovernancePanel';
import TenantOnboardingWizard from './components/TenantOnboardingWizard';
import './App.css';

type View = 'legacy' | 'unified' | 'correlations' | 'triage' | 'closeout' | 'onboarding';

interface TenantSummary {
  alias: string;
  displayName: string;
  enabled: boolean;
  hasBlackpoint: boolean;
  hasMicrosoft: boolean;
}

function App() {
  const [view, setView] = useState<View>('unified');
  const [tenantAlias, setTenantAlias] = useState('');
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [tenantLoadError, setTenantLoadError] = useState<string | null>(null);

  const enabledTenants = useMemo(() => tenants.filter(t => t.enabled), [tenants]);

  async function loadTenants() {
    try {
      setTenantLoadError(null);
      const res = await fetch('/api/tenants');
      if (!res.ok) {
        throw new Error(`Failed to load tenants (${res.status})`);
      }

      const data = (await res.json()) as TenantSummary[];
      setTenants(data);

      if (!tenantAlias && data.length > 0) {
        setTenantAlias(data[0].alias);
      }
    } catch (err) {
      setTenantLoadError((err as Error).message);
    }
  }

  useEffect(() => {
    void loadTenants();
  }, []);

  return (
    <div className="App">
      {/* Navigation Bar */}
      <nav className="app-nav">
        <span className="app-nav-brand">SOC Command Center</span>
        <div className="app-nav-links">
          <button className={view === 'unified' ? 'active' : ''} onClick={() => setView('unified')}>
            Unified Dashboard
          </button>
          <button className={view === 'correlations' ? 'active' : ''} onClick={() => setView('correlations')}>
            Correlations
          </button>
          <button className={view === 'triage' ? 'active' : ''} onClick={() => setView('triage')}>
            Triage & Remediation
          </button>
          <button className={view === 'closeout' ? 'active' : ''} onClick={() => setView('closeout')}>
            Closeout Governance
          </button>
          <button className={view === 'legacy' ? 'active' : ''} onClick={() => setView('legacy')}>
            Legacy BP Dashboard
          </button>
          <button className={view === 'onboarding' ? 'active' : ''} onClick={() => setView('onboarding')}>
            Onboard Client
          </button>
        </div>
        <div className="app-nav-tenant">
          <label htmlFor="tenant-select">Tenant:</label>
          <select
            id="tenant-select"
            value={tenantAlias}
            onChange={(e) => setTenantAlias(e.target.value)}
          >
            {enabledTenants.length === 0 ? (
              <option value="">No tenants onboarded</option>
            ) : (
              enabledTenants.map(t => (
                <option key={t.alias} value={t.alias}>
                  {t.alias} — {t.displayName}
                </option>
              ))
            )}
          </select>
          <button className="app-link-button" onClick={() => void loadTenants()}>
            Refresh
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="app-main">
        {tenantLoadError && <div className="app-error-banner">Failed to load tenants: {tenantLoadError}</div>}

        {!tenantAlias && view !== 'legacy' && view !== 'onboarding' && (
          <div className="app-prompt">Enter a tenant alias above to begin.</div>
        )}

        {view === 'legacy' && <Dashboard />}
        {view === 'onboarding' && (
          <TenantOnboardingWizard
            onCreated={(tenant) => {
              setTenants(prev => {
                const next = prev.filter(t => t.alias !== tenant.alias);
                next.push(tenant);
                return next.sort((a, b) => a.alias.localeCompare(b.alias));
              });
              setTenantAlias(tenant.alias);
              setView('unified');
            }}
          />
        )}
        {view === 'unified' && tenantAlias && <UnifiedCommandDashboard tenantAlias={tenantAlias} />}
        {view === 'correlations' && tenantAlias && <CorrelationPanel tenantAlias={tenantAlias} />}
        {view === 'triage' && tenantAlias && <TriageRemediationPanel tenantAlias={tenantAlias} />}
        {view === 'closeout' && tenantAlias && <CloseoutGovernancePanel tenantAlias={tenantAlias} currentUser="analyst" />}
      </main>
    </div>
  );
}

export default App;
