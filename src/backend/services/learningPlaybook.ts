// ---------------------------------------------------------------------------
// Learning Playbook — ACE Recommendation Engine
// ---------------------------------------------------------------------------
// Ingests playbook definitions and applies heuristic scoring to generate
// ranked mitigation recommendations for a given incident or detection.
// Designed to integrate with the Adaptive Confidence Engine (ACE) pipeline
// from the O365 Command Dashboard for continuous learning.
// ---------------------------------------------------------------------------

import type { MitigationRecommendation, RiskLevel, McpOperation } from '../types.js';

// ---------------------------------------------------------------------------
// Playbook Schema
// ---------------------------------------------------------------------------

export interface PlaybookEntry {
  id: string;
  title: string;
  description: string;
  /** Workload/source patterns this playbook applies to */
  matchPatterns: MatchPattern[];
  /** Risk level of the remediation action */
  riskLevel: RiskLevel;
  /** Optional MCP automation action */
  mcpOperation?: McpOperation;
  /** Manual steps if no automation */
  manualSteps?: string[];
  /** ACE confidence score (0-1). Updated by feedback loop. */
  confidence: number;
  /** How many times this playbook has been applied */
  appliedCount: number;
  /** How many times it was approved after being proposed */
  approvedCount: number;
  /** Enabled flag — disable entries that consistently fail */
  enabled: boolean;
}

export interface MatchPattern {
  /** Match field: 'title', 'workload', 'severity', 'entity', 'alertType' */
  field: string;
  /** Regex or exact match value */
  value: string;
  /** Whether value is a regex */
  isRegex?: boolean;
}

// ---------------------------------------------------------------------------
// Incident Context (passed into recommend())
// ---------------------------------------------------------------------------

export interface IncidentContext {
  title: string;
  severity: string;
  workloads: string[];
  alertTypes?: string[];
  entities?: string[];
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class LearningPlaybookEngine {
  private playbooks: PlaybookEntry[] = [];

  /**
   * Load playbooks from a JSON array (file or database).
   */
  loadPlaybooks(entries: PlaybookEntry[]): void {
    this.playbooks = entries.filter((e) => e.enabled);
  }

  /**
   * Add or update a playbook entry.
   */
  upsertPlaybook(entry: PlaybookEntry): void {
    const idx = this.playbooks.findIndex((p) => p.id === entry.id);
    if (idx >= 0) {
      this.playbooks[idx] = entry;
    } else if (entry.enabled) {
      this.playbooks.push(entry);
    }
  }

  /**
   * Generate ranked recommendations for an incident context.
   * Returns top N (default 5) matching playbooks ordered by score.
   */
  recommend(context: IncidentContext, maxResults = 5): MitigationRecommendation[] {
    const scored: Array<{ entry: PlaybookEntry; score: number }> = [];

    for (const entry of this.playbooks) {
      const matchScore = this.computeMatchScore(entry, context);
      if (matchScore <= 0) continue;

      // Final score: pattern match strength × ACE confidence × approval rate
      const approvalRate = entry.appliedCount > 0
        ? entry.approvedCount / entry.appliedCount
        : 0.5; // neutral for new entries
      const score = matchScore * entry.confidence * (0.5 + 0.5 * approvalRate);
      scored.push({ entry, score });
    }

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, maxResults).map(({ entry }) => ({
      id: entry.id,
      title: entry.title,
      description: entry.description,
      riskLevel: entry.riskLevel,
      mcpOperation: entry.mcpOperation,
      manualSteps: entry.manualSteps,
    }));
  }

  /**
   * Record feedback: increment applied/approved counts and adjust confidence.
   */
  recordFeedback(playbookId: string, wasApproved: boolean): void {
    const entry = this.playbooks.find((p) => p.id === playbookId);
    if (!entry) return;

    entry.appliedCount += 1;
    if (wasApproved) {
      entry.approvedCount += 1;
    }

    // Exponential moving average on confidence
    const feedback = wasApproved ? 1 : 0;
    const alpha = 0.1;
    entry.confidence = entry.confidence * (1 - alpha) + feedback * alpha;

    // Disable consistently rejected entries
    if (entry.appliedCount >= 10 && entry.approvedCount / entry.appliedCount < 0.1) {
      entry.enabled = false;
    }
  }

  /**
   * Export current playbooks (for persistence/serialization).
   */
  exportPlaybooks(): PlaybookEntry[] {
    return [...this.playbooks];
  }

  // -------------------------------------------------------------------------
  // Pattern Matching
  // -------------------------------------------------------------------------

  private computeMatchScore(entry: PlaybookEntry, context: IncidentContext): number {
    let totalScore = 0;
    let matchedPatterns = 0;

    for (const pattern of entry.matchPatterns) {
      const fieldValue = this.getFieldValue(context, pattern.field);
      if (!fieldValue) continue;

      const values = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
      const matched = values.some((v) => this.matchesPattern(v, pattern));

      if (matched) {
        matchedPatterns += 1;
        totalScore += 1;
      }
    }

    // All patterns must match for the entry to qualify
    if (matchedPatterns < entry.matchPatterns.length) {
      return 0;
    }

    return totalScore / entry.matchPatterns.length;
  }

  private getFieldValue(context: IncidentContext, field: string): string | string[] | undefined {
    switch (field) {
      case 'title': return context.title;
      case 'severity': return context.severity;
      case 'workload': return context.workloads;
      case 'alertType': return context.alertTypes;
      case 'entity': return context.entities;
      default: return undefined;
    }
  }

  private matchesPattern(value: string, pattern: MatchPattern): boolean {
    if (pattern.isRegex) {
      try {
        return new RegExp(pattern.value, 'i').test(value);
      } catch {
        return false;
      }
    }
    return value.toLowerCase() === pattern.value.toLowerCase();
  }
}
