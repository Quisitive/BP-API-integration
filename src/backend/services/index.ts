// ---------------------------------------------------------------------------
// Services — Barrel Export
// ---------------------------------------------------------------------------

export { CompassOneClient } from './compassOneClient.js';
export type {
  AlertGroup,
  AlertGroupsListResponse,
  DetectionAlert,
  AlertListResponse,
  AlertGroupsByWeekEntry,
  TopDetectionsByEntityEntry,
  TopDetectionsByThreatEntry,
  ReportRun,
  ReportRunListResponse,
  Asset,
  AssetListResponse,
} from './compassOneClient.js';

export { DefenderApiClient } from './defenderApi.js';

export { RemediationService } from './remediationService.js';
export type { ProposalRepository, RemediationExecutor } from './remediationService.js';

export { McpBridgeExecutor } from './mcpBridge.js';
export type { McpDispatchPayload } from './mcpBridge.js';

export { LearningPlaybookEngine } from './learningPlaybook.js';
export type { PlaybookEntry, MatchPattern, IncidentContext } from './learningPlaybook.js';
