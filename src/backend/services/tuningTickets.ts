// ---------------------------------------------------------------------------
// Service — Tuning Tickets
// ---------------------------------------------------------------------------
// Turns ranked tuning candidates (from tuningInsights) into actionable tickets
// SecOps can hand to an ITSM/backlog: a title, priority, summary, evidence,
// recommendation and labels. Pure functions so routes and tests reuse them.
// ---------------------------------------------------------------------------

import type { AlertTypeInsight, TuningInsights } from './tuningInsights.js';

export type TicketPriority = 'P1' | 'P2' | 'P3';

export interface TuningTicket {
  alertType: string;
  title: string;
  priority: TicketPriority;
  summary: string;
  recommendation: string;
  evidence: {
    total: number;
    falsePositive: number;
    noise: number;
    fpRate: number;
    noiseRate: number;
    avgMttrHours: number | null;
  };
  labels: string[];
}

export interface TuningTicketsOptions {
  /** Cap on the number of tickets returned (highest-impact first). */
  limit?: number;
}

const DEFAULT_LIMIT = 50;

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** Priority from noise pressure: high noise + high volume escalates. */
function priorityFor(insight: AlertTypeInsight): TicketPriority {
  if (insight.noiseRate >= 0.8 || (insight.noiseRate >= 0.6 && insight.total >= 20)) return 'P1';
  if (insight.noiseRate >= 0.6 || insight.total >= 20) return 'P2';
  return 'P3';
}

function recommendationFor(insight: AlertTypeInsight): string {
  if (insight.fpRate >= 0.6) {
    return `Tune or suppress this rule: ${pct(insight.fpRate)} of ${insight.total} closeouts were false positives.`;
  }
  if (insight.noiseRate >= 0.6) {
    return `Review detection logic and enrichment: ${pct(insight.noiseRate)} non-actionable outcomes across ${insight.total} closeouts.`;
  }
  return `Monitor and refine: ${pct(insight.noiseRate)} noise across ${insight.total} closeouts is above threshold.`;
}

/** Build actionable tuning tickets from computed insights. */
export function buildTuningTickets(
  insights: TuningInsights,
  options: TuningTicketsOptions = {},
): TuningTicket[] {
  const limit = options.limit ?? DEFAULT_LIMIT;
  return insights.tuningCandidates
    .slice()
    .sort((a, b) => b.noiseRate - a.noiseRate || b.total - a.total)
    .slice(0, Math.max(0, limit))
    .map((insight) => {
      const priority = priorityFor(insight);
      const mttr = insight.avgMttrHours != null ? `${insight.avgMttrHours.toFixed(1)}h avg MTTR` : 'no MTTR data';
      return {
        alertType: insight.alertType,
        title: `Tune noisy detection: ${insight.alertType}`,
        priority,
        summary: `${insight.alertType} produced ${pct(insight.noiseRate)} noise (${insight.noise}/${insight.total}) and ${pct(insight.fpRate)} false positives (${mttr}).`,
        recommendation: recommendationFor(insight),
        evidence: {
          total: insight.total,
          falsePositive: insight.falsePositive,
          noise: insight.noise,
          fpRate: insight.fpRate,
          noiseRate: insight.noiseRate,
          avgMttrHours: insight.avgMttrHours,
        },
        labels: ['tuning', `priority:${priority.toLowerCase()}`, 'secops'],
      };
    });
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Render tuning tickets as CSV (one row per ticket) for backlog import. */
export function ticketsToCsv(tickets: TuningTicket[]): string {
  const header = [
    'alertType',
    'priority',
    'title',
    'summary',
    'recommendation',
    'total',
    'falsePositive',
    'noise',
    'fpRate',
    'noiseRate',
    'avgMttrHours',
    'labels',
  ];
  const rows = tickets.map((t) =>
    [
      t.alertType,
      t.priority,
      t.title,
      t.summary,
      t.recommendation,
      t.evidence.total,
      t.evidence.falsePositive,
      t.evidence.noise,
      t.evidence.fpRate,
      t.evidence.noiseRate,
      t.evidence.avgMttrHours ?? '',
      t.labels.join('|'),
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...rows].join('\n');
}
