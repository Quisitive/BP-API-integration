// ---------------------------------------------------------------------------
// After Action Report (AAR) Generator
// ---------------------------------------------------------------------------
// Aggregates incident/detection/alert data from Blackpoint CompassOne and
// Microsoft Defender XDR for a case, then produces a draft After Action Report
// with an auto-suggested remediation plan (owner / timeline / priority) built
// from the Learning Playbook Engine plus deterministic baseline steps.
//
// The generated report is a DRAFT — every field is analyst-editable before
// the report is finalized.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { DefenderApiClient } from './defenderApi.js';
import { CompassOneClient } from './compassOneClient.js';
import { LearningPlaybookEngine } from './learningPlaybook.js';
import type { UnifiedTenantConfig } from '../config/tenants.schema.js';
import type {
  AfterActionReport,
  AarSourceRef,
  AarTimelineEntry,
  RemediationAction,
  RemediationPriority,
  IncidentSummary,
} from '../types.js';
import type { RiskLevel } from '../types.js';

// ---------------------------------------------------------------------------
// Severity / Priority helpers
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<string, number> = {
  informational: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const RANK_SEVERITY = ['Informational', 'Low', 'Medium', 'High', 'Critical'];

function riskScoreToSeverity(riskScore: number): string {
  if (riskScore >= 80) return 'Critical';
  if (riskScore >= 60) return 'High';
  if (riskScore >= 40) return 'Medium';
  if (riskScore >= 20) return 'Low';
  return 'Informational';
}

function highestSeverity(severities: string[]): string {
  let top = 0;
  for (const s of severities) {
    const rank = SEVERITY_RANK[(s || '').toLowerCase()] ?? 0;
    if (rank > top) top = rank;
  }
  return RANK_SEVERITY[top];
}

const RISK_TO_PRIORITY: Record<RiskLevel, RemediationPriority> = {
  critical: 'P1',
  high: 'P2',
  medium: 'P3',
  low: 'P4',
};

const PRIORITY_TIMELINE: Record<RemediationPriority, string> = {
  P1: 'Immediate (within 4 hours)',
  P2: 'Within 24 hours',
  P3: 'Within 3 business days',
  P4: 'Within 1 week',
};

function severityToRisk(severity: string): RiskLevel {
  switch ((severity || '').toLowerCase()) {
    case 'critical': return 'critical';
    case 'high': return 'high';
    case 'medium': return 'medium';
    default: return 'low';
  }
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export interface GenerateAarInput {
  tenant: UnifiedTenantConfig;
  authoredBy: string;
  title?: string;
  xdrIncidentIds?: string[];
  bpDetectionIds?: string[];
}

export class AarGenerator {
  private readonly defender: DefenderApiClient;
  private readonly compassOne: CompassOneClient;
  private readonly playbooks: LearningPlaybookEngine;

  constructor(playbooks?: LearningPlaybookEngine) {
    this.defender = new DefenderApiClient();
    this.compassOne = new CompassOneClient();
    this.playbooks = playbooks ?? new LearningPlaybookEngine();
  }

  async generate(input: GenerateAarInput): Promise<AfterActionReport> {
    const { tenant, authoredBy } = input;
    const xdrIds = input.xdrIncidentIds ?? [];
    const bpIds = input.bpDetectionIds ?? [];

    const sources: AarSourceRef[] = [];
    const timeline: AarTimelineEntry[] = [];
    const impactedAssets = new Set<string>();
    const severities: string[] = [];
    const workloads = new Set<string>();
    const alertTypes = new Set<string>();
    const xdrIncidents: IncidentSummary[] = [];
    const warnings: string[] = [];

    // ---- Aggregate Defender XDR incidents + alerts ----
    for (const incidentId of xdrIds) {
      try {
        const incident = await this.defender.getIncident(tenant, incidentId);
        xdrIncidents.push(incident);
        severities.push(incident.severity);
        (incident.workloads || []).forEach((w) => workloads.add(w));

        sources.push({
          system: 'defender-xdr',
          kind: 'incident',
          id: incident.id,
          title: incident.title,
          severity: incident.severity,
          status: incident.status,
          createdAt: incident.createdTime,
        });

        timeline.push({
          timestamp: incident.createdTime,
          source: 'defender-xdr',
          label: `Incident created: ${incident.title}`,
          detail: `Severity ${incident.severity} · ${incident.alertsCount} alert(s)`,
        });

        if (incident.assignedTo) impactedAssets.add(`Owner: ${incident.assignedTo}`);

        // Pull alert deep-links as evidence + timeline entries
        try {
          const links = await this.defender.getIncidentEvidenceLinks(tenant, incidentId);
          for (const link of links) {
            if (link.source === 'defender-alert') {
              sources.push({
                system: 'defender-xdr',
                kind: 'alert',
                id: link.url,
                title: link.label.replace(/^Alert:\s*/, ''),
              });
            }
          }
        } catch {
          // evidence links are best-effort
        }
      } catch (err) {
        warnings.push(`XDR incident ${incidentId}: ${(err as Error).message}`);
      }
    }

    // ---- Aggregate Blackpoint detections + alerts ----
    for (const detectionId of bpIds) {
      try {
        const group = await this.compassOne.getDetection(tenant, detectionId);
        const derivedSeverity = riskScoreToSeverity(group.riskScore ?? 0);
        severities.push(derivedSeverity);
        (group.alertTypes || []).forEach((t) => alertTypes.add(t));

        sources.push({
          system: 'blackpoint',
          kind: 'detection',
          id: group.id,
          title: group.groupKey,
          severity: derivedSeverity,
          status: group.status,
          createdAt: group.created,
        });

        timeline.push({
          timestamp: group.created,
          source: 'blackpoint',
          label: `Detection: ${group.groupKey}`,
          detail: `Risk score ${group.riskScore} · ${group.alertCount} alert(s) · ${(group.alertTypes || []).join(', ')}`,
        });

        if (group.alert?.hostname) impactedAssets.add(group.alert.hostname);
        if (group.alert?.username) impactedAssets.add(group.alert.username);

        // Pull individual alerts within the group
        try {
          const alerts = await this.compassOne.getAlerts(tenant, detectionId, { take: 50 });
          for (const a of alerts.items || []) {
            if (a.hostname) impactedAssets.add(a.hostname);
            if (a.username) impactedAssets.add(a.username);
            sources.push({
              system: 'blackpoint',
              kind: 'alert',
              id: a.id,
              title: a.ruleName || a.id,
              createdAt: a.created,
            });
            timeline.push({
              timestamp: a.created,
              source: 'blackpoint',
              label: `Alert: ${a.ruleName || a.id}`,
              detail: [a.hostname, a.username].filter(Boolean).join(' · ') || undefined,
            });
          }
        } catch {
          // alert enumeration is best-effort
        }
      } catch (err) {
        warnings.push(`BP detection ${detectionId}: ${(err as Error).message}`);
      }
    }

    // ---- Sort timeline chronologically ----
    timeline.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));

    const severity = highestSeverity(severities);
    const outstandingRisk = xdrIncidents.some(
      (i) => i.status === 'Active' || i.status === 'InProgress',
    ) || sources.some((s) => s.system === 'blackpoint' && s.status === 'OPEN');

    // ---- Build remediation recommendations ----
    const remediationActions = this.buildRemediationActions(
      severity,
      [...workloads],
      [...alertTypes],
      [...impactedAssets],
      xdrIncidents,
      outstandingRisk,
    );

    const now = new Date().toISOString();
    const primaryTitle = input.title
      || xdrIncidents[0]?.title
      || sources.find((s) => s.title)?.title
      || 'Incident After Action Report';

    const report: AfterActionReport = {
      id: randomUUID(),
      tenantAlias: tenant.alias,
      title: primaryTitle,
      status: 'draft',
      authoredBy,
      createdAt: now,
      updatedAt: now,
      severity,
      sources,
      timeline,
      impactedAssets: [...impactedAssets],
      executiveSummary: this.buildExecutiveSummary(primaryTitle, severity, sources, outstandingRisk),
      detectionSummary: this.buildDetectionSummary(sources, timeline),
      investigationFindings: warnings.length
        ? `Automated aggregation notes:\n- ${warnings.join('\n- ')}\n\n(Complete the investigation findings here.)`
        : '',
      containmentActions: '',
      rootCause: '',
      lessonsLearned: '',
      remediationActions,
      outstandingRisk,
    };

    return report;
  }

  // -------------------------------------------------------------------------
  // Narrative builders
  // -------------------------------------------------------------------------

  private buildExecutiveSummary(
    title: string,
    severity: string,
    sources: AarSourceRef[],
    outstandingRisk: boolean,
  ): string {
    const xdrCount = sources.filter((s) => s.system === 'defender-xdr' && s.kind === 'incident').length;
    const bpCount = sources.filter((s) => s.system === 'blackpoint' && s.kind === 'detection').length;
    const parts = [
      `${title} was investigated at ${severity} severity.`,
      `This case aggregates ${xdrCount} Defender XDR incident(s) and ${bpCount} Blackpoint detection(s).`,
      outstandingRisk
        ? 'Remediation is still outstanding — see the recommended next steps below.'
        : 'The case appears contained; validate the remediation checklist before closure.',
    ];
    return parts.join(' ');
  }

  private buildDetectionSummary(sources: AarSourceRef[], timeline: AarTimelineEntry[]): string {
    const first = timeline[0]?.timestamp;
    const last = timeline[timeline.length - 1]?.timestamp;
    const window = first && last ? `Activity spanned ${first} to ${last}. ` : '';
    const alertCount = sources.filter((s) => s.kind === 'alert').length;
    return `${window}${alertCount} contributing alert(s) were correlated across the aggregated sources.`;
  }

  // -------------------------------------------------------------------------
  // Remediation plan
  // -------------------------------------------------------------------------

  private buildRemediationActions(
    severity: string,
    workloads: string[],
    alertTypes: string[],
    impactedAssets: string[],
    xdrIncidents: IncidentSummary[],
    outstandingRisk: boolean,
  ): RemediationAction[] {
    const actions: RemediationAction[] = [];
    const seenTitles = new Set<string>();

    const add = (
      title: string,
      description: string,
      owner: string,
      riskLevel: RiskLevel,
    ) => {
      const key = title.toLowerCase();
      if (seenTitles.has(key)) return;
      seenTitles.add(key);
      const priority = RISK_TO_PRIORITY[riskLevel];
      actions.push({
        id: randomUUID(),
        title,
        description,
        owner,
        timeline: PRIORITY_TIMELINE[priority],
        priority,
        status: 'open',
        source: 'auto',
        riskLevel,
      });
    };

    // 1) Playbook-engine recommendations (if any playbooks are loaded)
    const primaryTitle = xdrIncidents[0]?.title || alertTypes[0] || severity;
    const recommendations = this.playbooks.recommend({
      title: primaryTitle,
      severity,
      workloads,
      alertTypes,
      entities: impactedAssets,
    });
    for (const rec of recommendations) {
      const steps = rec.manualSteps?.length ? `\nSteps:\n- ${rec.manualSteps.join('\n- ')}` : '';
      add(rec.title, `${rec.description}${steps}`, 'SOC Analyst', rec.riskLevel);
    }

    // 2) Deterministic baseline steps derived from the case shape
    const caseRisk = severityToRisk(severity);
    add(
      'Confirm scope and impacted assets',
      `Validate impacted users, devices, and identities: ${impactedAssets.length ? impactedAssets.join(', ') : 'confirm from source evidence'}.`,
      'SOC Analyst',
      caseRisk,
    );

    if (outstandingRisk) {
      add(
        'Contain active threat',
        'Isolate affected endpoints, disable compromised identities, and block known malicious indicators before further analysis.',
        'Incident Response Team',
        'critical',
      );
    }

    if (workloads.includes('DefenderForOffice365')) {
      add(
        'Remediate malicious email',
        'Review malicious email traces and perform tenant-wide message remediation (soft/hard delete) where required.',
        'Email Security / SOC Analyst',
        'high',
      );
    }

    if (workloads.includes('DefenderForEndpoint')) {
      add(
        'Endpoint hunting and hardening',
        'Run endpoint hunting queries on impacted hosts, verify sensor coverage, and confirm no persistence remains.',
        'Endpoint Security',
        'high',
      );
    }

    if (workloads.includes('DefenderForIdentity')) {
      add(
        'Reset and review affected identities',
        'Force password resets, revoke active sessions, and review sign-in risk for impacted accounts.',
        'Identity / IAM Team',
        'high',
      );
    }

    add(
      'Document closure rationale',
      'Record owner, decision, and closure rationale in the audit trail before final remediation sign-off.',
      'SOC Lead',
      'low',
    );

    // Order by priority (P1 first)
    actions.sort((a, b) => a.priority.localeCompare(b.priority));
    return actions;
  }
}
