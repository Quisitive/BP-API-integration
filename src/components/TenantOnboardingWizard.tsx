import React, { useEffect, useMemo, useState } from 'react';
import './TenantOnboardingWizard.css';

interface TenantSummary {
  alias: string;
  displayName: string;
  enabled: boolean;
  hasBlackpoint: boolean;
  hasMicrosoft: boolean;
}

interface BpTenant {
  id: string;
  name: string;
}

interface Props {
  onCreated: (tenant: TenantSummary) => void;
}

const defaultWorkloads = ['DefenderXdr', 'DefenderForOffice365'];

function normalizeAlias(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const TenantOnboardingWizard: React.FC<Props> = ({ onCreated }) => {
  const [displayName, setDisplayName] = useState('');
  const [alias, setAlias] = useState('');
  const [primaryAnalyst, setPrimaryAnalyst] = useState('');
  const [tags, setTags] = useState('');

  const [bpTenants, setBpTenants] = useState<BpTenant[]>([]);
  const [selectedBpCustomerId, setSelectedBpCustomerId] = useState('');
  const [blackpointApiKeyOverride, setBlackpointApiKeyOverride] = useState('');

  const [enableMicrosoft, setEnableMicrosoft] = useState(true);
  const [msTenantId, setMsTenantId] = useState('');
  const [msClientId, setMsClientId] = useState('');
  const [msClientSecret, setMsClientSecret] = useState('');
  const [workloads, setWorkloads] = useState<string[]>(defaultWorkloads);

  const [loadingBpTenants, setLoadingBpTenants] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedBpTenant = useMemo(
    () => bpTenants.find(t => t.id === selectedBpCustomerId),
    [bpTenants, selectedBpCustomerId],
  );

  useEffect(() => {
    setLoadingBpTenants(true);
    setError(null);

    fetch('/api/onboarding/blackpoint-tenants')
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load Blackpoint tenants (${res.status})`);
        }
        const data = (await res.json()) as { data: BpTenant[] };
        const tenants = data.data || [];
        setBpTenants(tenants);
        if (tenants.length > 0) {
          setSelectedBpCustomerId(tenants[0].id);
        }
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoadingBpTenants(false));
  }, []);

  useEffect(() => {
    if (!selectedBpTenant) return;
    if (!displayName) {
      setDisplayName(selectedBpTenant.name);
    }
    if (!alias) {
      setAlias(normalizeAlias(selectedBpTenant.name));
    }
  }, [selectedBpTenant, displayName, alias]);

  function toggleWorkload(workload: string) {
    setWorkloads(prev =>
      prev.includes(workload)
        ? prev.filter(w => w !== workload)
        : [...prev, workload],
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    const normalizedAlias = normalizeAlias(alias);

    try {
      const payload = {
        alias: normalizedAlias,
        displayName: displayName.trim(),
        primaryAnalyst: primaryAnalyst.trim() || undefined,
        tags: tags
          .split(',')
          .map(t => t.trim())
          .filter(Boolean),
        blackpoint: {
          customerId: selectedBpCustomerId,
          apiKeyOverride: blackpointApiKeyOverride.trim() || undefined,
        },
        microsoft: enableMicrosoft
          ? {
              tenantId: msTenantId.trim(),
              clientId: msClientId.trim(),
              clientSecret: msClientSecret.trim(),
              enabledWorkloads: workloads,
            }
          : undefined,
      };

      const res = await fetch('/api/onboarding/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body = (await res.json()) as TenantSummary & { error?: string; detail?: string };

      if (!res.ok) {
        throw new Error(body.error || body.detail || `Onboarding failed (${res.status})`);
      }

      setSuccess(`Tenant ${body.alias} onboarded successfully.`);
      onCreated(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="onboard-shell">
      <header className="onboard-header">
        <h2>Client Onboarding Wizard</h2>
        <p>
          Add a client tenant to the Unified Dashboard and optionally configure
          Microsoft Defender / Office 365 integration in one flow.
        </p>
      </header>

      <form className="onboard-form" onSubmit={handleSubmit}>
        <fieldset>
          <legend>1) Client Identity</legend>
          <label>
            Client display name
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="4Refuel"
              required
            />
          </label>
          <label>
            Tenant alias
            <input
              value={alias}
              onChange={(e) => setAlias(normalizeAlias(e.target.value))}
              placeholder="4refuel"
              required
            />
          </label>
          <label>
            Primary analyst (optional)
            <input
              value={primaryAnalyst}
              onChange={(e) => setPrimaryAnalyst(e.target.value)}
              placeholder="analyst@company.com"
            />
          </label>
          <label>
            Tags (comma-separated)
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="tier-1, logistics"
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>2) Blackpoint (Real Detection Data)</legend>
          <label>
            Blackpoint tenant
            <select
              value={selectedBpCustomerId}
              onChange={(e) => setSelectedBpCustomerId(e.target.value)}
              required
            >
              {loadingBpTenants ? (
                <option value="">Loading Blackpoint tenants…</option>
              ) : bpTenants.length === 0 ? (
                <option value="">No Blackpoint tenants returned</option>
              ) : (
                bpTenants.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.id})
                  </option>
                ))
              )}
            </select>
          </label>
          <label>
            API key override (optional)
            <input
              type="password"
              value={blackpointApiKeyOverride}
              onChange={(e) => setBlackpointApiKeyOverride(e.target.value)}
              placeholder="Use global COMPASSONE_API_KEY if left blank"
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>3) Office 365 / Defender</legend>
          <label className="inline-toggle">
            <input
              type="checkbox"
              checked={enableMicrosoft}
              onChange={(e) => setEnableMicrosoft(e.target.checked)}
            />
            Enable Microsoft Defender / Office 365 onboarding
          </label>

          {enableMicrosoft && (
            <>
              <label>
                Entra tenant ID
                <input
                  value={msTenantId}
                  onChange={(e) => setMsTenantId(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  required
                />
              </label>
              <label>
                App registration client ID
                <input
                  value={msClientId}
                  onChange={(e) => setMsClientId(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  required
                />
              </label>
              <label>
                Client secret
                <input
                  type="password"
                  value={msClientSecret}
                  onChange={(e) => setMsClientSecret(e.target.value)}
                  placeholder="Client secret"
                  required
                />
              </label>

              <div className="onboard-workloads">
                <span>Enabled workloads</span>
                {[
                  'DefenderXdr',
                  'DefenderForOffice365',
                  'DefenderForEndpoint',
                  'DefenderForIdentity',
                  'DefenderForCloudApps',
                ].map(workload => (
                  <label key={workload} className="inline-toggle">
                    <input
                      type="checkbox"
                      checked={workloads.includes(workload)}
                      onChange={() => toggleWorkload(workload)}
                    />
                    {workload}
                  </label>
                ))}
              </div>
            </>
          )}
        </fieldset>

        {error && <div className="onboard-message onboard-error">{error}</div>}
        {success && <div className="onboard-message onboard-success">{success}</div>}

        <div className="onboard-actions">
          <button type="submit" disabled={submitting}>
            {submitting ? 'Onboarding…' : 'Create Tenant'}
          </button>
        </div>
      </form>
    </section>
  );
};

export default TenantOnboardingWizard;
