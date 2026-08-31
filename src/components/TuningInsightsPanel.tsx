// ---------------------------------------------------------------------------
// Trends & Tuning Panel
// ---------------------------------------------------------------------------
// Surfaces closeout-derived tuning signal for SecOps: disposition mix, per-rule
// false-positive / noise rate (tuning candidates), and mean-time-to-resolve.
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import {
  bpTuningInsights,
  bpSnapshots,
  bpCaptureSnapshot,
  correlationTrends,
  bpAnomalies,
  correlationCandidates,
  type TuningInsights,
  type AlertTypeInsight,
  type TrendSnapshot,
  type CorrelationTrends,
  type AnomalyReport,
  type CorrelationCandidate,
} from '../services/unifiedApi';
import './TuningInsightsPanel.css';

interface Props {
  tenantAlias: string;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function mttr(hours: number | null): string {
  if (hours == null) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

const DISPOSITION_COLORS: Record<string, string> = {
  'true-positive': '#2e7d32',
  'false-positive': '#c62828',
  benign: '#00838f',
  duplicate: '#6a1b9a',
  informational: '#ef6c00',
  other: '#607d8b',
};

const TuningInsightsPanel: React.FC<Props> = ({ tenantAlias }) => {
  const [data, setData] = useState<TuningInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    bpTuningInsights(tenantAlias)
      .then((d) => { if (active) setData(d); })
      .catch((e) => { if (active) setError((e as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tenantAlias]);

  if (loading) return <div className="tip-loading">Loading tuning insights…</div>;
  if (error) return <div className="tip-error">Failed to load tuning insights: {error}</div>;
  if (!data) return null;

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tuning-insights-${tenantAlias}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const maxDisposition = Math.max(1, ...data.dispositionSummary.map((d) => d.count));

  return (
    <div className="tuning-insights-panel">
      <div className="tip-header">
        <div>
          <h3>Trends &amp; Tuning</h3>
          <p className="tip-sub">
            Based on {data.totalCloseouts} closeout{data.totalCloseouts === 1 ? '' : 's'} ·
            generated {new Date(data.generatedAt).toLocaleString()}
          </p>
        </div>
        <button className="tip-export" onClick={exportJson} disabled={data.totalCloseouts === 0}>
          Export JSON
        </button>
      </div>

      {data.totalCloseouts === 0 ? (
        <div className="tip-empty">
          No closeouts recorded yet. Close some cases in <strong>Closeout Governance</strong> to
          build tuning history (false-positive rate, MTTR, and noisy-rule detection).
        </div>
      ) : (
        <>
          {/* Overall metrics */}
          <section className="tip-section">
            <div className="tip-metrics">
              <div className="tip-metric">
                <div className="tip-metric-value">{data.totalCloseouts}</div>
                <div className="tip-metric-label">Closeouts</div>
              </div>
              <div className="tip-metric">
                <div className="tip-metric-value">{pct(data.overall.fpRate)}</div>
                <div className="tip-metric-label">False-positive rate</div>
              </div>
              <div className="tip-metric">
                <div className="tip-metric-value">{pct(data.overall.noiseRate)}</div>
                <div className="tip-metric-label">Non-actionable rate</div>
              </div>
              <div className="tip-metric">
                <div className="tip-metric-value">{mttr(data.overall.avgMttrHours)}</div>
                <div className="tip-metric-label">Avg MTTR</div>
              </div>
            </div>
          </section>

          {/* Disposition mix */}
          <section className="tip-section">
            <h4>Disposition Mix</h4>
            <div className="tip-bars">
              {data.dispositionSummary.map((d) => (
                <div key={d.disposition} className="tip-bar-row">
                  <div className="tip-bar-label">{d.disposition}</div>
                  <div className="tip-bar-track">
                    <div
                      className="tip-bar-fill"
                      style={{
                        width: `${(d.count / maxDisposition) * 100}%`,
                        background: DISPOSITION_COLORS[d.disposition] || '#607d8b',
                      }}
                    />
                  </div>
                  <div className="tip-bar-count">{d.count}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Tuning candidates */}
          <section className="tip-section">
            <h4>Tuning Candidates</h4>
            <p className="tip-hint">
              Rules with ≥ {data.thresholds.minSample} closeouts and ≥
              {' '}{pct(data.thresholds.noiseRateThreshold)} non-actionable outcomes.
            </p>
            {data.tuningCandidates.length === 0 ? (
              <div className="tip-none">No rules currently exceed the tuning threshold. 🎯</div>
            ) : (
              <RuleTable rows={data.tuningCandidates} highlight />
            )}
          </section>

          {/* All rules */}
          <section className="tip-section">
            <h4>All Rules by Noise Rate</h4>
            <RuleTable rows={data.byAlertType} />
          </section>

          {/* MTTR by type */}
          {data.mttrByType.length > 0 && (
            <section className="tip-section">
              <h4>Slowest Rules to Resolve (MTTR)</h4>
              <div className="tip-bars">
                {data.mttrByType.slice(0, 10).map((m) => {
                  const max = Math.max(1, ...data.mttrByType.map((x) => x.avgMttrHours));
                  return (
                    <div key={m.alertType} className="tip-bar-row">
                      <div className="tip-bar-label" title={m.alertType}>{m.alertType}</div>
                      <div className="tip-bar-track">
                        <div
                          className="tip-bar-fill"
                          style={{ width: `${(m.avgMttrHours / max) * 100}%`, background: '#5c6bc0' }}
                        />
                      </div>
                      <div className="tip-bar-count">{mttr(m.avgMttrHours)}</div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      <TrendHistorySection tenantAlias={tenantAlias} />
      <AnomaliesSection tenantAlias={tenantAlias} />
      <CorrelationTrendsSection tenantAlias={tenantAlias} />
      <CorrelationCandidatesSection tenantAlias={tenantAlias} />
    </div>
  );
};

const RuleTable: React.FC<{ rows: AlertTypeInsight[]; highlight?: boolean }> = ({ rows, highlight }) => (
  <table className="tip-table">
    <thead>
      <tr>
        <th>Alert Type</th>
        <th>Total</th>
        <th>TP</th>
        <th>FP</th>
        <th>Noise</th>
        <th>Noise Rate</th>
        <th>Avg MTTR</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((r) => (
        <tr key={r.alertType} className={highlight && r.isTuningCandidate ? 'tip-row-flag' : ''}>
          <td className="tip-rule">{r.alertType}</td>
          <td>{r.total}</td>
          <td>{r.truePositive}</td>
          <td>{r.falsePositive}</td>
          <td>{r.noise}</td>
          <td>
            <span className={`tip-rate ${r.noiseRate >= 0.5 ? 'high' : r.noiseRate >= 0.25 ? 'mid' : 'low'}`}>
              {pct(r.noiseRate)}
            </span>
          </td>
          <td>{mttr(r.avgMttrHours)}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

// ---------------------------------------------------------------------------
// Trend History — long-term snapshot persistence (beyond BP 90-day window)
// ---------------------------------------------------------------------------

const TrendHistorySection: React.FC<{ tenantAlias: string }> = ({ tenantAlias }) => {
  const [snapshots, setSnapshots] = useState<TrendSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    bpSnapshots(tenantAlias)
      .then(setSnapshots)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    bpSnapshots(tenantAlias)
      .then((d) => { if (active) setSnapshots(d); })
      .catch((e) => { if (active) setError((e as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tenantAlias]);

  const capture = async () => {
    setCapturing(true);
    setError(null);
    try {
      await bpCaptureSnapshot(tenantAlias);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCapturing(false);
    }
  };

  const maxTotal = Math.max(1, ...snapshots.map((s) => s.totalDetections));

  return (
    <section className="tip-section">
      <div className="tip-header">
        <div>
          <h4>Trend History</h4>
          <p className="tip-hint">
            Point-in-time detection volume captured over time — extends analysis beyond the
            Blackpoint 90-day API window.
          </p>
        </div>
        <button className="tip-export" onClick={capture} disabled={capturing}>
          {capturing ? 'Capturing…' : 'Capture Snapshot'}
        </button>
      </div>

      {loading ? (
        <div className="tip-none">Loading history…</div>
      ) : error ? (
        <div className="tip-error">Failed to load history: {error}</div>
      ) : snapshots.length === 0 ? (
        <div className="tip-none">
          No snapshots yet. Click <strong>Capture Snapshot</strong> to record the current
          detection counts, or enable the scheduler (ENABLE_TREND_SNAPSHOTS=true) for automatic
          periodic capture.
        </div>
      ) : (
        <div className="tip-bars">
          {snapshots.slice(-14).map((s) => (
            <div key={s.id} className="tip-bar-row">
              <div className="tip-bar-label" title={new Date(s.capturedAt).toLocaleString()}>
                {new Date(s.capturedAt).toLocaleDateString()}
              </div>
              <div className="tip-bar-track">
                <div
                  className="tip-bar-fill"
                  style={{ width: `${(s.totalDetections / maxTotal) * 100}%`, background: '#5c6bc0' }}
                />
              </div>
              <div className="tip-bar-count" title={`open ${s.openDetections} · resolved ${s.resolvedDetections}`}>
                {s.openDetections}/{s.totalDetections}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// Cross-Source Trends — Blackpoint <-> Defender XDR correlation signal
// ---------------------------------------------------------------------------

const CorrelationTrendsSection: React.FC<{ tenantAlias: string }> = ({ tenantAlias }) => {
  const [data, setData] = useState<CorrelationTrends | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    correlationTrends(tenantAlias)
      .then((d) => { if (active) setData(d); })
      .catch((e) => { if (active) setError((e as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tenantAlias]);

  if (loading) return <section className="tip-section"><h4>Cross-Source Trends</h4><div className="tip-none">Loading…</div></section>;
  if (error) return <section className="tip-section"><h4>Cross-Source Trends</h4><div className="tip-error">Failed to load: {error}</div></section>;
  if (!data) return null;

  const maxWeek = Math.max(1, ...data.byWeek.map((w) => w.count));
  const maxType = Math.max(1, ...data.byType.map((t) => t.count));

  return (
    <section className="tip-section">
      <h4>Cross-Source Trends</h4>
      <p className="tip-hint">
        Blackpoint detections corroborated with Defender XDR incidents.
      </p>

      {data.totalCorrelations === 0 ? (
        <div className="tip-none">
          No correlations recorded yet. Link Blackpoint detections to XDR incidents in the
          <strong> Correlation</strong> view to build cross-source trend signal.
        </div>
      ) : (
        <>
          <div className="tip-metrics">
            <div className="tip-metric">
              <div className="tip-metric-value">{data.totalCorrelations}</div>
              <div className="tip-metric-label">Correlations</div>
            </div>
            <div className="tip-metric">
              <div className="tip-metric-value">{data.distinctBpDetections}</div>
              <div className="tip-metric-label">BP detections</div>
            </div>
            <div className="tip-metric">
              <div className="tip-metric-value">{data.distinctXdrIncidents}</div>
              <div className="tip-metric-label">XDR incidents</div>
            </div>
            <div className="tip-metric">
              <div className="tip-metric-value">{pct(data.avgConfidence)}</div>
              <div className="tip-metric-label">Avg confidence</div>
            </div>
          </div>

          {data.byType.length > 0 && (
            <>
              <h5 className="tip-subhead">By Correlation Type</h5>
              <div className="tip-bars">
                {data.byType.map((t) => (
                  <div key={t.type} className="tip-bar-row">
                    <div className="tip-bar-label">{t.type}</div>
                    <div className="tip-bar-track">
                      <div className="tip-bar-fill" style={{ width: `${(t.count / maxType) * 100}%`, background: '#00838f' }} />
                    </div>
                    <div className="tip-bar-count">{t.count}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {data.byWeek.length > 0 && (
            <>
              <h5 className="tip-subhead">Volume by Week</h5>
              <div className="tip-bars">
                {data.byWeek.slice(-12).map((w) => (
                  <div key={w.week} className="tip-bar-row">
                    <div className="tip-bar-label">{w.week}</div>
                    <div className="tip-bar-track">
                      <div className="tip-bar-fill" style={{ width: `${(w.count / maxWeek) * 100}%`, background: '#5c6bc0' }} />
                    </div>
                    <div className="tip-bar-count">{w.count}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// Anomalies — spike alerts derived from trend-snapshot history
// ---------------------------------------------------------------------------

const SEVERITY_COLORS: Record<string, string> = {
  high: '#c62828',
  medium: '#ef6c00',
  low: '#f9a825',
};

function anomalyValue(a: { metric: string; value: number }): string {
  return a.metric === 'noiseRate' ? `${Math.round(a.value * 100)}%` : String(a.value);
}

const AnomaliesSection: React.FC<{ tenantAlias: string }> = ({ tenantAlias }) => {
  const [data, setData] = useState<AnomalyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    bpAnomalies(tenantAlias)
      .then((d) => { if (active) setData(d); })
      .catch((e) => { if (active) setError((e as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tenantAlias]);

  if (loading) return <section className="tip-section"><h4>Spike Alerts</h4><div className="tip-none">Loading…</div></section>;
  if (error) return <section className="tip-section"><h4>Spike Alerts</h4><div className="tip-error">Failed to load: {error}</div></section>;
  if (!data) return null;

  return (
    <section className="tip-section">
      <h4>Spike Alerts</h4>
      <p className="tip-hint">
        Anomalous jumps in detection volume or closeout noise rate vs. recent history
        ({data.snapshotCount} snapshot{data.snapshotCount === 1 ? '' : 's'}).
      </p>

      {data.anomalies.length === 0 ? (
        <div className="tip-none">
          No spikes detected. Capture more snapshots over time to build a baseline for anomaly detection.
        </div>
      ) : (
        <ul className="tip-anomaly-list">
          {data.anomalies.map((a, i) => (
            <li key={`${a.metric}-${a.capturedAt}-${i}`} className="tip-anomaly">
              <span
                className="tip-anomaly-sev"
                style={{ background: SEVERITY_COLORS[a.severity] || '#757575' }}
              >
                {a.severity}
              </span>
              <span className="tip-anomaly-body">
                <strong>{a.metric}</strong> → {anomalyValue(a)}
                {a.deltaPct !== Infinity && a.deltaPct > 0 && (
                  <span className="tip-anomaly-delta"> (+{Math.round(a.deltaPct * 100)}%)</span>
                )}
                <span className="tip-anomaly-date"> · {a.capturedAt.slice(0, 10)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// Suggested Correlations — auto-detected BP <-> XDR candidate links
// ---------------------------------------------------------------------------

const CorrelationCandidatesSection: React.FC<{ tenantAlias: string }> = ({ tenantAlias }) => {
  const [data, setData] = useState<CorrelationCandidate[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    correlationCandidates(tenantAlias)
      .then((d) => { if (active) setData(d); })
      .catch((e) => { if (active) setError((e as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tenantAlias]);

  if (loading) return <section className="tip-section"><h4>Suggested Correlations</h4><div className="tip-none">Loading…</div></section>;
  if (error) return <section className="tip-section"><h4>Suggested Correlations</h4><div className="tip-error">Failed to load: {error}</div></section>;
  if (!data) return null;

  return (
    <section className="tip-section">
      <h4>Suggested Correlations</h4>
      <p className="tip-hint">
        Auto-detected likely links between Blackpoint detections and Defender XDR incidents,
        scored by timing, title similarity, and shared entities.
      </p>

      {data.length === 0 ? (
        <div className="tip-none">
          No candidate correlations. Sync BP detections and XDR incidents so unlinked pairs can be scored.
        </div>
      ) : (
        <ul className="tip-candidate-list">
          {data.map((c) => (
            <li key={`${c.bpDetectionId}-${c.xdrIncidentId}`} className="tip-candidate">
              <div className="tip-candidate-head">
                <span className="tip-candidate-type">{c.correlationType}</span>
                <span className="tip-candidate-conf">{pct(c.confidence)}</span>
              </div>
              <div className="tip-candidate-titles">
                <span className="tip-candidate-bp">BP: {c.bpTitle}</span>
                <span className="tip-candidate-xdr">XDR: {c.xdrTitle}</span>
              </div>
              {c.reasons.length > 0 && (
                <div className="tip-candidate-reasons">{c.reasons.join(' · ')}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default TuningInsightsPanel;

