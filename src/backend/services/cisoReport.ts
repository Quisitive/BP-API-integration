// ---------------------------------------------------------------------------
// Service — CISO Executive Report
// ---------------------------------------------------------------------------
// Rolls up the tenant's SOC signal (closeout tuning, correlation trends,
// detection volume trend, and spike anomalies) into an executive-ready report
// with KPIs, highlights and recommended actions. Pure functions — the route
// gathers the inputs and this module shapes + renders them.
// ---------------------------------------------------------------------------

import type { TuningInsights } from './tuningInsights.js';
import type { CorrelationTrends } from './correlationTrends.js';
import type { AnomalyReport } from './snapshotAnomalies.js';
import type { TrendSnapshot } from '../types.js';

export interface CisoReportInput {
  tenantAlias: string;
  tenantName: string;
  insights: TuningInsights;
  trends: CorrelationTrends;
  snapshots: TrendSnapshot[];
  anomalies: AnomalyReport;
}

export interface CisoKpis {
  totalCloseouts: number;
  falsePositiveRate: number;
  noiseRate: number;
  avgMttrHours: number | null;
  openDetections: number;
  detectionTrendPct: number | null;
  totalCorrelations: number;
  avgCorrelationConfidence: number;
  highSeverityAnomalies: number;
}

export interface CisoHighlight {
  label: string;
  detail: string;
}

export interface CisoReport {
  generatedAt: string;
  tenantAlias: string;
  tenantName: string;
  kpis: CisoKpis;
  topNoisyRules: { alertType: string; noiseRate: number; total: number }[];
  highlights: CisoHighlight[];
  recommendations: string[];
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Percentage change from the earliest to the latest snapshot's total. */
function detectionTrend(snapshots: TrendSnapshot[]): { openDetections: number; pct: number | null } {
  if (snapshots.length === 0) return { openDetections: 0, pct: null };
  const sorted = snapshots.slice().sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const pct = first.totalDetections > 0
    ? round((last.totalDetections - first.totalDetections) / first.totalDetections)
    : null;
  return { openDetections: last.openDetections, pct };
}

/** Build the structured executive report from gathered SOC signal. */
export function buildCisoReport(input: CisoReportInput): CisoReport {
  const { insights, trends, snapshots, anomalies } = input;
  const trend = detectionTrend(snapshots);
  const highSeverityAnomalies = anomalies.anomalies.filter((a) => a.severity === 'high').length;

  const kpis: CisoKpis = {
    totalCloseouts: insights.totalCloseouts,
    falsePositiveRate: round(insights.overall.fpRate),
    noiseRate: round(insights.overall.noiseRate),
    avgMttrHours: insights.overall.avgMttrHours != null ? round(insights.overall.avgMttrHours, 1) : null,
    openDetections: trend.openDetections,
    detectionTrendPct: trend.pct,
    totalCorrelations: trends.totalCorrelations,
    avgCorrelationConfidence: round(trends.avgConfidence),
    highSeverityAnomalies,
  };

  const topNoisyRules = insights.tuningCandidates
    .slice()
    .sort((a, b) => b.noiseRate - a.noiseRate || b.total - a.total)
    .slice(0, 3)
    .map((r) => ({ alertType: r.alertType, noiseRate: round(r.noiseRate), total: r.total }));

  const highlights: CisoHighlight[] = [];
  if (trend.pct != null) {
    const dir = trend.pct >= 0 ? 'up' : 'down';
    highlights.push({
      label: 'Detection volume',
      detail: `Total detections are ${dir} ${Math.abs(Math.round(trend.pct * 100))}% over the reporting window.`,
    });
  }
  highlights.push({
    label: 'Cross-source correlation',
    detail: `${trends.totalCorrelations} BP\u2194XDR correlations at ${Math.round(trends.avgConfidence * 100)}% average confidence.`,
  });
  if (highSeverityAnomalies > 0) {
    highlights.push({
      label: 'Spike alerts',
      detail: `${highSeverityAnomalies} high-severity spike${highSeverityAnomalies === 1 ? '' : 's'} detected in trend history.`,
    });
  }

  const recommendations: string[] = [];
  if (topNoisyRules.length > 0) {
    recommendations.push(
      `Tune the top ${topNoisyRules.length} noisy detection rule(s) to reduce analyst load: ${topNoisyRules.map((r) => r.alertType).join(', ')}.`,
    );
  }
  if (insights.overall.fpRate >= 0.4) {
    recommendations.push(
      `False-positive rate is ${Math.round(insights.overall.fpRate * 100)}% \u2014 prioritize detection tuning to lift SOC efficiency.`,
    );
  }
  if (highSeverityAnomalies > 0) {
    recommendations.push('Review high-severity spike alerts for emerging campaigns or misconfiguration.');
  }
  if (recommendations.length === 0) {
    recommendations.push('Signal is within expected thresholds \u2014 maintain current tuning cadence.');
  }

  return {
    generatedAt: new Date().toISOString(),
    tenantAlias: input.tenantAlias,
    tenantName: input.tenantName,
    kpis,
    topNoisyRules,
    highlights,
    recommendations,
  };
}

function fmtPct(n: number | null): string {
  return n == null ? 'n/a' : `${Math.round(n * 100)}%`;
}

function fmtSignedPct(n: number | null): string {
  if (n == null) return 'n/a';
  const p = Math.round(n * 100);
  return `${p >= 0 ? '+' : ''}${p}%`;
}

/** Render the executive report as Markdown for export/email. */
export function renderCisoReportMarkdown(report: CisoReport): string {
  const k = report.kpis;
  const lines: string[] = [];
  lines.push(`# CISO Security Report — ${report.tenantName}`);
  lines.push('');
  lines.push(`_Generated ${new Date(report.generatedAt).toUTCString()}_`);
  lines.push('');
  lines.push('## Key Performance Indicators');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Closeouts analyzed | ${k.totalCloseouts} |`);
  lines.push(`| False-positive rate | ${fmtPct(k.falsePositiveRate)} |`);
  lines.push(`| Non-actionable (noise) rate | ${fmtPct(k.noiseRate)} |`);
  lines.push(`| Avg. MTTR (hours) | ${k.avgMttrHours ?? 'n/a'} |`);
  lines.push(`| Open detections (latest) | ${k.openDetections} |`);
  lines.push(`| Detection volume trend | ${fmtSignedPct(k.detectionTrendPct)} |`);
  lines.push(`| Cross-source correlations | ${k.totalCorrelations} |`);
  lines.push(`| Avg. correlation confidence | ${fmtPct(k.avgCorrelationConfidence)} |`);
  lines.push(`| High-severity spike alerts | ${k.highSeverityAnomalies} |`);
  lines.push('');

  lines.push('## Highlights');
  lines.push('');
  for (const h of report.highlights) lines.push(`- **${h.label}:** ${h.detail}`);
  lines.push('');

  if (report.topNoisyRules.length > 0) {
    lines.push('## Top Noisy Detection Rules');
    lines.push('');
    lines.push('| Rule | Noise rate | Closeouts |');
    lines.push('| --- | --- | --- |');
    for (const r of report.topNoisyRules) {
      lines.push(`| ${r.alertType} | ${fmtPct(r.noiseRate)} | ${r.total} |`);
    }
    lines.push('');
  }

  lines.push('## Recommendations');
  lines.push('');
  report.recommendations.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
  lines.push('');

  return lines.join('\n');
}
