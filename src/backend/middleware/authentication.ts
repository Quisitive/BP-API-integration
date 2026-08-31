// ---------------------------------------------------------------------------
// Authentication Middleware — Entra ID JWT Validation
// ---------------------------------------------------------------------------
// Validates Bearer tokens issued by Microsoft Entra ID using JWKS key
// rotation. Extracts user identity, object ID, and app roles from the token.
//
// Requires environment variables:
//   ENTRA_TENANT_ID  — Platform tenant ID (issuer)
//   ENTRA_CLIENT_ID  — SPA app registration client ID (audience)
// ---------------------------------------------------------------------------

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthenticatedUser {
  /** Entra Object ID (unique user identifier) */
  oid: string;
  /** User principal name / email */
  preferredUsername: string;
  /** Display name */
  name: string;
  /** App roles assigned in Entra (SOC.Admin, SOC.Analyst, SOC.Viewer) */
  roles: string[];
  /** Token issuer tenant ID (platform tenant) */
  tid: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getConfig() {
  const tenantId = process.env.ENTRA_TENANT_ID;
  const clientId = process.env.ENTRA_CLIENT_ID;

  if (!tenantId || !clientId) {
    throw new Error(
      'ENTRA_TENANT_ID and ENTRA_CLIENT_ID must be set for authentication',
    );
  }

  return {
    tenantId,
    clientId,
    issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
  };
}

// ---------------------------------------------------------------------------
// JWKS Client (cached + rate-limited)
// ---------------------------------------------------------------------------

let cachedClient: jwksClient.JwksClient | null = null;

function getJwksClient(): jwksClient.JwksClient {
  if (!cachedClient) {
    const config = getConfig();
    cachedClient = jwksClient({
      jwksUri: config.jwksUri,
      cache: true,
      cacheMaxAge: 600_000, // 10 minutes
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
  }
  return cachedClient;
}

function getSigningKey(header: jwt.JwtHeader): Promise<string> {
  return new Promise((resolve, reject) => {
    getJwksClient().getSigningKey(header.kid, (err, key) => {
      if (err) return reject(err);
      if (!key) return reject(new Error('No signing key found'));
      resolve(key.getPublicKey());
    });
  });
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export function authenticationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  // Decode without verification first to get the key ID
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === 'string' || !decoded.header.kid) {
    res.status(401).json({ error: 'Invalid token structure' });
    return;
  }

  const config = getConfig();

  getSigningKey(decoded.header)
    .then(signingKey => {
      const payload = jwt.verify(token, signingKey, {
        issuer: config.issuer,
        audience: config.clientId,
        algorithms: ['RS256'],
      }) as jwt.JwtPayload;

      req.user = {
        oid: payload.oid || payload.sub || '',
        preferredUsername: payload.preferred_username || payload.upn || '',
        name: payload.name || '',
        roles: Array.isArray(payload.roles) ? payload.roles : [],
        tid: payload.tid || '',
      };

      next();
    })
    .catch(err => {
      const message =
        err instanceof jwt.TokenExpiredError
          ? 'Token expired'
          : err instanceof jwt.JsonWebTokenError
            ? 'Token validation failed'
            : 'Authentication error';

      res.status(401).json({ error: message });
    });
}

/**
 * Skip authentication for specified path prefixes (e.g., /api/health).
 * All other paths require valid JWT.
 */
export function optionalAuth(publicPaths: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (publicPaths.some(p => req.path === p || req.path.startsWith(p + '/'))) {
      next();
      return;
    }
    authenticationMiddleware(req, res, next);
  };
}
