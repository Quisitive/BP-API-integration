// ---------------------------------------------------------------------------
// Security Headers Middleware
// ---------------------------------------------------------------------------
// Applies HTTP security headers (CSP, HSTS, X-Frame-Options, etc.)
// using the helmet package. Configured for a SOC dashboard that connects
// to Blackpoint, Microsoft Security, and Graph APIs.
// ---------------------------------------------------------------------------

import helmet from 'helmet';

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: [
        "'self'",
        'https://api.blackpointcyber.com',
        'https://api.security.microsoft.com',
        'https://graph.microsoft.com',
        'https://login.microsoftonline.com',
      ],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});
