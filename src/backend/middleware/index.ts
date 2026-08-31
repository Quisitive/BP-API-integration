// ---------------------------------------------------------------------------
// Middleware barrel export
// ---------------------------------------------------------------------------

export { requestIdMiddleware } from './requestId.js';
export { securityHeaders } from './securityHeaders.js';
export { rateLimitMiddleware, type RateLimitOptions } from './rateLimit.js';
export { authenticationMiddleware, optionalAuth, type AuthenticatedUser } from './authentication.js';
export { requirePermission, requireRole, resolveRole, hasPermission, type InternalRole, type Permission } from './authorization.js';
export { tenantIsolationMiddleware, type TenantRegistry } from './tenantIsolation.js';
export { auditMiddleware, type AuditEntry } from './audit.js';
export { validateBody, validateQuery, validateParams, schemas } from './inputValidation.js';
