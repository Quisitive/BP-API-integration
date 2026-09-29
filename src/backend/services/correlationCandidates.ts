// ---------------------------------------------------------------------------
// Service — Automated Correlation Detection
// ---------------------------------------------------------------------------
// Proposes cross-source correlations between Blackpoint detections and Defender
// XDR incidents by scoring temporal proximity, title similarity, and shared
// entities. Already-confirmed pairs are excluded. Pure function for reuse and
// testing; callers persist accepted candidates via the existing correlation API.
// ---------------------------------------------------------------------------

import type { BpDetection, CaseRecord, DetectionCorrelation } from '../types.js';

export interface CorrelationCandidate {
  bpDetectionId: string;
  xdrIncidentId: string;
  bpTitle: string;
  xdrTitle: string;
  correlationType: 'entity' | 'temporal' | 'title';
  confidence: number;
  /** Human-readable justifications for the suggested link. */
  reasons: string[];
}

export interface CandidateOptions {
  /** Max time gap (ms) for temporal scoring. Default 60 minutes. */
  windowMs?: number;
  /** Minimum combined confidence to surface a candidate. Default 0.5. */
  minConfidence?: number;
  /** Cap on returned candidates. Default 50. */
  limit?: number;
}

const DEFAULTS: Required<CandidateOptions> = {
  windowMs: 60 * 60 * 1000,
  minConfidence: 0.5,
  limit: 50,
};

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'was', 'has', 'via',
  'detected', 'detection', 'alert', 'incident', 'activity', 'suspicious', 'possible',
  'multiple', 'user', 'account', 'via',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    (text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Suggest correlation candidates between BP detections and XDR incidents.
 * Confidence blends temporal proximity (50%) and title similarity (50%), with
 * an entity-in-title bonus. Pairs already present in `existing` are skipped.
 */
export function detectCorrelationCandidates(
  detections: BpDetection[],
  incidents: CaseRecord[],
  existing: DetectionCorrelation[] = [],
  options: CandidateOptions = {},
): CorrelationCandidate[] {
  const opts: Required<CandidateOptions> = { ...DEFAULTS, ...options };

  const existingPairs = new Set(existing.map((c) => `${c.bpDetectionId}::${c.xdrIncidentId}`));
  const candidates: CorrelationCandidate[] = [];

  for (const det of detections) {
    const detTokens = tokenize(det.title);
    const detTime = new Date(det.createdAt).getTime();
    const entities = (det.entities || []).map((e) => e.toLowerCase()).filter(Boolean);

    for (const inc of incidents) {
      if (existingPairs.has(`${det.id}::${inc.id}`)) continue;

      const reasons: string[] = [];

      // Temporal proximity.
      const incTime = new Date(inc.createdTime).getTime();
      let temporalScore = 0;
      if (!Number.isNaN(detTime) && !Number.isNaN(incTime)) {
        const gap = Math.abs(detTime - incTime);
        if (gap <= opts.windowMs) {
          temporalScore = 1 - gap / opts.windowMs;
          const mins = Math.round(gap / 60000);
          reasons.push(`created within ${mins} min of each other`);
        }
      }

      // Title similarity.
      const incTokens = tokenize(inc.title);
      const titleScore = jaccard(detTokens, incTokens);
      if (titleScore > 0) {
        const shared = [...detTokens].filter((t) => incTokens.has(t));
        reasons.push(`shared terms: ${shared.slice(0, 5).join(', ')}`);
      }

      // Entity appears in the incident title.
      const entityHit = entities.find((e) => incTokens.has(e));
      let entityBonus = 0;
      if (entityHit) {
        entityBonus = 0.15;
        reasons.push(`entity "${entityHit}" referenced in incident`);
      }

      const confidence = Math.min(1, 0.5 * temporalScore + 0.5 * titleScore + entityBonus);
      if (confidence < opts.minConfidence) continue;

      let correlationType: CorrelationCandidate['correlationType'] = 'title';
      if (entityHit && entityBonus >= titleScore && entityBonus >= temporalScore) {
        correlationType = 'entity';
      } else if (temporalScore > titleScore) {
        correlationType = 'temporal';
      }

      candidates.push({
        bpDetectionId: det.id,
        xdrIncidentId: inc.id,
        bpTitle: det.title,
        xdrTitle: inc.title,
        correlationType,
        confidence: round(confidence, 3),
        reasons,
      });
    }
  }

  return candidates.sort((a, b) => b.confidence - a.confidence).slice(0, opts.limit);
}
